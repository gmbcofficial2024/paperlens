import { hashText } from "../shared/cache";
import { sendRuntimeMessage } from "../shared/messages";
import type { StreamMessage, StreamRequest } from "../shared/stream-protocol";
import { extractStreamingParagraphTranslations } from "../shared/translation-json";
import type {
  CacheEntry,
  ExtensionSettings,
  ParagraphResult,
  SentenceAlignment,
  TokenUsage,
} from "../shared/types";
import {
  enableCrossHighlight,
  unwrapSentenceSpans,
  unwrapSentenceSpansWithin,
  wrapSentences,
} from "./highlight";
import { extractParagraphText, isSourceHidden } from "./text-extraction";
import {
  createTranslationBlock,
  removeAllBlocks,
  setBlockError,
  toggleBlocksVisibility,
  finalizeBlock,
  updateStreamingBlock,
} from "./translation-block";
import { collectTranslatableSections } from "./translation-targets";
import {
  addUsage,
  configureWidget,
  destroyWidget,
  hideWidget,
  setProgress,
  setWidgetReadingMode,
  setWidgetRunning,
  showPageToast,
  showWidget,
  type ReadingMode,
} from "./token-widget";

export interface TranslationSessionStatus {
  active: boolean;
  visible: boolean;
  inProgress: boolean;
  done: number;
  total: number;
}

export interface PageTranslationSession {
  toggle(): Promise<void>;
  refresh(): Promise<void>;
  stop(): void;
  reset(): void;
  getStatus(): TranslationSessionStatus;
}

export type RetryScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

export interface PageTranslationSessionOptions {
  loadSettings: () => Promise<ExtensionSettings>;
  beforeStart: (settings: ExtensionSettings) => Promise<void>;
  scheduleRetry: RetryScheduler;
  onRequestSummary?: () => void;
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

const FIRST_BATCH_PARAGRAPHS = 3;
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

function isAuthConfigError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    /(^|\D)(401|403)(\D|$)/.test(normalized) ||
    normalized.includes("api key is not configured") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication failed") ||
    normalized.includes("invalid api key")
  );
}

function isUnresolvedBlock(block: HTMLElement): boolean {
  return (
    block.classList.contains("paperlens-skeleton") ||
    block.classList.contains("paperlens-streaming")
  );
}

function measureRect(element: HTMLElement): { top: number; bottom: number; height: number } | null {
  if (typeof element.getBoundingClientRect !== "function") return null;
  try {
    const rect = element.getBoundingClientRect();
    if (!rect) return null;
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  } catch {
    return null;
  }
}

function sortSectionsByViewportPriority(sections: PreparedSection[]): PreparedSection[] {
  if (sections.length <= 1) return sections;
  const viewportHeight = typeof window !== "undefined" && typeof window.innerHeight === "number"
    ? window.innerHeight
    : 0;
  if (viewportHeight <= 0) return sections;

  const measured = sections.map((section, index) => {
    const first = section.paragraphs[0]?.element;
    const rect = first ? measureRect(first) : null;
    return { section, index, rect };
  });

  const hasRealLayout = measured.some(
    ({ rect }) => rect !== null && (rect.top !== 0 || rect.bottom !== 0 || rect.height !== 0),
  );
  if (!hasRealLayout) return sections;

  const rank = (rect: { top: number; bottom: number; height: number } | null): [number, number] => {
    if (!rect) return [3, 0];
    if (rect.bottom >= 0 && rect.top <= viewportHeight) {
      return [0, Math.max(0, rect.top)];
    }
    if (rect.top > viewportHeight) {
      return [1, rect.top - viewportHeight];
    }
    return [2, -rect.bottom];
  };

  return measured
    .sort((a, b) => {
      const [tierA, distA] = rank(a.rect);
      const [tierB, distB] = rank(b.rect);
      if (tierA !== tierB) return tierA - tierB;
      if (distA !== distB) return distA - distB;
      return a.index - b.index;
    })
    .map((entry) => entry.section);
}

