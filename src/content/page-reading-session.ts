import { sendRuntimeMessage } from "../shared/messages";
import type { ExtensionSettings } from "../shared/types";
import {
  collectBrowserPlainTextSummarySection,
  serializeSummaryDocument,
} from "../summary/document";
import { requestSummaryOnce } from "../summary/flow";
import { collectReadingDocument, type ReadingScope } from "./reading-document";
import { observeReadingChanges } from "./reading-observer";
import {
  createSummaryBlock,
  finalizeSummaryBlock,
  removeSummaryBlock,
  setSummaryBlockError,
  setSummaryBlockScope,
  setSummaryBlockSourceChanged,
  setSummaryBlockCancelled,
} from "./summary-block";
import { extractParagraphText } from "./text-extraction";
import {
  createPageTranslationSession,
  type RetryScheduler,
} from "./translation-session";
import { addUsage } from "./token-widget";

export interface PageReadingSession {
  toggleTranslation(): Promise<void>;
  summarize(): Promise<void>;
  reset(): void;
}

export interface PageReadingSessionOptions {
  sendRuntimeMessage: typeof sendRuntimeMessage;
  scheduleRetry: RetryScheduler;
}

interface SummaryRun {
  generation: number;
  block: HTMLElement;
  completion: Promise<void>;
  cancelled: boolean;
}

function getPaperTitle(): string | undefined {
  return (
    document.querySelector("meta[name='citation_title']")?.getAttribute("content")?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    document.title.trim() ||
    undefined
  );
}

function normalizeSummaryInputText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

function collectSummarySource(): {text: string; kind: "paper" | "article"; scope: ReadingScope; anchor?: Element} {
  const plainTextSection = collectBrowserPlainTextSummarySection(document);
  if (plainTextSection) {
    const fullText = normalizeSummaryInputText(plainTextSection.paragraphs[0] ?? "");
    return {text: fullText ? serializeSummaryDocument([
      {
        heading: null,
        paragraphs: [fullText],
      },
    ]) : "", kind: "paper", anchor: document.body.querySelector("pre") ?? undefined, scope: {paragraphCount: fullText ? 1 : 0, sectionCount: fullText ? 1 : 0, captionCount: 0, tableCount: 0, partial: false, reasons: ["브라우저에 로드된 텍스트 전체"]} };
  }

  const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
  const summarySections = reading.sections
    .map((section) => ({
      heading: section.heading,
      paragraphs: section.paragraphs
        .map((paragraph) => normalizeSummaryInputText(extractParagraphText(paragraph)))
        .filter((text) => text.length > 0),
    }))
    .filter((section) => section.paragraphs.length > 0);

  return {text: serializeSummaryDocument(summarySections), kind: reading.kind, scope: reading.scope, anchor: reading.sections[0]?.paragraphs[0]};
}

