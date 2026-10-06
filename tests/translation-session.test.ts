import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  createPageTranslationSession,
  type PageTranslationSession,
  type RetryScheduler,
} from "../src/content/translation-session";
import type {
  CacheEntry,
  ExtensionSettings,
  ParagraphResult,
} from "../src/shared/types";

type Listener = (...args: never[]) => void;

class FakeChromeEvent<T extends Listener> {
  readonly listeners = new Set<T>();

  addListener(listener: T): void {
    this.listeners.add(listener);
  }

  removeListener(listener: T): void {
    this.listeners.delete(listener);
  }

  hasListener(listener: T): boolean {
    return this.listeners.has(listener);
  }

  hasListeners(): boolean {
    return this.listeners.size > 0;
  }
}

class FakePort {
  readonly name = "paperlens-stream";
  readonly onMessage = new FakeChromeEvent<(message: never) => void>();
  readonly onDisconnect = new FakeChromeEvent<() => void>();
  readonly postedMessages: unknown[] = [];
  disconnectCount = 0;
  disconnected = false;
  private disconnectEmitted = false;

  postMessage(message: unknown): void {
    assert.equal(this.disconnected, false, "cannot post to a disconnected Port");
    this.postedMessages.push(message);
  }

  emitMessage(message: unknown): void {
    if (this.disconnected) return;
    this.emitLateMessage(message);
  }

  emitLateMessage(message: unknown): void {
    for (const listener of this.onMessage.listeners) {
      listener(message as never);
    }
  }

  emitDisconnect(): void {
    if (this.disconnectEmitted) return;
    this.disconnected = true;
    this.disconnectEmitted = true;
    this.emitLateDisconnect();
  }

  emitLateDisconnect(): void {
    for (const listener of this.onDisconnect.listeners) {
      listener();
    }
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnectCount++;
    this.emitDisconnect();
  }
}

class FakeRuntime {
  readonly id = "paperlens-test-extension";
  readonly onMessage = new FakeChromeEvent<Listener>();
  readonly onConnect = new FakeChromeEvent<Listener>();
  readonly requests: unknown[] = [];
  readonly connectCalls: unknown[] = [];
  readonly connectedPorts: FakePort[] = [];
  lastError: { message?: string } | undefined;
  private readonly queuedPorts: FakePort[] = [];

  constructor(
    private readonly cacheReplies: Array<CacheEntry | null | Promise<CacheEntry | null>>,
    private readonly cachePutCompletion: Promise<void> = Promise.resolve(),
    private readonly cachePutError?: Error,
  ) {}

  queuePort(port = new FakePort()): FakePort {
    this.queuedPorts.push(port);
    return port;
  }

  connect = (connectInfo?: unknown): chrome.runtime.Port => {
    this.connectCalls.push(connectInfo);
    const port = this.queuedPorts.shift();
    assert.ok(port, "test must queue every expected Port before connecting");
    this.connectedPorts.push(port);
    return port as unknown as chrome.runtime.Port;
  };

  sendMessage = (
    message: { type?: string },
    callback?: (response: unknown) => void,
  ): void => {
    this.requests.push(message);
    if (message.type === "cache/put" && this.cachePutError) {
      throw this.cachePutError;
    }
    queueMicrotask(() => {
      if (!callback) return;
      if (message.type === "cache/get") {
        void Promise.resolve(this.cacheReplies.shift() ?? null).then((entry) => {
          callback({ ok: true, entry });
        });
        return;
      }
      if (message.type === "cache/put") {
        void this.cachePutCompletion.then(() => {
          callback({ ok: true });
        });
        return;
      }
      callback({ ok: false, error: `Unexpected runtime request: ${message.type}` });
    });
  };

  getURL(path: string): string {
    return `chrome-extension://${this.id}/${path}`;
  }

  getManifest(): chrome.runtime.Manifest {
    return { manifest_version: 3, name: "PaperLens test", version: "1.0.0" };
  }
}

interface ScheduledRetry {
  delayMs: number;
  cancelled: boolean;
  run(): void;
  forceRun(): void;
}

function createRetryScheduler(): {
  scheduleRetry: RetryScheduler;
  retries: ScheduledRetry[];
} {
  const retries: ScheduledRetry[] = [];
  const scheduleRetry: RetryScheduler = (callback, delayMs) => {
    const retry: ScheduledRetry = {
      delayMs,
      cancelled: false,
      run() {
        if (!retry.cancelled) callback();
      },
      forceRun() {
        callback();
      },
    };
    retries.push(retry);
    return () => {
      retry.cancelled = true;
    };
  };
  return { scheduleRetry, retries };
}

