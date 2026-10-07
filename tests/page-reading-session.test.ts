import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  createPageReadingSession,
  type PageReadingSession,
} from "../src/content/page-reading-session";
import type {
  RuntimeRequest,
  RuntimeResponse,
  sendRuntimeMessage,
} from "../src/shared/messages";
import type { ExtensionSettings } from "../src/shared/types";
import { NATURE_MAGAZINE_HEADER } from "./fixtures/reading/nature-magazine-header";

type Listener = (...args: never[]) => void;

class FakeChromeEvent<T extends Listener> {
  readonly listeners = new Set<T>();

  addListener(listener: T): void {
    this.listeners.add(listener);
  }

  removeListener(listener: T): void {
    this.listeners.delete(listener);
  }
}

class FakePort {
  readonly name = "paperlens-stream";
  readonly onMessage = new FakeChromeEvent<(message: never) => void>();
  readonly onDisconnect = new FakeChromeEvent<() => void>();
  readonly postedMessages: unknown[] = [];
  disconnected = false;

  postMessage(message: unknown): void {
    assert.equal(this.disconnected, false, "cannot post to a disconnected Port");
    this.postedMessages.push(message);
  }

  emitMessage(message: unknown): void {
    if (this.disconnected) return;
    for (const listener of this.onMessage.listeners) {
      listener(message as never);
    }
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const listener of this.onDisconnect.listeners) {
      listener();
    }
  }
}

interface PendingSummary {
  request: Extract<RuntimeRequest, { type: "summary/generate" }>;
  promise: Promise<RuntimeResponse>;
  respond(response: RuntimeResponse): void;
}

interface PendingSettings {
  promise: Promise<RuntimeResponse>;
  respond(settings: ExtensionSettings): void;
}

class FakeRuntime {
  readonly id = "paperlens-page-reading-test";
  readonly onMessage = new FakeChromeEvent<Listener>();
  readonly requests: RuntimeRequest[] = [];
  readonly settingsCalls: PendingSettings[] = [];
  readonly summaryCalls: PendingSummary[] = [];
  readonly ports: FakePort[] = [];
  lastError: { message?: string } | undefined;
  private settingsReadsDeferred = false;

  constructor(private settingsValue: ExtensionSettings) {}

  setSettings(settings: ExtensionSettings): void {
    this.settingsValue = settings;
  }

  deferSettingsReads(): void {
    this.settingsReadsDeferred = true;
  }

  send = ((message: RuntimeRequest): Promise<RuntimeResponse> => {
    this.requests.push(message);
    if (message.type === "settings/get") {
      if (this.settingsReadsDeferred) {
        let respond!: (settings: ExtensionSettings) => void;
        const promise = new Promise<RuntimeResponse>((resolve) => {
          respond = (settings) => resolve({ ok: true, settings });
        });
        this.settingsCalls.push({ promise, respond });
        return promise;
      }
      return Promise.resolve({ ok: true, settings: this.settingsValue });
    }
    if (message.type === "summary/generate") {
      let respond!: (response: RuntimeResponse) => void;
      const promise = new Promise<RuntimeResponse>((resolve) => {
        respond = resolve;
      });
      this.summaryCalls.push({ request: message, promise, respond });
      return promise;
    }
    return Promise.resolve({
      ok: false,
      error: `Unexpected runtime request: ${message.type}`,
    });
  }) as typeof sendRuntimeMessage;

  connect = (): chrome.runtime.Port => {
    const port = new FakePort();
    this.ports.push(port);
    return port as unknown as chrome.runtime.Port;
  };

  sendMessage = (
    message: { type?: string },
    callback?: (response: unknown) => void,
  ): void => {
    queueMicrotask(() => callback?.({
      ok: false,
      error: `Unexpected direct runtime request: ${message.type}`,
    }));
  };

  getURL(path: string): string {
    return `chrome-extension://${this.id}/${path}`;
  }

