import { hashText } from "../shared/cache";
import { sendRuntimeMessage } from "../shared/messages";
import type { StreamMessage, StreamRequest } from "../shared/stream-protocol";
import type {
  CacheEntry,
  ExtensionSettings,
  ParagraphResult,
  SentenceAlignment,
  TokenUsage,
} from "../shared/types";
import { collectReadingDocument } from "./reading-document";
import {
  enableCrossHighlight,
  unwrapSentenceSpans,
  unwrapSentenceSpansWithin,
  wrapSentences,
} from "./highlight";
import { extractParagraphText } from "./text-extraction";
import {
  createTranslationBlock,
  removeAllBlocks,
  setBlockError,
  toggleBlocksVisibility,
  finalizeBlock,
} from "./translation-block";
import {
  addUsage,
  destroyWidget,
  hideWidget,
  setProgress,
  showWidget,
} from "./token-widget";

export interface PageTranslationSession {
  toggle(): Promise<void>;
  refresh(): Promise<void>;
  reset(): void;
}

export type RetryScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

export interface PageTranslationSessionOptions {
  loadSettings: () => Promise<ExtensionSettings>;
  beforeStart: (settings: ExtensionSettings) => Promise<void>;
  scheduleRetry: RetryScheduler;
}

interface PreparedParagraph {
  element: HTMLElement;
  text: string;
  id: string;
  block: HTMLElement;
}

interface PreparedSection {
  heading: string | null;
  paragraphs: PreparedParagraph[];
  progressSettled: boolean;
}

interface OwnedPort {
  cancel(): void;
}

const MAX_PARAGRAPHS_PER_SECTION = 8;
const MAX_RETRIES = 3;

function isUsableCacheEntry(
  value: unknown,
  expectedParagraphCount: number,
): value is CacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const paragraphs = (value as { paragraphs?: unknown }).paragraphs;
  if (!Array.isArray(paragraphs) || paragraphs.length !== expectedParagraphCount) {
    return false;
  }

  return paragraphs.every((paragraph) => {
    if (typeof paragraph !== "object" || paragraph === null) return false;
    const candidate = paragraph as {
      translation?: unknown;
      alignment?: unknown;
    };
    if (
      typeof candidate.translation !== "string" ||
      !Array.isArray(candidate.alignment)
    ) {
      return false;
    }
    return candidate.alignment.every((alignment) => {
      if (typeof alignment !== "object" || alignment === null) return false;
      const item = alignment as { original?: unknown; translated?: unknown };
      return (
        typeof item.original === "string" &&
        typeof item.translated === "string"
      );
    });
  });
}

function isTerminalProviderError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    /(^|\D)(401|403)(\D|$)/.test(normalized) ||
    normalized.includes("api key is not configured") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication failed") ||
    normalized.includes("invalid api key") ||
    normalized.includes("settings changed") ||
    normalized.includes("forbidden")
  );
}

async function getCachedFromStorage(hash: string): Promise<CacheEntry | null> {
  const response = await sendRuntimeMessage({ type: "cache/get", hash });
  return response.ok && "entry" in response ? response.entry : null;
}

async function putCachedToStorage(entry: CacheEntry): Promise<void> {
  await sendRuntimeMessage({ type: "cache/put", entry });
}

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  maxConcurrency: number,
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const taskIndex = nextIndex++;
      await tasks[taskIndex]();
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

class PageTranslationSessionImpl implements PageTranslationSession {
  private active = false;
  private visible = true;
  private inProgress = false;
  private refreshPending = false;
  private paragraphIndex = 0;
  private generation = 0;
  private readonly ownedPorts = new Set<OwnedPort>();
  private readonly retryCancellations = new Set<() => void>();
  private readonly alignmentStore = new Map<string, SentenceAlignment[]>();
  private readonly ownedParagraphs = new Set<PreparedParagraph>();

  constructor(private readonly options: PageTranslationSessionOptions) {}