const FIRST_TEXT =
  "The first source paragraph contains enough scientific detail for translation.";
const SECOND_TEXT =
  "The second source paragraph reports a distinct and reproducible observation.";
const THIRD_TEXT =
  "The third source paragraph explains the bounded conclusion from these results.";

function articleHtml(texts = [FIRST_TEXT, SECOND_TEXT]): string {
  const paragraphs = texts
    .map((text, index) => `<p id="source-${index + 1}">${text}</p>`)
    .join("");
  return `<html><head><title>Session test</title></head><body><article>${paragraphs}</article></body></html>`;
}

function testSettings(): ExtensionSettings {
  return {
    currentProvider: "gemini",
    providerSettings: {
      gemini: {},
      vertex: {},
      openai: {},
      anthropic: {},
      custom: {},
    },
    cacheEnabled: true,
    maxConcurrency: 2,
    customPrompt: "Translate faithfully.",
    summary: {
      provider: "codex",
      autoGenerate: false,
      prompt: "Summarize faithfully.",
    },
  };
}

const GLOBAL_NAMES = [
  "document",
  "window",
  "location",
  "Node",
  "Element",
  "HTMLElement",
  "Text",
  "Document",
  "DocumentFragment",
  "ShadowRoot",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "MutationObserver",
  "DOMParser",
  "Range",
  "NodeFilter",
  "CSS",
  "crypto",
  "chrome",
] as const;

function installBrowserGlobals(
  html: string,
  runtime: FakeRuntime,
  cryptoValue: unknown = webcrypto,
): () => void {
  const parsed = parseHTML(html);
  const url = new URL("https://journal.example/article");
  Object.defineProperty(parsed.window, "location", {
    configurable: true,
    value: url,
  });

  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of GLOBAL_NAMES) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }

  const rangeConstructor = parsed.document.createRange().constructor;
  const values: Record<(typeof GLOBAL_NAMES)[number], unknown> = {
    document: parsed.document,
    window: parsed.window,
    location: url,
    Node: parsed.window.Node,
    Element: parsed.window.Element,
    HTMLElement: parsed.window.HTMLElement,
    Text: parsed.window.Text,
    Document: parsed.window.Document,
    DocumentFragment: parsed.window.DocumentFragment,
    ShadowRoot: parsed.window.ShadowRoot,
    Event: parsed.window.Event,
    CustomEvent: parsed.window.CustomEvent,
    MouseEvent: parsed.window.Event,
    MutationObserver: parsed.window.MutationObserver,
    DOMParser: parsed.window.DOMParser,
    Range: rangeConstructor,
    NodeFilter: { SHOW_TEXT: 4 },
    CSS: { escape: (value: string) => value.replaceAll('"', '\\"') },
    crypto: cryptoValue,
    chrome: { runtime },
  };

  for (const name of GLOBAL_NAMES) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: values[name],
    });
  }

  return () => {
    for (const name of [...GLOBAL_NAMES].reverse()) {
      const descriptor = previous.get(name);
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
  };
}

interface SessionHarness {
  runtime: FakeRuntime;
  session: PageTranslationSession;
  retries: ScheduledRetry[];
  beforeStartSettings: ExtensionSettings[];
  restoreGlobals(): void;
}

interface HarnessOptions {
  settings?: ExtensionSettings;
  loadSettings?: () => Promise<ExtensionSettings>;
  beforeStart?: (settings: ExtensionSettings) => Promise<void>;
  cachePutCompletion?: Promise<void>;
  cachePutError?: Error;
  cryptoValue?: unknown;
}

function createHarness(
  html: string,
  cacheReplies: Array<CacheEntry | null | Promise<CacheEntry | null>>,
  options: HarnessOptions = {},
): SessionHarness {
  const runtime = new FakeRuntime(
    cacheReplies,
    options.cachePutCompletion,
    options.cachePutError,
  );
  const restoreGlobals = installBrowserGlobals(html, runtime, options.cryptoValue);
  const { scheduleRetry, retries } = createRetryScheduler();
  const beforeStartSettings: ExtensionSettings[] = [];
  const settings = options.settings ?? testSettings();
  const session = createPageTranslationSession({
    loadSettings: options.loadSettings ?? (async () => settings),
    beforeStart: async (loadedSettings) => {
      beforeStartSettings.push(loadedSettings);
      await options.beforeStart?.(loadedSettings);
    },
    scheduleRetry,
  });
  return {
    runtime,
    session,
    retries,
    beforeStartSettings,
    restoreGlobals,
  };
}