  getManifest(): chrome.runtime.Manifest {
    return { manifest_version: 3, name: "PaperLens test", version: "1.0.0" };
  }
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

function settings(autoGenerate = true): ExtensionSettings {
  return {
    currentProvider: "gemini",
    providerSettings: {
      gemini: {},
      vertex: {},
      openai: {},
      anthropic: {},
      custom: {},
    },
    cacheEnabled: false,
    maxConcurrency: 1,
    customPrompt: "Translate faithfully.",
    summary: {
      provider: "gemini",
      autoGenerate,
      prompt: "Summarize faithfully.",
    },
  };
}

function pageHtml(title: string): string {
  return `
    <html>
      <head><title>${title}</title></head>
      <body>
        <article>
          <h1>${title}</h1>
          <p id="source">${title} contains enough scientific detail to summarize and translate.</p>
        </article>
      </body>
    </html>
  `;
}

function installGlobals(runtime: FakeRuntime, title = "Page A"): () => void {
  const parsed = parseHTML(pageHtml(title));
  const pageLocation = new URL(`https://journal.example/${title.toLowerCase().replaceAll(" ", "-")}`);
  Object.defineProperty(parsed.window, "location", {
    configurable: true,
    value: pageLocation,
  });

  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of GLOBAL_NAMES) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }

  const rangeConstructor = parsed.document.createRange().constructor;
  const values: Record<(typeof GLOBAL_NAMES)[number], unknown> = {
    document: parsed.document,
    window: parsed.window,
    location: pageLocation,
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
    crypto: webcrypto,
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

interface Harness {
  runtime: FakeRuntime;
  session: PageReadingSession;
  restore(): void;
}

function createHarness(initialSettings = settings()): Harness {
  const runtime = new FakeRuntime(initialSettings);
  const restoreGlobals = installGlobals(runtime);
  const session = createPageReadingSession({
    sendRuntimeMessage: runtime.send,
    scheduleRetry: () => () => undefined,
  });
  return {
    runtime,
    session,
    restore() {
      session.reset();
      restoreGlobals();
    },
  };
}

function countRequests(runtime: FakeRuntime, type: RuntimeRequest["type"]): number {
  return runtime.requests.filter((request) => request.type === type).length;
}

function replacePage(title: string): void {
  document.title = title;
  document.body.innerHTML = `
    <article>
      <h1>${title}</h1>
      <p id="source">${title} contains replacement scientific evidence for the reader.</p>
    </article>
  `;
}

function widgetValue(selector: string): string | null {
  return document
    .querySelector<HTMLElement>("#paperlens-token-widget")
    ?.shadowRoot?.querySelector(selector)?.textContent ?? null;
}

async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (performance.now() < deadline) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  if (condition()) return;
  assert.fail(`Timed out waiting for ${label}`);
}

function delayNativeDigest(delayMs: number): () => void {
  const subtle = crypto.subtle;
  const previous = Object.getOwnPropertyDescriptor(subtle, "digest");
  const digest = subtle.digest.bind(subtle);
  Object.defineProperty(subtle, "digest", {
    configurable: true,
    value: async (...args: Parameters<SubtleCrypto["digest"]>) => {
      // Hashing completes on a native async boundary. CI can take longer than
      // hundreds of rapid setImmediate turns before that result is ready.
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return digest(...args);
    },
  });
  return () => {
    if (previous) Object.defineProperty(subtle, "digest", previous);
    else Reflect.deleteProperty(subtle, "digest");
  };
}