  async toggle(): Promise<void> {
    if (this.active && this.visible) {
      this.visible = false;
      toggleBlocksVisibility(false);
      hideWidget();
      return;
    }

    if (this.active && !this.visible) {
      this.visible = true;
      toggleBlocksVisibility(true);
      showWidget();
      await this.refresh();
      return;
    }

    if (this.inProgress) return;
    this.inProgress = true;
    const runGeneration = this.generation;

    try {
      const settings = await this.options.loadSettings();
      if (!this.isCurrent(runGeneration)) return;

      await this.options.beforeStart(settings);
      if (!this.isCurrent(runGeneration)) return;

      const sections = this.prepareSections(runGeneration);
      if (sections.length === 0) {
        console.log("PaperLens: no paragraphs found");
        return;
      }

      this.active = true;
      this.visible = true;
      setProgress(0, sections.length);
      showWidget();

      let completedSections = 0;
      const tasks = sections.map((section) => async () => {
        await this.translateSection(section, settings, runGeneration);
        if (!this.isCurrent(runGeneration) || section.progressSettled) return;
        section.progressSettled = true;
        completedSections++;
        setProgress(completedSections, sections.length);
      });
      await runWithConcurrency(tasks, settings.maxConcurrency);
    } finally {
      if (this.isCurrent(runGeneration)) {
        this.inProgress = false;
        if (this.refreshPending) {
          this.refreshPending = false;
          void this.refresh();
        }
      }
    }
  }

  async refresh(): Promise<void> {
    if (!this.active || !this.visible) return;
    if (this.inProgress) {
      this.refreshPending = true;
      return;
    }
    this.inProgress = true;
    const runGeneration = this.generation;
    try {
      const settings = await this.options.loadSettings();
      if (!this.isCurrent(runGeneration)) return;
      const sections = this.prepareSections(runGeneration);
      if (!sections.length) return;
      let completed = 0;
      setProgress(0, sections.length);
      const tasks = sections.map(section => async () => {
        await this.translateSection(section, settings, runGeneration);
        if (!this.isCurrent(runGeneration)) return;
        setProgress(++completed, sections.length);
      });
      await runWithConcurrency(tasks, settings.maxConcurrency);
    } finally {
      if (this.isCurrent(runGeneration)) {
        this.inProgress = false;
        if (this.refreshPending) {
          this.refreshPending = false;
          void this.refresh();
        }
      }
    }
  }

  reset(): void {
    this.generation++;

    for (const cancel of this.retryCancellations) {
      cancel();
    }
    this.retryCancellations.clear();

    for (const owner of [...this.ownedPorts]) {
      owner.cancel();
    }
    this.ownedPorts.clear();

    for (const paragraph of this.ownedParagraphs) {
      unwrapSentenceSpansWithin(paragraph.element);
      unwrapSentenceSpansWithin(paragraph.block);
      paragraph.element.removeAttribute("data-paperlens-id");
      paragraph.element.removeAttribute("data-paperlens-pair");
      paragraph.block.removeAttribute("data-paperlens-pair");
      paragraph.block.remove();
    }
    this.ownedParagraphs.clear();

    removeAllBlocks();
    document.querySelectorAll("[data-paperlens-id]").forEach((element) => {
      element.removeAttribute("data-paperlens-id");
    });
    unwrapSentenceSpans();
    this.alignmentStore.clear();
    destroyWidget();

    this.active = false;
    this.visible = true;
    this.inProgress = false;
    this.refreshPending = false;
    this.paragraphIndex = 0;
  }

  private isCurrent(runGeneration: number): boolean {
    return runGeneration === this.generation;
  }

  private releaseParagraph(paragraph: PreparedParagraph): void {
    unwrapSentenceSpansWithin(paragraph.element);
    paragraph.element.removeAttribute("data-paperlens-id");
    paragraph.element.removeAttribute("data-paperlens-pair");
    paragraph.block.remove();
    this.ownedParagraphs.delete(paragraph);
    this.alignmentStore.delete(paragraph.id);
  }

  private prepareSections(runGeneration: number): PreparedSection[] {
    const prepared: PreparedSection[] = [];
    const reading = collectReadingDocument({includeTranslatedParagraphs: true});
    const accepted = new Set(reading.sections.flatMap(section => section.paragraphs));
    const existing = new Map([...this.ownedParagraphs].map(paragraph => [paragraph.element, paragraph]));
    for (const paragraph of this.ownedParagraphs) {
      if (!accepted.has(paragraph.element)) this.releaseParagraph(paragraph);
    }

    for (const section of reading.sections) {
      const validParagraphs = section.paragraphs
        .map((element) => ({ element, text: extractParagraphText(element) }))
        .filter(({ element, text }) => {
          const previous = existing.get(element);
          if (previous?.text === text) return false;
          if (previous) {
            this.releaseParagraph(previous);
          }
          return text.trim().length > 0;
        });

      for (
        let start = 0;
        start < validParagraphs.length;
        start += MAX_PARAGRAPHS_PER_SECTION
      ) {
        const chunk = validParagraphs.slice(start, start + MAX_PARAGRAPHS_PER_SECTION);
        const paragraphs = chunk.map(({ element, text }) => {
          const id = `pl-${runGeneration}-${this.paragraphIndex++}`;
          element.setAttribute("data-paperlens-id", id);
          const paragraph = {
            element,
            text,
            id,
            block: createTranslationBlock(element, id),
          };
          this.ownedParagraphs.add(paragraph);
          return paragraph;
        });
        if (paragraphs.length > 0) {
          prepared.push({
            heading: section.heading,
            paragraphs,
            progressSettled: false,
          });
        }
      }
    }

    return prepared;
  }