function cacheEntry(paragraphs: ParagraphResult[]): CacheEntry {
  return {
    hash: "cached-hash",
    paragraphs,
    timestamp: 1,
    size: 1,
  };
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function installSingleTextNodeRange(): void {
  Object.defineProperty(document, "createRange", {
    configurable: true,
    value: () => {
      let startNode: Text | null = null;
      let startOffset = 0;
      let endNode: Text | null = null;
      let endOffset = 0;
      let insertionParent: Node | null = null;
      let insertionBefore: Node | null = null;

      return {
        setStart(node: Text, offset: number) {
          startNode = node;
          startOffset = offset;
        },
        setEnd(node: Text, offset: number) {
          endNode = node;
          endOffset = offset;
        },
        extractContents() {
          assert.ok(startNode);
          assert.strictEqual(endNode, startNode);
          const parent = startNode.parentNode;
          assert.ok(parent);
          const text = startNode.data;
          const fragment = document.createDocumentFragment();
          fragment.append(document.createTextNode(text.slice(startOffset, endOffset)));
          startNode.data = text.slice(0, startOffset);
          const tail = document.createTextNode(text.slice(endOffset));
          parent.insertBefore(tail, startNode.nextSibling);
          insertionParent = parent;
          insertionBefore = tail;
          return fragment;
        },
        insertNode(node: Node) {
          assert.ok(insertionParent);
          insertionParent.insertBefore(node, insertionBefore);
        },
      } as unknown as Range;
    },
  });
}

function runtimeRequests(runtime: FakeRuntime, type: string): Array<Record<string, unknown>> {
  return runtime.requests.filter(
    (message): message is Record<string, unknown> =>
      typeof message === "object" && message !== null && message.type === type,
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function sourceElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[id^='source-']"));
}

function translationBlocks(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".paperlens-translation"));
}

function blockErrors(): string[] {
  return translationBlocks().map(
    (block) => block.querySelector("span")?.textContent ?? "",
  );
}

function retryButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".paperlens-retry-btn"),
  );
}

function progressText(): string | null {
  const widget = document.querySelector<HTMLElement>("#paperlens-token-widget");
  return widget?.shadowRoot?.querySelector(".progress-text")?.textContent ?? null;
}

function assertDormantDom(): void {
  assert.equal(document.querySelectorAll("[data-paperlens-id]").length, 0);
  assert.equal(translationBlocks().length, 0);
  assert.equal(document.querySelector("#paperlens-token-widget"), null);
}