test("reading session preserves article header and scientific footer in both provider payloads without changing original prose", async () => {
  const harness = createHarness(settings(false));
  try {
    document.head.innerHTML = '<title>Device stability study</title><meta name="citation_title" content="Device stability study">';
    document.body.innerHTML = `<main>
      <header class="site-header" role="banner"><h1>Publisher portal</h1><p id="masthead">Browse our journal subscriptions and publishing services.</p></header>
      <header class="article-header" role="banner"><h1>Device stability study</h1><p id="lead">The response is stable.</p></header>
      <article><h2>Results</h2><p id="body">The same devices retained their <em id="scientific-term">switching response</em> after repeated pulses.</p>
        <footer role="contentinfo"><h2>Conclusions</h2><p id="conclusion">The effect disappeared after cooling.</p>
          <section role="doc-endnotes"><h2>Footnotes</h2><p id="condition">Reported currents were normalized to device area at 0.2 V.</p></section>
          <nav><p id="inline-nav">Share this article and browse related publications.</p></nav>
        </footer>
      </article>
      <footer role="contentinfo"><p id="site-footer-copy">Visit our corporate policies and partner publications.</p></footer>
    </main>`;
    const scientificNodes = ["lead", "body", "conclusion", "condition"].map((id) => {
      const node = document.getElementById(id)!;
      return { node, innerHTML: node.innerHTML, outerHTML: node.outerHTML, children: [...node.childNodes] };
    });
    const expectedTexts = scientificNodes.map(({ node }) => node.textContent!);
    const excludedTexts = ["masthead", "inline-nav", "site-footer-copy"]
      .map((id) => document.getElementById(id)!.textContent!);
    const scientificTerm = document.getElementById("scientific-term")!;

    const summary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "header and footer summary request");
    const summaryRequest = harness.runtime.summaryCalls[0].request;
    assert.equal(summaryRequest.title, "Device stability study");
    assert.equal(summaryRequest.sourceScope, "loaded-page");
    let previousPosition = -1;
    for (const text of expectedTexts) {
      const position = summaryRequest.articleText.indexOf(text);
      assert.ok(position > previousPosition, `Summary omitted or reordered scientific prose: ${text}`);
      assert.equal(summaryRequest.articleText.split(text).length, 2, "Scientific prose must appear once");
      previousPosition = position;
    }
    for (const text of excludedTexts) assert.equal(summaryRequest.articleText.includes(text), false);
    for (const original of scientificNodes) assert.equal(original.node.outerHTML, original.outerHTML);
    harness.runtime.summaryCalls[0].respond({ ok: true, result: { summary: "Scientific summary" } });
    await summary;

    const translation = harness.session.toggleTranslation();
    let translationFinished = false;
    void translation.then(
      () => { translationFinished = true; },
      () => { translationFinished = true; },
    );
    const translatedTexts: string[] = [];
    let portIndex = 0;
    while (!translationFinished) {
      await waitFor(
        () => translationFinished || harness.runtime.ports[portIndex]?.postedMessages.length === 1,
        "header and footer translation request",
      );
      if (translationFinished) break;
      const port = harness.runtime.ports[portIndex++];
      const request = port.postedMessages[0] as { type: string; paragraphTexts: string[] };
      assert.equal(request.type, "stream/translate-section");
      translatedTexts.push(...request.paragraphTexts);
      port.emitMessage({
        type: "stream-section-done",
        paragraphs: request.paragraphTexts.map((text) => ({ translation: `Translated: ${text}`, alignment: [] })),
      });
    }
    await translation;
    assert.deepEqual(translatedTexts, expectedTexts);
    assert.equal(document.querySelectorAll(".paperlens-translation").length, expectedTexts.length);
    for (const original of scientificNodes) {
      assert.strictEqual(document.getElementById(original.node.id), original.node);
      assert.equal(original.node.innerHTML, original.innerHTML);
      assert.deepEqual([...original.node.childNodes], original.children);
      assert.ok(original.node.nextElementSibling?.classList.contains("paperlens-translation"));
    }
    assert.strictEqual(document.getElementById("scientific-term"), scientificTerm);
    for (const id of ["masthead", "inline-nav", "site-footer-copy"]) {
      assert.equal(document.getElementById(id)!.hasAttribute("data-paperlens-id"), false);
    }
    harness.session.reset();
    for (const original of scientificNodes) {
      assert.strictEqual(document.getElementById(original.node.id), original.node);
      assert.equal(original.node.outerHTML, original.outerHTML);
    }
  } finally {
    harness.runtime.summaryCalls.forEach((call) => call.respond({ ok: false, error: "cleanup" }));
    harness.restore();
  }
});