function isElementInViewport(element: HTMLElement): boolean {
  const viewportHeight = typeof window !== "undefined" && typeof window.innerHeight === "number"
    ? window.innerHeight
    : 0;
  if (viewportHeight <= 0) return false;
  const rect = measureRect(element);
  if (!rect || (rect.top === 0 && rect.bottom === 0 && rect.height === 0)) return false;
  return rect.bottom >= 0 && rect.top <= viewportHeight;
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
  private runToken = 0;
  private completedCount = 0;
  private totalCount = 0;
  private lastVisibleMode: Exclude<ReadingMode, "source"> = "bilingual";
  private authToastShownForRun = false;
  private readonly ownedPorts = new Set<OwnedPort>();
  private readonly retryCancellations = new Set<() => void>();
  private readonly alignmentStore = new Map<string, SentenceAlignment[]>();
  private readonly ownedParagraphs = new Set<PreparedParagraph>();

  constructor(private readonly options: PageTranslationSessionOptions) {}

  getStatus(): TranslationSessionStatus {
    return {
      active: this.active,
      visible: this.visible,
      inProgress: this.inProgress,
      done: this.completedCount,
      total: this.totalCount,
    };
  }

  private bindWidgetCallbacks(): void {
    configureWidget({
      onStop: () => this.stop(),
      onReadingModeChange: (mode) => this.handleReadingModeChange(mode),
      ...(this.options.onRequestSummary ? { onSummary: this.options.onRequestSummary } : {}),
    });
  }

  private handleReadingModeChange(mode: ReadingMode): void {
    if (!this.active) return;
    if (mode === "source") {
      this.visible = false;
      toggleBlocksVisibility(false);
      return;
    }
    this.lastVisibleMode = mode;
    if (!this.visible) {
      this.visible = true;
      toggleBlocksVisibility(true);
      void this.refresh();
    }
  }

  async toggle(): Promise<void> {
    if (this.active && this.visible) {
      this.visible = false;
      toggleBlocksVisibility(false);
      setWidgetReadingMode("source");
      hideWidget();
      return;
    }

    if (this.active && !this.visible) {
      this.visible = true;
      toggleBlocksVisibility(true);
      setWidgetReadingMode(this.lastVisibleMode);
      showWidget();
      await this.refresh();
      return;
    }

    if (this.inProgress) return;
    await this.runPass(true);
  }

  async refresh(): Promise<void> {
    if (!this.active || !this.visible) return;
    if (this.inProgress) {
      this.refreshPending = true;
      return;
    }
    await this.runPass(false);
  }

  stop(): void {
    if (!this.inProgress && this.ownedPorts.size === 0 && this.retryCancellations.size === 0) {
      return;
    }
    this.runToken++;

    for (const cancel of this.retryCancellations) {
      cancel();
    }
    this.retryCancellations.clear();

    for (const owner of [...this.ownedPorts]) {
      owner.cancel();
    }
    this.ownedPorts.clear();

    for (const paragraph of [...this.ownedParagraphs]) {
      if (isUnresolvedBlock(paragraph.block)) {
        this.releaseParagraph(paragraph);
      }
    }

    this.inProgress = false;
    this.refreshPending = false;

    if (this.ownedParagraphs.size === 0) {
      this.active = false;
      this.visible = true;
      this.completedCount = 0;
      this.totalCount = 0;
      destroyWidget();
      showPageToast("번역을 중단했습니다.");
    } else {
      setWidgetRunning(false, true);
      showPageToast("번역을 중단했습니다. 완료된 문단은 유지됩니다.");
    }
  }

  reset(): void {
    this.generation++;
    this.runToken++;

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
    this.completedCount = 0;
    this.totalCount = 0;
    this.lastVisibleMode = "bilingual";
    this.authToastShownForRun = false;
  }

  private async runPass(initialStart: boolean): Promise<void> {
    this.inProgress = true;
    const runGeneration = this.generation;
    const activeRunToken = ++this.runToken;
    this.authToastShownForRun = false;

    try {
      const settings = await this.options.loadSettings();
      if (!this.isCurrentRun(runGeneration, activeRunToken)) return;

      if (initialStart) {
        await this.options.beforeStart(settings);
        if (!this.isCurrentRun(runGeneration, activeRunToken)) return;
      }

      const sections = sortSectionsByViewportPriority(this.prepareSections(runGeneration));
      if (sections.length === 0) {
        if (initialStart) {
          console.log("PaperLens: no paragraphs found");
          showPageToast("이 페이지에서 번역할 본문을 찾지 못했습니다.");
        }
        return;
      }

      this.completedCount = 0;
      this.totalCount = sections.length;
      if (initialStart) {
        this.active = true;
        this.visible = true;
        this.bindWidgetCallbacks();
        setProgress(0, sections.length);
        setWidgetRunning(true);
        showWidget();
      } else {
        setProgress(0, sections.length);
        setWidgetRunning(true);
      }

      let completedSections = 0;
      const tasks = sections.map((section) => async () => {
        if (!this.isCurrentRun(runGeneration, activeRunToken)) return;
        await this.translateSection(section, settings, runGeneration, activeRunToken);
        if (!this.isCurrentRun(runGeneration, activeRunToken) || section.progressSettled) return;
        section.progressSettled = true;
        completedSections++;
        this.completedCount = completedSections;
        setProgress(completedSections, sections.length);
      });
      await runWithConcurrency(tasks, settings.maxConcurrency);
    } finally {
      if (this.isCurrentRun(runGeneration, activeRunToken)) {
        this.inProgress = false;
        setWidgetRunning(false, false);
        if (this.refreshPending) {
          this.refreshPending = false;
          void this.refresh();
        }
      }
    }
  }

  private isCurrent(runGeneration: number): boolean {
    return runGeneration === this.generation;
  }

  private isCurrentRun(runGeneration: number, activeRunToken: number): boolean {
    return runGeneration === this.generation && activeRunToken === this.runToken;
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
    const targetSections = collectTranslatableSections({ includeTranslatedParagraphs: true });
    const accepted = new Set(targetSections.flatMap((section) => section.paragraphs));
    const existing = new Map([...this.ownedParagraphs].map((paragraph) => [paragraph.element, paragraph]));
    for (const paragraph of [...this.ownedParagraphs]) {
      if (!accepted.has(paragraph.element)) this.releaseParagraph(paragraph);
    }

    let usedFastFirstBatch = false;

    for (const section of targetSections) {
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

      let start = 0;
      while (start < validParagraphs.length) {
        const remaining = validParagraphs.length - start;
        const startsInView = isElementInViewport(validParagraphs[start].element);
        const batchSize =
          !usedFastFirstBatch && remaining > 4 && (startsInView || prepared.length === 0)
            ? FIRST_BATCH_PARAGRAPHS
            : MAX_PARAGRAPHS_PER_SECTION;
        if (batchSize === FIRST_BATCH_PARAGRAPHS) {
          usedFastFirstBatch = true;
        }
        const chunk = validParagraphs.slice(start, start + batchSize);
        start += chunk.length;

        const paragraphs = chunk.map(({ element, text }) => {
          const id = `pl-${runGeneration}-${this.paragraphIndex++}`;
          element.setAttribute("data-paperlens-id", id);
          const paragraph: PreparedParagraph = {
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
    const accepted = new Set(
      collectTranslatableSections({ includeTranslatedParagraphs: true })
        .flatMap((item) => item.paragraphs),
    );
    const count = Math.min(section.paragraphs.length, results.length);
    for (let index = 0; index < count; index++) {
      const paragraph = section.paragraphs[index];
      if (!paragraph.element.isConnected || isSourceHidden(paragraph.element) || !accepted.has(paragraph.element)) {
        this.releaseParagraph(paragraph);
        continue;
      }
      if (!this.ownedParagraphs.has(paragraph) || extractParagraphText(paragraph.element) !== paragraph.text) {
        continue;
      }
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
      paragraph.block.classList.remove("paperlens-error", "paperlens-streaming");
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
      isUnresolvedBlock(paragraph.block),
    );
    unresolved.forEach((paragraph, index) => {
      setBlockError(
        paragraph.block,
        error,
        index === 0 ? workingRetry : undefined,
      );
    });
    if (isAuthConfigError(error) && !this.authToastShownForRun) {
      this.authToastShownForRun = true;
      showPageToast("API 키 설정이 필요합니다. 확장 아이콘의 Settings에서 키를 확인하세요.", "error");
    }
  }

  private async translateSection(
    section: PreparedSection,
    settings: ExtensionSettings,
    runGeneration: number,
    activeRunToken: number,
  ): Promise<void> {
    const paragraphTexts = section.paragraphs.map(({ text }) => text);
    const paragraphIds = section.paragraphs.map(({ id }) => id);
    const glossary = settings.glossary?.trim() || undefined;
    const sectionHash = await hashText(JSON.stringify({
      version: 2,
      provider: settings.currentProvider,
      model: settings.providerSettings[settings.currentProvider].model,
      configurationKey: settings.translationConfigKey,
      customPrompt: settings.customPrompt,
      ...(glossary ? { glossary } : {}),
      paragraphTexts,
    }));
    if (!this.isCurrentRun(runGeneration, activeRunToken)) return;

    if (settings.cacheEnabled) {
      const cached = await getCachedFromStorage(sectionHash);
      if (!this.isCurrentRun(runGeneration, activeRunToken)) return;
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
      activeRunToken,
    );
  }

  private streamSection(
    section: PreparedSection,
    paragraphTexts: string[],
    paragraphIds: string[],
    sectionHash: string,
    settings: ExtensionSettings,
    runGeneration: number,
    activeRunToken: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.isCurrentRun(runGeneration, activeRunToken)) {
        resolve();
        return;
      }

      const port = chrome.runtime.connect({ name: "paperlens-stream" });
      let retries = 0;
      let retryPending = false;
      let terminalReceived = false;
      let promiseSettled = false;
      let intentionalTerminal = false;
      let streamBuffer = "";
      let lastStreamed: Array<string | undefined> = [];
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

      owner = { cancel: finish };
      this.ownedPorts.add(owner);

      const glossary = settings.glossary?.trim() || undefined;
      const sendRequest = (): void => {
        if (
          !this.isCurrentRun(runGeneration, activeRunToken) ||
          terminalReceived ||
          promiseSettled
        ) {
          return;
        }
        streamBuffer = "";
        lastStreamed = [];
        port.postMessage({
          type: "stream/translate-section",
          paragraphTexts,
          paragraphIds,
          customPrompt: settings.customPrompt,
          ...(glossary ? { glossary } : {}),
          ...(settings.translationConfigKey ? { configurationKey: settings.translationConfigKey } : {}),
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
          if (!this.isCurrentRun(runGeneration, activeRunToken)) return;
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
          this.runToken,
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
        if (!this.isCurrentRun(runGeneration, activeRunToken)) return;
        if (terminalReceived || promiseSettled) return;

        switch (message.type) {
          case "stream-chunk": {
            streamBuffer += message.delta;
            const partials = extractStreamingParagraphTranslations(streamBuffer);
            const limit = Math.min(partials.length, section.paragraphs.length);
            for (let index = 0; index < limit; index += 1) {
              const text = partials[index];
              if (!text || text === lastStreamed[index]) continue;
              const paragraph = section.paragraphs[index];
              if (!this.ownedParagraphs.has(paragraph) || !paragraph.element.isConnected) continue;
              lastStreamed[index] = text;
              updateStreamingBlock(paragraph.block, text);
            }
            break;
          }
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
        if (!this.isCurrentRun(runGeneration, activeRunToken)) return;
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