test("an exact-cardinality cache hit finalizes adjacent blocks on the original connected sources", async () => {
  const cachedParagraphs: ParagraphResult[] = [
    { translation: "첫 번째 번역", alignment: [] },
    { translation: "두 번째 번역", alignment: [] },
  ];
  const harness = createHarness(articleHtml(), [cacheEntry(cachedParagraphs)]);
  const sources = [
    document.querySelector<HTMLElement>("#source-1")!,
    document.querySelector<HTMLElement>("#source-2")!,
  ];

  try {
    await harness.session.toggle();

    assert.equal(harness.beforeStartSettings.length, 1);
    assert.equal(runtimeRequests(harness.runtime, "cache/get").length, 1);
    assert.equal(harness.runtime.connectCalls.length, 0);
    assert.deepEqual(
      sources.map((source) => source.nextElementSibling?.textContent),
      ["첫 번째 번역", "두 번째 번역"],
    );
    sources.forEach((source, index) => {
      assert.strictEqual(document.querySelector(`#source-${index + 1}`), source);
      assert.equal(source.isConnected, true);
      assert.strictEqual(source.ownerDocument, document);
      assert.equal(source.nextElementSibling?.classList.contains("paperlens-skeleton"), false);
    });
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("shorter and longer cache arrays both miss and open exactly one Port", async () => {
  for (const paragraphs of [
    [{ translation: "only one", alignment: [] }],
    [
      { translation: "one", alignment: [] },
      { translation: "two", alignment: [] },
      { translation: "unexpected third", alignment: [] },
    ],
  ] satisfies ParagraphResult[][]) {
    const harness = createHarness(articleHtml(), [cacheEntry(paragraphs)]);
    harness.runtime.queuePort();
    const togglePromise = harness.session.toggle();

    try {
      await waitFor(
        () => harness.runtime.connectedPorts.length === 1,
        "the cache-cardinality miss to connect",
      );
      assert.equal(runtimeRequests(harness.runtime, "cache/get").length, 1);
      assert.equal(harness.runtime.connectCalls.length, 1);
      assert.equal(harness.runtime.connectedPorts.length, 1);
      assert.equal(harness.runtime.connectedPorts[0].postedMessages.length, 1);
    } finally {
      harness.session.reset();
      try {
        await togglePromise;
      } finally {
        harness.restoreGlobals();
      }
    }
  }
});

test("malformed cache payloads miss and settle the existing skeletons through one Port", async () => {
  const invalidEntries = [
    {
      hash: "missing-paragraphs",
      timestamp: 1,
      size: 1,
    },
    {
      hash: "non-array-paragraphs",
      paragraphs: "not-an-array",
      timestamp: 1,
      size: 1,
    },
    {
      hash: "malformed-paragraph",
      paragraphs: [
        { translation: 42, alignment: [] },
        { translation: "second cached translation", alignment: [] },
      ],
      timestamp: 1,
      size: 1,
    },
    {
      hash: "malformed-alignment",
      paragraphs: [
        {
          translation: "first cached translation",
          alignment: [{ original: FIRST_TEXT, translated: 42 }],
        },
        { translation: "second cached translation", alignment: [] },
      ],
      timestamp: 1,
      size: 1,
    },
  ] as unknown as CacheEntry[];

  for (const entry of invalidEntries) {
    const harness = createHarness(articleHtml(), [entry]);
    const port = harness.runtime.queuePort();
    let toggleError: unknown;
    const togglePromise = harness.session.toggle().catch((error: unknown) => {
      toggleError = error;
    });

    try {
      await waitFor(
        () => port.postedMessages.length === 1 || toggleError !== undefined,
        `${entry.hash} stream or failure`,
      );
      assert.equal(toggleError, undefined, `${entry.hash} must be treated as a cache miss`);
      assert.equal(harness.runtime.connectCalls.length, 1);
      translationBlocks().forEach((block) => {
        assert.equal(block.classList.contains("paperlens-skeleton"), true);
      });

      port.emitMessage({
        type: "stream-section-done",
        paragraphs: [
          { translation: `${entry.hash} first`, alignment: [] },
          { translation: `${entry.hash} second`, alignment: [] },
        ],
        usage: { inputTokens: 8, outputTokens: 4 },
      });
      await togglePromise;

      assert.deepEqual(
        translationBlocks().map((block) => block.textContent),
        [`${entry.hash} first`, `${entry.hash} second`],
      );
      translationBlocks().forEach((block) => {
        assert.equal(block.classList.contains("paperlens-skeleton"), false);
      });
    } finally {
      harness.session.reset();
      await togglePromise;
      harness.restoreGlobals();
    }
  }
});

test("a cache miss creates every skeleton before streaming and caches positional results on completion", async () => {
  const harness = createHarness(articleHtml([FIRST_TEXT, SECOND_TEXT, THIRD_TEXT]), [null]);
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();
  const sources = [1, 2, 3].map(
    (index) => document.querySelector<HTMLElement>(`#source-${index}`)!,
  );
  const streamedParagraphs: ParagraphResult[] = [
    { translation: "position one", alignment: [] },
    { translation: "position two", alignment: [] },
    { translation: "position three", alignment: [] },
  ];

  try {
    await waitFor(() => port.postedMessages.length === 1, "the section stream request");

    const skeletons = sources.map((source) => source.nextElementSibling as HTMLElement);
    skeletons.forEach((block, index) => {
      assert.equal(block.classList.contains("paperlens-skeleton"), true);
      assert.strictEqual(sources[index].nextElementSibling, block);
      assert.equal(
        block.getAttribute("data-paperlens-block"),
        sources[index].getAttribute("data-paperlens-id"),
      );
    });
    assert.deepEqual(port.postedMessages[0], {
      type: "stream/translate-section",
      paragraphTexts: [FIRST_TEXT, SECOND_TEXT, THIRD_TEXT],
      paragraphIds: sources.map((source) => source.getAttribute("data-paperlens-id")),
      customPrompt: "Translate faithfully.",
    });

    port.emitMessage({
      type: "stream-section-done",
      paragraphs: streamedParagraphs,
      usage: { inputTokens: 30, outputTokens: 12 },
    });
    await togglePromise;

    assert.deepEqual(
      skeletons.map((block) => block.textContent),
      ["position one", "position two", "position three"],
    );
    skeletons.forEach((block) => {
      assert.equal(block.classList.contains("paperlens-skeleton"), false);
    });
    assert.equal(port.disconnectCount, 1);
    const cacheGets = runtimeRequests(harness.runtime, "cache/get");
    const cachePuts = runtimeRequests(harness.runtime, "cache/put");
    assert.equal(cachePuts.length, 1);
    assert.deepEqual(
      (cachePuts[0].entry as CacheEntry).paragraphs,
      streamedParagraphs,
    );
    assert.equal(
      (cachePuts[0].entry as CacheEntry).hash,
      cacheGets[0].hash,
    );
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("reset cleans owned aligned nodes even while their article subtree is detached", async () => {
  const settings = { ...testSettings(), cacheEnabled: false };
  const harness = createHarness(articleHtml(), [], { settings });
  installSingleTextNodeRange();
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();
  const article = document.querySelector<HTMLElement>("article")!;
  const sources = sourceElements();
  const originalTexts = sources.map((source) => source.textContent);

  try {
    await waitFor(() => port.postedMessages.length === 1, "the aligned request");
    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [
        {
          translation: "Aligned first translation.",
          alignment: [{
            original: FIRST_TEXT,
            translated: "Aligned first translation.",
          }],
        },
        {
          translation: "Aligned second translation.",
          alignment: [{
            original: SECOND_TEXT,
            translated: "Aligned second translation.",
          }],
        },
      ],
      usage: { inputTokens: 8, outputTokens: 4 },
    });
    await togglePromise;

    const blocks = translationBlocks();
    assert.equal(article.querySelectorAll(".paperlens-sentence").length, 4);
    assert.equal(article.querySelectorAll("[data-paperlens-pair]").length, 4);
    article.querySelectorAll(".paperlens-sentence").forEach((span) => {
      span.classList.add("paperlens-highlight");
    });

    article.remove();
    harness.session.reset();
    document.body.append(article);

    sources.forEach((source, index) => {
      assert.strictEqual(document.querySelector(`#source-${index + 1}`), source);
      assert.equal(source.textContent, originalTexts[index]);
      assert.equal(source.hasAttribute("data-paperlens-id"), false);
      assert.equal(source.hasAttribute("data-paperlens-pair"), false);
    });
    blocks.forEach((block) => {
      assert.equal(block.parentNode, null);
      assert.equal(block.hasAttribute("data-paperlens-pair"), false);
    });
    assert.equal(article.querySelectorAll(".paperlens-translation").length, 0);
    assert.equal(article.querySelectorAll(".paperlens-sentence").length, 0);
    assert.equal(article.querySelectorAll(".paperlens-highlight").length, 0);
    assert.equal(article.querySelectorAll("[data-paperlens-pair]").length, 0);
  } finally {
    harness.session.reset();
    await togglePromise;
    harness.restoreGlobals();
  }
});

test("two toggles during an open stream hide and show the same blocks and widget without restarting work", async () => {
  const harness = createHarness(articleHtml(), [null]);
  const port = harness.runtime.queuePort();
  const initialToggle = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the open stream request");
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>(".paperlens-translation"),
    );
    const widget = document.querySelector<HTMLElement>("#paperlens-token-widget")!;
    assert.equal(blocks.length, 2);
    assert.ok(widget);

    await harness.session.toggle();
    assert.deepEqual(blocks.map((block) => block.style.display), ["none", "none"]);
    assert.equal(widget.style.display, "none");

    await harness.session.toggle();
    const shownBlocks = Array.from(
      document.querySelectorAll<HTMLElement>(".paperlens-translation"),
    );
    assert.deepEqual(blocks.map((block) => block.style.display), ["", ""]);
    shownBlocks.forEach((block, index) => assert.strictEqual(block, blocks[index]));
    assert.strictEqual(document.querySelector("#paperlens-token-widget"), widget);
    assert.equal(widget.style.display, "");

    assert.equal(runtimeRequests(harness.runtime, "cache/get").length, 1);
    assert.equal(harness.runtime.connectCalls.length, 1);
    assert.equal(port.postedMessages.length, 1);
    assert.equal(port.disconnectCount, 0);
  } finally {
    harness.session.reset();
    try {
      await initialToggle;
    } finally {
      harness.restoreGlobals();
    }
  }
});

test("the first 429 retries after 2,000 ms with the same paragraph IDs and blocks", async () => {
  const harness = createHarness(articleHtml(), [null]);
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    const sources = sourceElements();
    const ids = sources.map((source) => source.getAttribute("data-paperlens-id"));
    const blocks = translationBlocks();
    const firstRequest = port.postedMessages[0];

    port.emitMessage({ type: "stream-error", error: "429 rate limited" });

    assert.equal(harness.retries.length, 1);
    assert.equal(harness.retries[0].delayMs, 2_000);
    harness.retries[0].run();

    assert.equal(port.postedMessages.length, 2);
    assert.deepEqual(port.postedMessages[1], firstRequest);
    assert.deepEqual(
      sources.map((source) => source.getAttribute("data-paperlens-id")),
      ids,
    );
    assert.equal(translationBlocks().length, sources.length);
    sources.forEach((source, index) => {
      assert.strictEqual(source.nextElementSibling, blocks[index]);
    });
  } finally {
    harness.session.reset();
    await togglePromise;
    harness.restoreGlobals();
  }
});

test("a 401 schedules no automatic retry and gives only the first sibling a retry button", async () => {
  const settings = { ...testSettings(), cacheEnabled: false };
  const harness = createHarness(articleHtml(), [], { settings });
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    port.emitMessage({ type: "stream-error", error: "401 unauthorized" });
    await togglePromise;

    assert.equal(harness.retries.length, 0);
    assert.deepEqual(blockErrors(), [
      "[Error: 401 unauthorized]",
      "[Error: 401 unauthorized]",
    ]);
    assert.equal(retryButtons().length, 1);
    assert.equal(retryButtons()[0].disabled, false);
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("provider configuration and authentication errors are terminal with one working retry button", async () => {
  const terminalMessages = [
    "Gemini API key is not configured.",
    "OpenAI API key is not configured.",
    "Vertex API key is not configured.",
    "Unauthorized provider response",
    "Authentication failed for the selected provider",
    "Invalid API key supplied",
    "HTTP 403",
    "Forbidden by provider policy",
  ];

  for (const error of terminalMessages) {
    const settings = { ...testSettings(), cacheEnabled: false };
    const harness = createHarness(articleHtml(), [], { settings });
    const port = harness.runtime.queuePort();
    const togglePromise = harness.session.toggle();

    try {
      await waitFor(() => port.postedMessages.length === 1, `${error} request`);
      port.emitMessage({ type: "stream-error", error });
      await Promise.resolve();

      assert.equal(harness.retries.length, 0, error);
      await togglePromise;
      assert.deepEqual(blockErrors(), [`[Error: ${error}]`, `[Error: ${error}]`]);
      assert.equal(retryButtons().length, 1, error);
      assert.equal(retryButtons()[0].disabled, false, error);
    } finally {
      harness.session.reset();
      await togglePromise;
      harness.restoreGlobals();
    }
  }
});

test("retry exhaustion settles every sibling with one working retry button", async () => {
  const settings = { ...testSettings(), cacheEnabled: false };
  const harness = createHarness(articleHtml(), [], { settings });
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    for (let attempt = 0; attempt < 3; attempt++) {
      port.emitMessage({ type: "stream-error", error: "503 unavailable" });
      assert.equal(harness.retries.length, attempt + 1);
      harness.retries[attempt].run();
    }
    port.emitMessage({ type: "stream-error", error: "503 unavailable" });
    await togglePromise;

    assert.deepEqual(
      harness.retries.map((retry) => retry.delayMs),
      [2_000, 4_000, 8_000],
    );
    assert.equal(port.postedMessages.length, 4);
    assert.deepEqual(blockErrors(), [
      "[Error: 503 unavailable]",
      "[Error: 503 unavailable]",
    ]);
    assert.equal(retryButtons().length, 1);
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("clicking retry reuses every source ID and block while opening a fresh Port", async () => {
  const settings = { ...testSettings(), cacheEnabled: false };
  const harness = createHarness(articleHtml(), [], { settings });
  const firstPort = harness.runtime.queuePort();
  const secondPort = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => firstPort.postedMessages.length === 1, "the initial request");
    const sources = sourceElements();
    const ids = sources.map((source) => source.getAttribute("data-paperlens-id"));
    const blocks = translationBlocks();

    firstPort.emitMessage({ type: "stream-error", error: "401 unauthorized" });
    await togglePromise;
    retryButtons()[0].dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(() => secondPort.postedMessages.length === 1, "the manual retry request");

    assert.deepEqual(
      sources.map((source) => source.getAttribute("data-paperlens-id")),
      ids,
    );
    assert.equal(translationBlocks().length, blocks.length);
    blocks.forEach((block, index) => {
      assert.strictEqual(translationBlocks()[index], block);
      assert.strictEqual(sources[index].nextElementSibling, block);
      assert.equal(block.classList.contains("paperlens-skeleton"), true);
      assert.equal(block.classList.contains("paperlens-error"), false);
      assert.equal(block.textContent, "Translating...");
    });
    assert.equal(harness.runtime.connectCalls.length, 2);
    assert.deepEqual(secondPort.postedMessages[0], firstPort.postedMessages[0]);

    secondPort.emitMessage({
      type: "stream-section-done",
      paragraphs: [
        { translation: "retried first", alignment: [] },
        { translation: "retried second", alignment: [] },
      ],
      usage: { inputTokens: 8, outputTokens: 4 },
    });
    await waitFor(() => secondPort.disconnected, "the manual retry completion");

    assert.deepEqual(
      blocks.map((block) => block.textContent),
      ["retried first", "retried second"],
    );
    assert.equal(progressText(), "1 / 1");
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("an unexpected disconnect settles every skeleton as interrupted with one retry button", async () => {
  const settings = { ...testSettings(), cacheEnabled: false };
  const harness = createHarness(articleHtml(), [], { settings });
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    port.emitDisconnect();
    await togglePromise;

    assert.deepEqual(blockErrors(), [
      "[Error: Translation interrupted]",
      "[Error: Translation interrupted]",
    ]);
    assert.equal(retryButtons().length, 1);
    translationBlocks().forEach((block) => {
      assert.equal(block.classList.contains("paperlens-skeleton"), false);
    });
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("a short section result finalizes returned paragraphs and marks every unmatched tail missing", async () => {
  const settings = { ...testSettings(), cacheEnabled: false };
  const harness = createHarness(
    articleHtml([FIRST_TEXT, SECOND_TEXT, THIRD_TEXT]),
    [],
    { settings },
  );
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [{ translation: "only returned translation", alignment: [] }],
      usage: { inputTokens: 10, outputTokens: 3 },
    });
    await togglePromise;

    const blocks = translationBlocks();
    assert.equal(blocks[0].textContent, "only returned translation");
    assert.deepEqual(blockErrors().slice(1), [
      "[Error: Translation missing for this paragraph]",
      "[Error: Translation missing for this paragraph]",
    ]);
    blocks.forEach((block) => {
      assert.equal(block.classList.contains("paperlens-skeleton"), false);
    });
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("reset during settings load prevents every later session side effect", async () => {
  const pendingSettings = deferred<ExtensionSettings>();
  const harness = createHarness(articleHtml(), [], {
    loadSettings: () => pendingSettings.promise,
  });
  const togglePromise = harness.session.toggle();

  try {
    harness.session.reset();
    pendingSettings.resolve(testSettings());
    await togglePromise;

    assert.equal(harness.beforeStartSettings.length, 0);
    assert.equal(harness.runtime.requests.length, 0);
    assert.equal(harness.runtime.connectCalls.length, 0);
    assertDormantDom();
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("reset during beforeStart prevents IDs, blocks, widget, cache, and Port work", async () => {
  const pendingBeforeStart = deferred<void>();
  const harness = createHarness(articleHtml(), [], {
    beforeStart: () => pendingBeforeStart.promise,
  });
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(
      () => harness.beforeStartSettings.length === 1,
      "the pending beforeStart hook",
    );
    harness.session.reset();
    pendingBeforeStart.resolve(undefined);
    await togglePromise;

    assert.equal(harness.runtime.requests.length, 0);
    assert.equal(harness.runtime.connectCalls.length, 0);
    assertDormantDom();
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("reset while hashing prevents the late digest from reaching cache or Port work", async () => {
  const pendingDigest = deferred<ArrayBuffer>();
  let digestCalls = 0;
  const cryptoValue = {
    subtle: {
      digest: () => {
        digestCalls++;
        return pendingDigest.promise;
      },
    },
  };
  const harness = createHarness(articleHtml(), [], { cryptoValue });
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => digestCalls === 1, "the pending hash digest");
    harness.session.reset();
    pendingDigest.resolve(new Uint8Array(32).buffer);
    await togglePromise;

    assert.equal(harness.runtime.requests.length, 0);
    assert.equal(harness.runtime.connectCalls.length, 0);
    assertDormantDom();
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("reset during cache get ignores the late miss and never opens a Port", async () => {
  const pendingCache = deferred<CacheEntry | null>();
  const harness = createHarness(articleHtml(), [pendingCache.promise]);
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(
      () => runtimeRequests(harness.runtime, "cache/get").length === 1,
      "the pending cache get",
    );
    harness.session.reset();
    pendingCache.resolve(null);
    await togglePromise;

    assert.equal(harness.runtime.connectCalls.length, 0);
    assertDormantDom();
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("reset during cache put ignores its late continuation", async () => {
  const pendingCachePut = deferred<void>();
  const harness = createHarness(articleHtml(), [null], {
    cachePutCompletion: pendingCachePut.promise,
  });
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [
        { translation: "first", alignment: [] },
        { translation: "second", alignment: [] },
      ],
      usage: { inputTokens: 8, outputTokens: 4 },
    });
    await waitFor(
      () => runtimeRequests(harness.runtime, "cache/put").length === 1,
      "the pending cache put",
    );
    harness.session.reset();
    pendingCachePut.resolve(undefined);
    await togglePromise;
    await Promise.resolve();

    assertDormantDom();
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("a rejected cache put is best-effort and cannot strand successful settlement", async () => {
  const harness = createHarness(articleHtml(), [null], {
    cachePutError: new Error("cache storage unavailable"),
  });
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [
        { translation: "first persisted result", alignment: [] },
        { translation: "second persisted result", alignment: [] },
      ],
      usage: { inputTokens: 8, outputTokens: 4 },
    });

    await waitFor(() => port.disconnected, "cache rejection settlement");
    await togglePromise;

    assert.deepEqual(
      translationBlocks().map((block) => block.textContent),
      ["first persisted result", "second persisted result"],
    );
    assert.equal(progressText(), "1 / 1");
    assert.equal(port.disconnectCount, 1);
    assert.equal(harness.runtime.connectCalls.length, 1);
  } finally {
    harness.session.reset();
    await togglePromise;
    harness.restoreGlobals();
  }
});

test("reset still settles a terminal stream whose Port disconnected during cache put", async () => {
  const pendingCachePut = deferred<void>();
  const harness = createHarness(articleHtml(), [null], {
    cachePutCompletion: pendingCachePut.promise,
  });
  const port = harness.runtime.queuePort();
  let toggleSettled = false;
  const togglePromise = harness.session.toggle().then(() => {
    toggleSettled = true;
  });

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [
        { translation: "first", alignment: [] },
        { translation: "second", alignment: [] },
      ],
      usage: { inputTokens: 8, outputTokens: 4 },
    });
    await waitFor(
      () => runtimeRequests(harness.runtime, "cache/put").length === 1,
      "the pending cache put",
    );
    port.emitDisconnect();
    assert.deepEqual(
      translationBlocks().map((block) => block.textContent),
      ["first", "second"],
    );
    harness.session.reset();
    await waitFor(() => toggleSettled, "reset to settle the detached Port owner");

    assert.equal(toggleSettled, true);
    assertDormantDom();
  } finally {
    pendingCachePut.resolve(undefined);
    await togglePromise;
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("reset cancels retry ownership and rejects a dequeued callback plus late Port events", async () => {
  const settings = { ...testSettings(), cacheEnabled: false };
  const harness = createHarness(articleHtml(), [], { settings });
  const port = harness.runtime.queuePort();
  const togglePromise = harness.session.toggle();

  try {
    await waitFor(() => port.postedMessages.length === 1, "the initial request");
    port.emitMessage({ type: "stream-error", error: "429 rate limited" });
    assert.equal(harness.retries.length, 1);

    harness.session.reset();
    assert.equal(harness.retries[0].cancelled, true);
    assert.equal(port.disconnected, true);

    harness.retries[0].forceRun();
    port.emitLateMessage({
      type: "stream-section-done",
      paragraphs: [
        { translation: "late first", alignment: [] },
        { translation: "late second", alignment: [] },
      ],
      usage: { inputTokens: 99, outputTokens: 99 },
    });
    port.emitLateDisconnect();
    await togglePromise;

    assert.equal(port.postedMessages.length, 1);
    assert.equal(runtimeRequests(harness.runtime, "cache/put").length, 0);
    assertDormantDom();
  } finally {
    harness.session.reset();
    harness.restoreGlobals();
  }
});

test("completion, failure, and disconnect callbacks never advance one section beyond 1 / 1", async () => {
  for (const terminal of ["completion", "failure", "disconnect"] as const) {
    const settings = { ...testSettings(), cacheEnabled: false };
    const harness = createHarness(articleHtml(), [], { settings });
    const port = harness.runtime.queuePort();
    const togglePromise = harness.session.toggle();

    try {
      await waitFor(() => port.postedMessages.length === 1, `${terminal} request`);
      if (terminal === "completion") {
        port.emitMessage({
          type: "stream-section-done",
          paragraphs: [
            { translation: "first", alignment: [] },
            { translation: "second", alignment: [] },
          ],
          usage: { inputTokens: 8, outputTokens: 4 },
        });
      } else if (terminal === "failure") {
        port.emitMessage({ type: "stream-error", error: "401 unauthorized" });
      } else {
        port.emitDisconnect();
      }
      await togglePromise;
      assert.equal(progressText(), "1 / 1");

      port.emitLateMessage({ type: "stream-error", error: "late failure" });
      port.emitLateMessage({
        type: "stream-section-done",
        paragraphs: [
          { translation: "late first", alignment: [] },
          { translation: "late second", alignment: [] },
        ],
        usage: { inputTokens: 99, outputTokens: 99 },
      });
      port.emitLateDisconnect();
      assert.equal(progressText(), "1 / 1");
    } finally {
      harness.session.reset();
      harness.restoreGlobals();
    }
  }
});