test("Nature magazine header stays out of both provider payloads while title and original scientific nodes survive", async () => {
  const harness = createHarness(settings(false));
  try {
    location.hostname = "www.nature.com";
    document.head.innerHTML = "<title>Von Neumann's party | Nature</title>";
    document.body.innerHTML = `<main><article>${NATURE_MAGAZINE_HEADER}
      <div class="c-article-body"><p id="scientific-body">The same devices retained their <em id="scientific-term">switching response</em> after repeated pulses.</p></div>
      <footer><p id="scientific-footer">Measurements were taken at 0.2 V.</p></footer></article></main>`;
    const header = document.getElementById("reported-header")!;
    const headerHTML = header.outerHTML;
    const title = header.querySelector("h1")!;
    const scientificTerm = document.getElementById("scientific-term")!;
    const originals = ["scientific-body", "scientific-footer"].map((id) => {
      const node = document.getElementById(id)!;
      return { node, innerHTML: node.innerHTML, outerHTML: node.outerHTML, children: [...node.childNodes] };
    });
    const expectedTexts = originals.map(({ node }) => node.textContent!);

    const summary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "Nature magazine summary request");
    const summaryRequest = harness.runtime.summaryCalls[0].request;
    harness.runtime.summaryCalls[0].respond({ ok: true, result: { summary: "Scientific source summary" } });
    await summary;

    const translation = harness.session.toggleTranslation();
    let translationFinished = false;
    void translation.then(
      () => { translationFinished = true; },
      () => { translationFinished = true; },
    );
    const translatedTexts: string[] = [];
    let portIndex = 0;
    while (!translationFinished) {
      await waitFor(
        () => translationFinished || harness.runtime.ports[portIndex]?.postedMessages.length === 1,
        "Nature magazine translation request",
      );
      if (translationFinished) break;
      const port = harness.runtime.ports[portIndex++];
      const request = port.postedMessages[0] as { paragraphTexts: string[] };
      translatedTexts.push(...request.paragraphTexts);
      port.emitMessage({
        type: "stream-section-done",
        paragraphs: request.paragraphTexts.map((text) => ({ translation: `Translated: ${text}`, alignment: [] })),
      });
    }
    await translation;

    assert.equal(summaryRequest.title, "Von Neumann's party");
    const headerTexts = ["A tricky question.", "Von Neumann's party", "FUTURES", "02 October 2026", "Example Writer", "The author writes", "Author website", "View author publications", "Search author on", "PubMed", "Google Scholar"];
    assert.deepEqual({
      summary: headerTexts.filter((text) => summaryRequest.articleText.includes(text)),
      translation: headerTexts.filter((text) => translatedTexts.some((paragraph) => paragraph.includes(text))),
    }, { summary: [], translation: [] }, "Nature magazine header entered provider payloads");
    assert.deepEqual(translatedTexts, expectedTexts);
    assert.ok(summaryRequest.articleText.indexOf(expectedTexts[0]) >= 0);
    assert.ok(summaryRequest.articleText.indexOf(expectedTexts[1]) > summaryRequest.articleText.indexOf(expectedTexts[0]));
    assert.equal(document.querySelectorAll(".paperlens-translation").length, expectedTexts.length);
    assert.strictEqual(document.getElementById("reported-header"), header);
    assert.strictEqual(header.querySelector("h1"), title);
    assert.equal(header.outerHTML, headerHTML);
    assert.strictEqual(document.getElementById("scientific-term"), scientificTerm);
    for (const original of originals) {
      assert.strictEqual(document.getElementById(original.node.id), original.node);
      assert.equal(original.node.innerHTML, original.innerHTML);
      assert.deepEqual([...original.node.childNodes], original.children);
    }
    harness.session.reset();
    for (const original of originals) assert.equal(original.node.outerHTML, original.outerHTML);
    assert.equal(header.outerHTML, headerHTML);
  } finally {
    harness.runtime.summaryCalls.forEach((call) => call.respond({ ok: false, error: "cleanup" }));
    harness.restore();
  }
});

test("Frontiers reading session translates scientific source and summarizes only the available abstract", async () => {
  const harness = createHarness(settings(false));
  const scientificText = "Physical dynamics can implement energy-efficient computation. The reported comparison preserves the measured values.";
  try {
    location.hostname = "www.frontiersin.org";
    document.head.innerHTML = '<title>Frontiers | Computation principles</title><meta name="citation_title" content="Computation principles">';
    document.body.innerHTML = `<div class="ArticleDetailsV4"><aside class="ArticleDetailsV4__asideLeft"><article class="CardJournal"><p>Published in</p><p>4 impact factor</p></article></aside>
      <main class="ArticleDetailsV4__main"><h1>Computation principles</h1>
        <div class="NotifyMeBanner"><div class="Alert__message">The final, formatted version of the article will be published soon.</div></div>
        <div class="ArticleDetailsV4__main__content"><div id="h1"><h2>Abstract</h2><p id="scientific">${scientificText}</p></div></div>
        <article class="CardA"><p>Discover our rigorous approach to peer review.</p></article>
      </main></div>`;
    const summary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "Frontiers summary request");
    const request = harness.runtime.summaryCalls[0].request;
    assert.ok(request.articleText.includes(scientificText));
    assert.doesNotMatch(request.articleText, /impact factor|peer review|published soon/);
    assert.equal(request.sourceScope, "abstract-only");
    const block = document.querySelector("#paperlens-paper-summary")!;
    assert.ok(block.closest("main"), "summary must be in the actual reading column");
    assert.doesNotMatch(block.querySelector(".paperlens-summary-scope")!.textContent ?? "", /불러오지 않은/);
    harness.runtime.summaryCalls[0].respond({ok:true,result:{summary:"초록 기준의 요약입니다."}});
    await summary;
    const translation = harness.session.toggleTranslation();
    await waitFor(() => harness.runtime.ports[0]?.postedMessages.length === 1, "Frontiers translation request");
    const translationRequest = harness.runtime.ports[0].postedMessages[0] as {paragraphTexts: string[]};
    assert.deepEqual(translationRequest.paragraphTexts,[scientificText]);
    harness.runtime.ports[0].emitMessage({type:"stream-section-done",paragraphs:[{translation:"물리적 동역학을 이용한 계산.",alignment:[]}]});
    await translation;
  } finally {
    harness.runtime.summaryCalls.forEach(call => call.respond({ok:false,error:"cleanup"}));
    harness.restore();
  }
});