  private applySectionResults(
    section: PreparedSection,
    results: ParagraphResult[],
  ): void {
    const accepted = new Set(collectReadingDocument({includeTranslatedParagraphs: true}).sections.flatMap(item => item.paragraphs));
    const count = Math.min(section.paragraphs.length, results.length);
    for (let index = 0; index < count; index++) {
      const paragraph = section.paragraphs[index];
      if (!accepted.has(paragraph.element)) {this.releaseParagraph(paragraph); continue;}
      if (!this.ownedParagraphs.has(paragraph) || extractParagraphText(paragraph.element) !== paragraph.text) continue;
      const result = results[index];
      paragraph.block.classList.remove("paperlens-error");
      finalizeBlock(paragraph.block, result.translation);

      if (result.alignment?.length && paragraph.element.tagName.toLowerCase() !== "table") {
        this.alignmentStore.set(paragraph.id, result.alignment);
        wrapSentences(
          paragraph.element,
          paragraph.block,
          result.alignment,
          result.translation,
        );
        enableCrossHighlight();
      }
    }

    for (let index = count; index < section.paragraphs.length; index++) {
      setBlockError(
        section.paragraphs[index].block,
        "Translation missing for this paragraph",
      );
    }
  }

  private resetSectionBlocks(section: PreparedSection): void {
    for (const paragraph of section.paragraphs) {
      paragraph.block.classList.remove("paperlens-error");
      paragraph.block.classList.add("paperlens-skeleton");
      paragraph.block.textContent = "Translating...";
    }
  }

  private settleTerminalBlocks(
    section: PreparedSection,
    error: string,
    workingRetry: () => void,
  ): void {
    const unresolved = section.paragraphs.filter((paragraph) =>
      paragraph.block.classList.contains("paperlens-skeleton"),
    );
    unresolved.forEach((paragraph, index) => {
      setBlockError(
        paragraph.block,
        error,
        index === 0 ? workingRetry : undefined,
      );
    });
  }

  private async translateSection(
    section: PreparedSection,
    settings: ExtensionSettings,
    runGeneration: number,
  ): Promise<void> {
    const paragraphTexts = section.paragraphs.map(({ text }) => text);
    const paragraphIds = section.paragraphs.map(({ id }) => id);
    const sectionHash = await hashText(JSON.stringify({
      version: 2,
      provider: settings.currentProvider,
      model: settings.providerSettings[settings.currentProvider].model,
      configurationKey: settings.translationConfigKey,
      customPrompt: settings.customPrompt,
      paragraphTexts,
    }));
    if (!this.isCurrent(runGeneration)) return;

    if (settings.cacheEnabled) {
      const cached = await getCachedFromStorage(sectionHash);
      if (!this.isCurrent(runGeneration)) return;
      if (isUsableCacheEntry(cached, section.paragraphs.length)) {
        this.applySectionResults(section, cached.paragraphs);
        addUsage(undefined);
        return;
      }
    }

    await this.streamSection(
      section,
      paragraphTexts,
      paragraphIds,
      sectionHash,
      settings,
      runGeneration,
    );
  }

  private streamSection(
    section: PreparedSection,
    paragraphTexts: string[],
    paragraphIds: string[],
    sectionHash: string,
    settings: ExtensionSettings,
    runGeneration: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.isCurrent(runGeneration)) {
        resolve();
        return;
      }

      const port = chrome.runtime.connect({ name: "paperlens-stream" });
      let retries = 0;
      let retryPending = false;
      let terminalReceived = false;
      let promiseSettled = false;
      let intentionalTerminal = false;
      const ownedRetryCancellations = new Set<() => void>();
      let owner!: OwnedPort;

      const cancelRetries = (): void => {
        for (const cancel of [...ownedRetryCancellations]) {
          cancel();
        }
        ownedRetryCancellations.clear();
        retryPending = false;
      };

      const finish = (): void => {
        if (promiseSettled) return;
        terminalReceived = true;
        cancelRetries();
        intentionalTerminal = true;
        this.ownedPorts.delete(owner);
        promiseSettled = true;
        try {
          port.disconnect();
        } catch {
          // The browser may already have disconnected the Port.
        }
        resolve();
      };