export function createPageReadingSession(
  options: PageReadingSessionOptions,
): PageReadingSession {
  let summaryGeneration = 0;
  let activeSummaryRun: SummaryRun | null = null;
  let cachedSettings: ExtensionSettings | null = null;
  let settingsCompletion: Promise<ExtensionSettings> | null = null;
  let stopObserving: (() => void) | null = null;
  let observedText = "";
  let completedSourceText: string | null = null;
  let summaryBlock: HTMLElement | null = null;
  let kindOverride: "paper" | "article" | undefined;

  const markSummaryChanged = (): void => {
    if (summaryBlock?.isConnected) {
      setSummaryBlockSourceChanged(summaryBlock, () => {void summarize();});
    }
  };

  const ensureObserver = (): void => {
    if (stopObserving) return;
    observedText = collectSummarySource().text;
    stopObserving = observeReadingChanges(() => {
      const source = collectSummarySource();
      if (source.text !== observedText) {
        observedText = source.text;
        if (completedSourceText !== null && source.text !== completedSourceText) markSummaryChanged();
      }
      // Equal text can belong to replacement DOM nodes. Translation reconciles
      // node ownership independently; it skips unchanged surviving anchors.
      void translationSession.refresh().catch(error => console.error("PaperLens source refresh:", error));
    });
  };

  const loadSettings = (): Promise<ExtensionSettings> => {
    if (cachedSettings) return Promise.resolve(cachedSettings);
    if (settingsCompletion) return settingsCompletion;

    const loadGeneration = summaryGeneration;
    const completion = (async (): Promise<ExtensionSettings> => {
      const response = await options.sendRuntimeMessage({ type: "settings/get" });
      if (!response.ok || !("settings" in response)) {
        throw new Error("Failed to load settings. Please check PaperLens configuration.");
      }
      if (loadGeneration === summaryGeneration) {
        cachedSettings = response.settings;
      }
      return response.settings;
    })();
    settingsCompletion = completion;
    void completion.finally(() => {
      if (settingsCompletion === completion) {
        settingsCompletion = null;
      }
    }).catch(() => undefined);
    return completion;
  };

  const translationSession = createPageTranslationSession({
    loadSettings,
    beforeStart: async (settings) => {
      if (settings.summary.autoGenerate) {
        await summarize();
      }
    },
    scheduleRetry: options.scheduleRetry,
  });

  const summarize = (): Promise<void> => {
    ensureObserver();
    const runGeneration = summaryGeneration;
    if (activeSummaryRun?.generation === runGeneration) {
      return activeSummaryRun.completion;
    }

    const initialSource = collectSummarySource();
    let settleCancellation!: () => void;
    const cancellation = new Promise<void>(resolve => {settleCancellation = resolve;});
    const run: SummaryRun = {
      generation: runGeneration,
      block: createSummaryBlock({
        insertionAnchor: initialSource.anchor,
        kind: kindOverride ?? initialSource.kind,
        onRetry: () => {void summarize();},
        onKindChange: kind => {kindOverride = kind; markSummaryChanged();},
        onCancel: () => {
          run.cancelled = true;
          if (activeSummaryRun === run) activeSummaryRun = null;
          setSummaryBlockCancelled(run.block);
          settleCancellation();
        },
      }),
      completion: Promise.resolve(),
      cancelled: false,
    };
    activeSummaryRun = run;
    summaryBlock = run.block;
    setSummaryBlockScope(run.block, initialSource.scope);

    const isCurrent = (): boolean =>
      !run.cancelled && run.generation === summaryGeneration && activeSummaryRun === run;

    const abandonIfStale = (): boolean => {
      if (isCurrent()) return false;
      if (!run.cancelled) run.block.remove();
      return true;
    };

    const execution = (async (): Promise<void> => {
      try {
        await loadSettings();
        if (abandonIfStale()) return;

        const captured = collectSummarySource();
        const capturedKind = kindOverride ?? captured.kind;
        observedText = captured.text;
        setSummaryBlockScope(run.block, captured.scope);
        const response = await requestSummaryOnce({
          title: getPaperTitle(),
          articleText: captured.text,
          kind: capturedKind,
          sourceScope: captured.scope.reasons.includes("abstract-only") ? "abstract-only" : "loaded-page",
        }, options.sendRuntimeMessage);
        if (abandonIfStale()) return;

        if (!response.ok || !("result" in response)) {
          throw new Error(response.ok ? "Summary failed." : response.error);
        }

        if (abandonIfStale()) return;
        finalizeSummaryBlock(run.block, response.result.summary);
        completedSourceText = captured.text;
        const currentSource = collectSummarySource();
        if (currentSource.text !== captured.text || (kindOverride ?? currentSource.kind) !== capturedKind) markSummaryChanged();
        if (abandonIfStale()) return;
        addUsage(response.result.usage);
      } catch (error) {
        if (abandonIfStale()) return;
        setSummaryBlockError(
          run.block,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (activeSummaryRun === run) {
          activeSummaryRun = null;
        }
      }
    })();
    run.completion = Promise.race([execution, cancellation]);

    return run.completion;
  };

  return {
    toggleTranslation: () => {ensureObserver(); return translationSession.toggle();},
    summarize,
    reset: () => {
      summaryGeneration++;
      stopObserving?.();
      stopObserving = null;
      completedSourceText = null;
      summaryBlock = null;
      kindOverride = undefined;
      cachedSettings = null;
      settingsCompletion = null;
      const invalidatedSummaryRun = activeSummaryRun;
      activeSummaryRun = null;
      invalidatedSummaryRun?.block.remove();
      translationSession.reset();
      removeSummaryBlock();
    },
  };
}