test("an in-progress inline summary cannot label its own complete source as not loaded", async () => {
  const harness = createHarness(settings(false));
  try {
    const summary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "summary with source scope");
    const scopeText = document.querySelector(".paperlens-summary-scope")!.textContent ?? "";
    assert.doesNotMatch(scopeText, /불러오지 않은|일부 원문/);
    harness.runtime.summaryCalls[0].respond({ok:true,result:{summary:"Complete source summary"}});
    await summary;
  } finally {
    harness.runtime.summaryCalls.forEach(call => call.respond({ok:false,error:"cleanup"}));
    harness.restore();
  }
});

test("summary title follows the paper metadata when a separate dashboard has the first heading", async () => {
  const harness = createHarness(settings(false));
  try {
    document.head.innerHTML = '<title>Scientific study</title><meta name="citation_title" content="Scientific study">';
    document.body.innerHTML = '<main><h1>Dashboard</h1><p>Account controls.</p></main><main><h1>Scientific study</h1><p>Measured evidence belongs to this study.</p></main>';
    const summary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "metadata-matched summary");
    assert.equal(harness.runtime.summaryCalls[0].request.title,"Scientific study");
    assert.doesNotMatch(harness.runtime.summaryCalls[0].request.articleText,/Account controls/);
    harness.runtime.summaryCalls[0].respond({ok:true,result:{summary:"Study summary"}});
    await summary;
  } finally {
    harness.runtime.summaryCalls.forEach(call => call.respond({ok:false,error:"cleanup"}));
    harness.restore();
  }
});

test("new article content marks a ready summary stale without automatically buying another summary", async () => {
  const harness = createHarness(settings(false));
  try {
    const summary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "summary request");
    harness.runtime.summaryCalls[0].respond({ok: true, result: {summary: "Original summary"}});
    await summary;
    const added = document.createElement("p");
    added.textContent = "Newly loaded independent evidence changes the article conclusions.";
    document.querySelector("article")!.append(added);
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(harness.runtime.summaryCalls.length, 1);
    const notice = document.querySelector(".paperlens-summary-source-changed");
    assert.ok(notice, "the user must know the summary omits new source text");
    notice.querySelector("button")!.click();
    await waitFor(() => harness.runtime.summaryCalls.length === 2, "explicit summary refresh");
    assert.ok(harness.runtime.summaryCalls[1].request.articleText.includes(added.textContent));
    harness.runtime.summaryCalls[1].respond({ok: true, result: {summary: "Updated summary"}});
    await flushMicrotasks();
  } finally {
    harness.runtime.summaryCalls.forEach(call => call.respond({ok: false, error: "cleanup"}));
    harness.restore();
  }
});

test("dynamic article paragraphs are translated once while existing anchors stay intact", async () => {
  const harness = createHarness(settings(false));
  const restoreDigest = delayNativeDigest(25);
  try {
    const first = harness.session.toggleTranslation();
    await waitFor(() => harness.runtime.ports[0]?.postedMessages.length === 1, "initial translation");
    harness.runtime.ports[0].emitMessage({type: "stream-section-done", paragraphs: [{translation: "Original translation", alignment: []}]});
    await first;
    const added = document.createElement("p");
    added.textContent = "The effect disappeared.";
    document.querySelector("article")!.append(added);
    await new Promise(resolve => setTimeout(resolve, 400));
    await waitFor(() => harness.runtime.ports[1]?.postedMessages.length === 1, "dynamic translation");
    const request = harness.runtime.ports[1].postedMessages[0] as {paragraphTexts: string[]};
    assert.deepEqual(request.paragraphTexts, ["The effect disappeared."]);
    harness.runtime.ports[1].emitMessage({type: "stream-section-done", paragraphs: [{translation: "효과가 사라졌다.", alignment: []}]});
    await flushMicrotasks();
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(harness.runtime.ports.length, 2);
    assert.equal(document.querySelectorAll(".paperlens-translation").length, 2);
    assert.ok(document.body.textContent?.includes("Original translation"));
  } finally {
    restoreDigest();
    harness.restore();
  }
});