      owner = {
        cancel: () => {
          if (promiseSettled) return;
          terminalReceived = true;
          cancelRetries();
          intentionalTerminal = true;
          this.ownedPorts.delete(owner);
          promiseSettled = true;
          try {
            port.disconnect();
          } catch {
            // The browser may already have disconnected the Port.
          }
          resolve();
        },
      };
      this.ownedPorts.add(owner);

      const sendRequest = (): void => {
        if (
          !this.isCurrent(runGeneration) ||
          terminalReceived ||
          promiseSettled
        ) {
          return;
        }
        port.postMessage({
          type: "stream/translate-section",
          paragraphTexts,
          paragraphIds,
          customPrompt: settings.customPrompt,
          ...(settings.translationConfigKey ? {configurationKey: settings.translationConfigKey} : {}),
        } satisfies StreamRequest);
      };

      const scheduleRetry = (delayMs: number): void => {
        let cancelScheduled!: () => void;
        const cancelRetry = (): void => {
          cancelScheduled();
          this.retryCancellations.delete(cancelRetry);
          ownedRetryCancellations.delete(cancelRetry);
        };
        cancelScheduled = this.options.scheduleRetry(() => {
          if (!this.isCurrent(runGeneration)) return;
          this.retryCancellations.delete(cancelRetry);
          ownedRetryCancellations.delete(cancelRetry);
          retryPending = false;
          if (terminalReceived || promiseSettled) return;
          sendRequest();
        }, delayMs);
        this.retryCancellations.add(cancelRetry);
        ownedRetryCancellations.add(cancelRetry);
      };

      const workingRetry = (): void => {
        if (!this.isCurrent(runGeneration)) return;
        this.resetSectionBlocks(section);
        void this.streamSection(
          section,
          paragraphTexts,
          paragraphIds,
          sectionHash,
          settings,
          runGeneration,
        );
      };

      const completeSuccessfully = (
        results: ParagraphResult[],
        usage?: TokenUsage,
      ): void => {
        terminalReceived = true;
        cancelRetries();
        this.applySectionResults(section, results);
        addUsage(usage);

        void (async () => {
          try {
            if (settings.cacheEnabled) {
              await putCachedToStorage({
                hash: sectionHash,
                paragraphs: results.slice(0, section.paragraphs.length),
                timestamp: Date.now(),
                size: 0,
              });
            }
          } catch {
            // Cache persistence is best-effort and must not strand the session.
          } finally {
            if (this.isCurrent(runGeneration)) finish();
          }
        })();
      };

      port.onMessage.addListener((message: StreamMessage) => {
        if (!this.isCurrent(runGeneration)) return;
        if (terminalReceived || promiseSettled) return;

        switch (message.type) {
          case "stream-chunk":
            break;
          case "stream-section-done": {
            completeSuccessfully(message.paragraphs, message.usage);
            break;
          }
          case "stream-done": {
            completeSuccessfully(
              section.paragraphs.length === 1
                ? [{
                translation: message.fullText,
                alignment: message.alignment,
                  }]
                : [],
              message.usage,
            );
            break;
          }
          case "stream-error": {
            const retryable =
              !isTerminalProviderError(message.error) && retries < MAX_RETRIES;
            if (retryable) {
              if (retryPending) return;
              retries++;
              retryPending = true;
              const delayMs = 2 ** retries * 1000;
              if (message.error.includes("429")) {
                for (const paragraph of section.paragraphs) {
                  paragraph.block.textContent =
                    `Rate limited, retrying in ${delayMs / 1000}s...`;
                }
              }
              scheduleRetry(delayMs);
              return;
            }

            terminalReceived = true;
            cancelRetries();
            this.settleTerminalBlocks(section, message.error, workingRetry);
            finish();
            break;
          }
        }
      });

      port.onDisconnect.addListener(() => {
        if (!this.isCurrent(runGeneration)) return;
        if (promiseSettled || intentionalTerminal || terminalReceived) return;

        this.ownedPorts.delete(owner);
        terminalReceived = true;
        cancelRetries();
        this.settleTerminalBlocks(
          section,
          "Translation interrupted",
          workingRetry,
        );
        promiseSettled = true;
        resolve();
      });

      sendRequest();
    });
  }
}

export function createPageTranslationSession(
  options: PageTranslationSessionOptions,
): PageTranslationSession {
  return new PageTranslationSessionImpl(options);
}