test("a hidden source cannot keep a visible translation or accept a late provider result", async () => {
  const harness = createHarness(settings(false));
  try {
    const translating = harness.session.toggleTranslation();
    await waitFor(() => harness.runtime.ports[0]?.postedMessages.length === 1, "translation request");
    document.getElementById("source")!.hidden = true;
    await new Promise(resolve => setTimeout(resolve, 350));
    harness.runtime.ports[0].emitMessage({type: "stream-section-done", paragraphs: [{translation: "Stale hidden translation", alignment: []}]});
    await translating;
    await flushMicrotasks();
    assert.ok(!document.querySelector(".paperlens-translation"), "hidden sources must lose their adjacent translation");
  } finally {harness.restore();}
});

test("replacement nodes with equal article text acquire fresh translation anchors", async () => {
  const harness = createHarness(settings(false));
  try {
    const translating = harness.session.toggleTranslation();
    await waitFor(() => harness.runtime.ports[0]?.postedMessages.length === 1, "first translation");
    harness.runtime.ports[0].emitMessage({type: "stream-section-done", paragraphs: [{translation: "Original translation", alignment: []}]});
    await translating;
    document.querySelector("article")!.outerHTML = '<article><h1>Page A</h1><p id="source">Page A contains enough scientific detail to summarize and translate.</p></article>';
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(harness.runtime.ports.length, 2, "replacement Live Anchors need their own translation block");
    harness.runtime.ports[1].emitMessage({type: "stream-section-done", paragraphs: [{translation: "Replacement translation", alignment: []}]});
    await flushMicrotasks();
    assert.ok(document.body.textContent?.includes("Replacement translation"));
  } finally {harness.restore();}
});

test("unrelated ticking UI cannot indefinitely postpone detection of newly loaded article text", async () => {
  const harness = createHarness(settings(false));
  let ticker: ReturnType<typeof setInterval> | undefined;
  try {
    const summary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "summary request");
    harness.runtime.summaryCalls[0].respond({ok: true, result: {summary: "Ready summary"}});
    await summary;
    const clock = document.createElement("div");
    document.body.append(clock);
    ticker = setInterval(() => {clock.textContent = String(Date.now());}, 40);
    const added = document.createElement("p");
    added.textContent = "Newly loaded evidence appears while the unrelated clock keeps changing.";
    document.querySelector("article")!.append(added);
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.ok(document.querySelector(".paperlens-summary-source-changed"));
    assert.equal(harness.runtime.summaryCalls.length, 1);
  } finally {if (ticker) clearInterval(ticker); harness.restore();}
});

test("manual summary and auto-summary share one page run", async () => {
  const harness = createHarness(settings(true));
  const manualSummary = harness.session.summarize();

  try {
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "manual summary request");
    const translation = harness.session.toggleTranslation();
    await flushMicrotasks();

    assert.equal(countRequests(harness.runtime, "settings/get"), 1);
    assert.equal(harness.runtime.summaryCalls.length, 1);
    assert.equal(harness.runtime.ports.length, 0);

    harness.runtime.summaryCalls[0].respond({
      ok: true,
      result: {
        summary: "Shared page summary",
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    });
    await manualSummary;
    await waitFor(() => harness.runtime.ports.length === 1, "translation after shared summary");
    const port = harness.runtime.ports[0];
    await waitFor(() => port.postedMessages.length === 1, "translation request");
    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [{ translation: "Shared translation", alignment: [] }],
      usage: { inputTokens: 11, outputTokens: 5 },
    });
    await translation;
  } finally {
    for (const summary of harness.runtime.summaryCalls) {
      summary.respond({ ok: false, error: "test cleanup" });
    }
    harness.restore();
  }
});

test("reset rejects an old summary after a replacement page starts", async () => {
  const harness = createHarness(settings(false));
  const pageASummary = harness.session.summarize();

  try {
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "page A summary request");
    const pageABlock = document.querySelector<HTMLElement>("#paperlens-paper-summary")!;
    harness.session.reset();
    assert.equal(pageABlock.parentNode, null);

    replacePage("Page B");
    const pageBSummary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 2, "page B summary request");
    const translation = harness.session.toggleTranslation();
    await waitFor(() => harness.runtime.ports.length === 1, "page B translation Port");
    const port = harness.runtime.ports[0];
    await waitFor(() => port.postedMessages.length === 1, "page B translation request");
    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [{ translation: "Page B translation", alignment: [] }],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    await translation;

    harness.runtime.summaryCalls[1].respond({
      ok: true,
      result: {
        summary: "Page B summary",
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    });
    await pageBSummary;

    const pageBBlock = document.querySelector<HTMLElement>("#paperlens-paper-summary")!;
    assert.equal(
      pageBBlock.querySelector(".paperlens-summary-body")?.textContent,
      "Page B summary",
    );
    assert.equal(widgetValue(".input-tokens"), "7");
    assert.equal(widgetValue(".output-tokens"), "3");

    harness.runtime.summaryCalls[0].respond({
      ok: true,
      result: {
        summary: "Late page A summary",
        usage: { inputTokens: 101, outputTokens: 51 },
      },
    });
    await pageASummary;
    await flushMicrotasks();

    assert.strictEqual(document.querySelector("#paperlens-paper-summary"), pageBBlock);
    assert.equal(
      pageBBlock.querySelector(".paperlens-summary-body")?.textContent,
      "Page B summary",
    );
    assert.equal(widgetValue(".input-tokens"), "7");
    assert.equal(widgetValue(".output-tokens"), "3");
    assert.equal(pageABlock.parentNode, null);
  } finally {
    for (const summary of harness.runtime.summaryCalls) {
      summary.respond({ ok: false, error: "test cleanup" });
    }
    await pageASummary;
    harness.restore();
  }
});

test("settings are cached within one page and reloaded after reset", async () => {
  const harness = createHarness(settings(false));

  try {
    const firstSummary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "first summary request");
    harness.runtime.summaryCalls[0].respond({
      ok: true,
      result: { summary: "First", usage: { inputTokens: 1, outputTokens: 1 } },
    });
    await firstSummary;

    const secondSummary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 2, "second summary request");
    harness.runtime.summaryCalls[1].respond({
      ok: true,
      result: { summary: "Second", usage: { inputTokens: 1, outputTokens: 1 } },
    });
    await secondSummary;
    assert.equal(countRequests(harness.runtime, "settings/get"), 1);

    harness.session.reset();
    replacePage("Page B");
    const replacementSummary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 3, "replacement summary request");
    harness.runtime.summaryCalls[2].respond({
      ok: true,
      result: { summary: "Replacement", usage: { inputTokens: 1, outputTokens: 1 } },
    });
    await replacementSummary;
    assert.equal(countRequests(harness.runtime, "settings/get"), 2);
  } finally {
    for (const summary of harness.runtime.summaryCalls) {
      summary.respond({ ok: false, error: "test cleanup" });
    }
    harness.restore();
  }
});

test("summary usage survives translation start and combines with translation usage", async () => {
  const harness = createHarness(settings(false));

  try {
    const summary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "page summary request");
    harness.runtime.summaryCalls[0].respond({
      ok: true,
      result: {
        summary: "Page summary",
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    });
    await summary;

    const translation = harness.session.toggleTranslation();
    await waitFor(() => harness.runtime.ports.length === 1, "page translation Port");
    const port = harness.runtime.ports[0];
    await waitFor(() => port.postedMessages.length === 1, "page translation request");
    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [{ translation: "Page translation", alignment: [] }],
      usage: { inputTokens: 11, outputTokens: 5 },
    });
    await translation;

    assert.equal(widgetValue(".input-tokens"), "18");
    assert.equal(widgetValue(".output-tokens"), "8");
    assert.equal(widgetValue(".progress-text"), "1 / 1");

    harness.session.reset();
    assert.equal(document.querySelector("#paperlens-token-widget"), null);
    replacePage("Page B");

    const replacementSummary = harness.session.summarize();
    await waitFor(() => harness.runtime.summaryCalls.length === 2, "replacement summary request");
    harness.runtime.summaryCalls[1].respond({
      ok: true,
      result: {
        summary: "Replacement summary",
        usage: { inputTokens: 2, outputTokens: 1 },
      },
    });
    await replacementSummary;

    const replacementTranslation = harness.session.toggleTranslation();
    await waitFor(() => harness.runtime.ports.length === 2, "replacement translation Port");
    const replacementPort = harness.runtime.ports[1];
    await waitFor(
      () => replacementPort.postedMessages.length === 1,
      "replacement translation request",
    );
    replacementPort.emitMessage({
      type: "stream-section-done",
      paragraphs: [{ translation: "Replacement translation", alignment: [] }],
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    await replacementTranslation;

    assert.equal(widgetValue(".input-tokens"), "7");
    assert.equal(widgetValue(".output-tokens"), "3");
    assert.equal(widgetValue(".progress-text"), "1 / 1");
  } finally {
    for (const summary of harness.runtime.summaryCalls) {
      summary.respond({ ok: false, error: "test cleanup" });
    }
    harness.restore();
  }
});

test("late page settings cannot replace or clear the replacement page cache", async () => {
  const pageASettings = {
    ...settings(false),
    customPrompt: "Page A translation prompt",
  };
  const pageBSettings = {
    ...settings(false),
    customPrompt: "Page B translation prompt",
  };
  const harness = createHarness(pageASettings);
  harness.runtime.deferSettingsReads();
  const pageASummary = harness.session.summarize();

  try {
    await waitFor(() => harness.runtime.settingsCalls.length === 1, "page A settings request");
    const pageABlock = document.querySelector<HTMLElement>("#paperlens-paper-summary")!;

    harness.session.reset();
    replacePage("Page B");
    const pageBSummary = harness.session.summarize();
    await waitFor(() => harness.runtime.settingsCalls.length === 2, "page B settings request");

    harness.runtime.settingsCalls[1].respond(pageBSettings);
    await waitFor(() => harness.runtime.summaryCalls.length === 1, "page B summary request");
    assert.equal(harness.runtime.summaryCalls[0].request.title, "Page B");
    assert.equal(
      harness.runtime.summaryCalls[0].request.articleText.includes("Page A"),
      false,
    );
    harness.runtime.summaryCalls[0].respond({
      ok: true,
      result: {
        summary: "Page B summary",
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    });
    await pageBSummary;

    const pageBBlock = document.querySelector<HTMLElement>("#paperlens-paper-summary")!;
    assert.equal(
      pageBBlock.querySelector(".paperlens-summary-body")?.textContent,
      "Page B summary",
    );

    harness.runtime.settingsCalls[0].respond(pageASettings);
    await pageASummary;
    await flushMicrotasks();

    assert.equal(harness.runtime.summaryCalls.length, 1);
    assert.equal(harness.runtime.ports.length, 0);
    assert.equal(pageABlock.parentNode, null);
    assert.strictEqual(document.querySelector("#paperlens-paper-summary"), pageBBlock);
    assert.equal(document.body.textContent?.includes("Page A summary"), false);

    const pageBTranslation = harness.session.toggleTranslation();
    await waitFor(() => harness.runtime.ports.length === 1, "page B translation Port");
    const pageBPort = harness.runtime.ports[0];
    await waitFor(() => pageBPort.postedMessages.length === 1, "page B translation request");
    assert.equal(harness.runtime.settingsCalls.length, 2);
    assert.deepEqual(pageBPort.postedMessages[0], {
      type: "stream/translate-section",
      paragraphTexts: [
        "Page B contains replacement scientific evidence for the reader.",
      ],
      paragraphIds: ["pl-1-0"],
      customPrompt: "Page B translation prompt",
    });
    pageBPort.emitMessage({
      type: "stream-section-done",
      paragraphs: [{ translation: "Page B translation", alignment: [] }],
      usage: { inputTokens: 11, outputTokens: 5 },
    });
    await pageBTranslation;

    assert.equal(document.querySelector(".paperlens-translation")?.textContent, "Page B translation");
    assert.equal(widgetValue(".input-tokens"), "18");
    assert.equal(widgetValue(".output-tokens"), "8");
    assert.equal(widgetValue(".progress-text"), "1 / 1");
    assert.equal(harness.runtime.settingsCalls.length, 2);
    assert.equal(harness.runtime.summaryCalls.length, 1);
  } finally {
    for (const settingsCall of harness.runtime.settingsCalls) {
      settingsCall.respond(pageASettings);
    }
    for (const summary of harness.runtime.summaryCalls) {
      summary.respond({ ok: false, error: "test cleanup" });
    }
    await pageASummary;
    harness.restore();
  }
});
