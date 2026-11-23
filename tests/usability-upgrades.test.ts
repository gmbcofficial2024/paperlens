import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  enableCrossHighlight,
  unwrapSentenceSpans,
  wrapSentences,
} from "../src/content/highlight";
import { createPageReadingSession } from "../src/content/page-reading-session";
import {
  createSummaryBlock,
  finalizeSummaryBlock,
  formatSummaryReadingNote,
  removeSummaryBlock,
} from "../src/content/summary-block";
import {
  destroyWidget,
  setWidgetFontScale,
  setWidgetReadingMode,
  showWidget,
} from "../src/content/token-widget";
import { createPageTranslationSession } from "../src/content/translation-session";
import { createOptionsSettingsEditSession } from "../src/options/settings-edit-session";
import type { RuntimeRequest, RuntimeResponse } from "../src/shared/messages";
import { buildSystemPrompt, parseGlossary } from "../src/shared/prompts";
import { runtimeRequestError, translationConfigurationKey } from "../src/shared/runtime-policy";
import { defaultSettings, mergeSettings } from "../src/shared/schema";
import { extractStreamingParagraphTranslations } from "../src/shared/translation-json";
import type { ExtensionSettings } from "../src/shared/types";

type Listener = (...args: never[]) => void;

class FakeChromeEvent<T extends Listener> {
  readonly listeners = new Set<T>();
  addListener(listener: T): void { this.listeners.add(listener); }
  removeListener(listener: T): void { this.listeners.delete(listener); }
}

class FakePort {
  readonly name = "paperlens-stream";
  readonly onMessage = new FakeChromeEvent<(message: never) => void>();
  readonly onDisconnect = new FakeChromeEvent<() => void>();
  readonly postedMessages: unknown[] = [];
  disconnected = false;

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  emitMessage(message: unknown): void {
    if (this.disconnected) return;
    for (const listener of this.onMessage.listeners) listener(message as never);
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const listener of this.onDisconnect.listeners) listener();
  }
}

function installTestGlobals(html: string, ports: FakePort[], innerHeight = 0) {
  const parsed = parseHTML(html);
  const url = new URL("https://www.nature.com/articles/s41586-026-00001-1");
  Object.defineProperty(parsed.window, "location", { configurable: true, value: url });
  Object.defineProperty(parsed.window, "innerHeight", { configurable: true, value: innerHeight });

  const names = [
    "document", "window", "location", "Node", "Element", "HTMLElement",
    "Text", "Document", "DocumentFragment", "ShadowRoot", "Event",
    "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver",
    "DOMParser", "Range", "NodeFilter", "CSS", "crypto", "chrome",
  ] as const;

  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of names) previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));

  const runtime = {
    id: "paperlens-usability-test",
    connect: () => {
      const port = new FakePort();
      ports.push(port);
      return port as unknown as chrome.runtime.Port;
    },
    sendMessage: (_msg: unknown, cb?: (resp: unknown) => void) => {
      queueMicrotask(() => cb?.({ ok: true, entry: null }));
    },
  };

  const values: Record<(typeof names)[number], unknown> = {
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
    KeyboardEvent: parsed.window.Event,
    MutationObserver: parsed.window.MutationObserver,
    DOMParser: parsed.window.DOMParser,
    Range: parsed.document.createRange().constructor,
    NodeFilter: { SHOW_TEXT: 4 },
    CSS: { escape: (v: string) => v.replaceAll('"', '\\"') },
    crypto: webcrypto,
    chrome: { runtime },
  };
  for (const name of names) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
  }

  return () => {
    destroyWidget();
    removeSummaryBlock();
    for (const name of [...names].reverse()) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

function testSettings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    ...defaultSettings(),
    cacheEnabled: false,
    maxConcurrency: 1,
    ...overrides,
  };
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test("extractStreamingParagraphTranslations streams live paragraphs without colliding with nested alignment", () => {
  assert.deepEqual(
    extractStreamingParagraphTranslations('```json\n{"paragraphs":[{"translation":"강유전체 박막의 누설 전류'),
    ["강유전체 박막의 누설 전류"],
  );
  // Dangling escape sequence at the tail must not throw or corrupt output
  assert.deepEqual(
    extractStreamingParagraphTranslations('{"paragraphs":[{"translation":"수식 \\u00'),
    ["수식 "],
  );
  // Nested "translated" inside alignment must not overwrite paragraph slots
  const midSecond =
    '{"paragraphs":[{"translation":"첫 문단 번역.","alignment":[{"original":"First.","translated":"첫 문단 번역."}]},{"translation":"두 번째 문단 진행 중';
  assert.deepEqual(extractStreamingParagraphTranslations(midSecond), [
    "첫 문단 번역.",
    "두 번째 문단 진행 중",
  ]);
});

test("incremental streaming renders partial paragraphs before stream-section-done and finalizes cleanly", async () => {
  const ports: FakePort[] = [];
  const restore = installTestGlobals(
    `<html><body><article>
      <p id="p1">First scientific paragraph describing the controlled measurement protocol.</p>
      <p id="p2">Second scientific paragraph reporting stable switching endurance across cycles.</p>
    </article></body></html>`,
    ports,
  );
  const session = createPageTranslationSession({
    loadSettings: async () => testSettings(),
    beforeStart: async () => undefined,
    scheduleRetry: () => () => undefined,
  });

  try {
    const togglePromise = session.toggle();
    await waitFor(() => ports[0]?.postedMessages.length === 1, "streaming request");
    const port = ports[0];

    port.emitMessage({ type: "stream-chunk", delta: '{"paragraphs":[{"translation":"첫 번째 ' });
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(".paperlens-translation"));
    assert.equal(blocks[0].textContent, "첫 번째 ");
    assert.equal(blocks[0].classList.contains("paperlens-streaming"), true);
    assert.equal(blocks[0].classList.contains("paperlens-skeleton"), false);
    assert.equal(blocks[1].classList.contains("paperlens-skeleton"), true);

    port.emitMessage({
      type: "stream-chunk",
      delta: '과학 문단.","alignment":[]},{"translation":"두 번째 과학 문단',
    });
    assert.equal(blocks[0].textContent, "첫 번째 과학 문단.");
    assert.equal(blocks[1].textContent, "두 번째 과학 문단");

    port.emitMessage({
      type: "stream-section-done",
      paragraphs: [
        { translation: "첫 번째 과학 문단.", alignment: [] },
        { translation: "두 번째 과학 문단.", alignment: [] },
      ],
    });
    await togglePromise;

    assert.equal(blocks[0].classList.contains("paperlens-streaming"), false);
    assert.equal(blocks[1].classList.contains("paperlens-streaming"), false);
    assert.equal(blocks[1].textContent, "두 번째 과학 문단.");
  } finally {
    session.reset();
    restore();
  }
});

test("viewport-first prioritization translates visible sections first and splits first large batch to 3 paragraphs", async () => {
  const ports: FakePort[] = [];
  const pTags = Array.from({ length: 6 }, (_, i) =>
    `<p id="s2-p${i + 1}">Visible section paragraph ${i + 1} with controlled measurements.</p>`,
  ).join("");
  const restore = installTestGlobals(
    `<html><body><article>
      <section><h2>Above</h2><p id="s1">Scrolled above viewport paragraph with prior measurements.</p></section>
      <section><h2>Visible</h2>${pTags}</section>
      <section><h2>Below</h2><p id="s3">Below viewport paragraph discussing future work.</p></section>
    </article></body></html>`,
    ports,
    800,
  );

  // Assign deterministic layout rects: s1 above (-500), s2 visible (100..500), s3 below (1200)
  const rectMap: Record<string, { top: number; bottom: number; height: number }> = {
    s1: { top: -500, bottom: -450, height: 50 },
    "s2-p1": { top: 100, bottom: 150, height: 50 },
    "s2-p2": { top: 170, bottom: 220, height: 50 },
    "s2-p3": { top: 240, bottom: 290, height: 50 },
    "s2-p4": { top: 310, bottom: 360, height: 50 },
    "s2-p5": { top: 380, bottom: 430, height: 50 },
    "s2-p6": { top: 450, bottom: 500, height: 50 },
    s3: { top: 1200, bottom: 1250, height: 50 },
  };
  for (const [id, rect] of Object.entries(rectMap)) {
    const el = document.getElementById(id)!;
    Object.defineProperty(el, "getBoundingClientRect", { value: () => rect });
  }

  const session = createPageTranslationSession({
    loadSettings: async () => testSettings({ maxConcurrency: 1 }),
    beforeStart: async () => undefined,
    scheduleRetry: () => () => undefined,
  });

  try {
    const togglePromise = session.toggle();
    const receivedBatches: string[][] = [];

    for (let idx = 0; idx < 4; idx += 1) {
      await waitFor(() => ports[idx]?.postedMessages.length === 1, `batch ${idx}`);
      const req = ports[idx].postedMessages[0] as { paragraphTexts: string[] };
      receivedBatches.push(req.paragraphTexts);
      ports[idx].emitMessage({
        type: "stream-section-done",
        paragraphs: req.paragraphTexts.map((t) => ({ translation: `KR:${t}`, alignment: [] })),
      });
    }
    await togglePromise;

    assert.equal(receivedBatches[0].length, 3, "first visible batch should fast-start with 3 paragraphs");
    assert.ok(receivedBatches[0][0].includes("paragraph 1"));
    assert.equal(receivedBatches[1].length, 3, "second visible batch finishes remaining 3 visible paragraphs");
    assert.ok(receivedBatches[1][0].includes("paragraph 4"));
    assert.ok(receivedBatches[2][0].includes("Below viewport"), "below-viewport batch runs before scrolled-above batch");
    assert.ok(receivedBatches[3][0].includes("Scrolled above"), "above-viewport batch runs last");
  } finally {
    session.reset();
    restore();
  }
});

test("stop cancels remaining work, preserves completed translations, and exposes accurate session status", async () => {
  const ports: FakePort[] = [];
  const restore = installTestGlobals(
    `<html><body><article>
      <section><h2>One</h2><p id="p1">First section with measurable switching stability.</p></section>
      <section><h2>Two</h2><p id="p2">Second section waiting for translation.</p></section>
    </article></body></html>`,
    ports,
  );
  const session = createPageTranslationSession({
    loadSettings: async () => testSettings({ maxConcurrency: 1 }),
    beforeStart: async () => undefined,
    scheduleRetry: () => () => undefined,
  });

  try {
    const togglePromise = session.toggle();
    await waitFor(() => ports[0]?.postedMessages.length === 1, "first section request");
    assert.equal(session.getStatus().inProgress, true);
    ports[0].emitMessage({
      type: "stream-section-done",
      paragraphs: [{ translation: "첫 번째 완료 번역", alignment: [] }],
    });

    await waitFor(() => ports[1]?.postedMessages.length === 1, "second section request");
    session.stop();
    await togglePromise;

    assert.equal(ports[1].disconnected, true, "in-flight port must disconnect on stop");
    assert.equal(session.getStatus().inProgress, false);
    assert.equal(session.getStatus().active, true);
    const remainingBlocks = Array.from(document.querySelectorAll(".paperlens-translation"));
    assert.equal(remainingBlocks.length, 1, "unresolved skeleton must be removed while keeping completed block");
    assert.equal(remainingBlocks[0].textContent, "첫 번째 완료 번역");
    assert.ok(document.getElementById("paperlens-page-toast"), "page toast confirms stop");
  } finally {
    session.reset();
    restore();
  }
});

test("click-to-pin highlights sentence pair across mouseout and clears on Escape or second click", () => {
  const ports: FakePort[] = [];
  const restore = installTestGlobals(
    `<html><body><article>
      <p id="orig" data-paperlens-id="pl-0-0">First sentence with <a id="cite" href="#r1">citation</a>. Second sentence here.</p>
      <div id="trans" class="paperlens-translation" data-paperlens-block="pl-0-0">첫 번째 문장. 두 번째 문장.</div>
    </article></body></html>`,
    ports,
  );
  try {
    const orig = document.getElementById("orig")!;
    const trans = document.getElementById("trans")!;
    wrapSentences(orig, trans, [
      { original: "First sentence with citation.", translated: "첫 번째 문장." },
      { original: "Second sentence here.", translated: "두 번째 문장." },
    ]);
    enableCrossHighlight();

    const firstOrigSpan = orig.querySelector('[data-sentence-idx="0"]')!;
    const firstTransSpan = trans.querySelector('[data-sentence-idx="0"]')!;
    firstOrigSpan.dispatchEvent(new Event("click", { bubbles: true }));
    assert.equal(firstOrigSpan.classList.contains("paperlens-highlight-pinned"), true);
    assert.equal(firstTransSpan.classList.contains("paperlens-highlight-pinned"), true);

    // Clicking a citation <a> must not alter pin state
    const citeLink = document.getElementById("cite")!;
    citeLink.dispatchEvent(new Event("click", { bubbles: true }));
    assert.equal(firstTransSpan.classList.contains("paperlens-highlight-pinned"), true);

    // Pressing Escape unpins
    const esc = new Event("keydown", { bubbles: true }) as unknown as { key: string };
    esc.key = "Escape";
    document.dispatchEvent(esc as unknown as Event);
    assert.equal(firstOrigSpan.classList.contains("paperlens-highlight-pinned"), false);
    assert.equal(firstTransSpan.classList.contains("paperlens-highlight-pinned"), false);

    // Clicking again toggles pin on then off
    firstTransSpan.dispatchEvent(new Event("click", { bubbles: true }));
    assert.equal(firstOrigSpan.classList.contains("paperlens-highlight-pinned"), true);
    firstTransSpan.dispatchEvent(new Event("click", { bubbles: true }));
    assert.equal(firstOrigSpan.classList.contains("paperlens-highlight-pinned"), false);
    unwrapSentenceSpans();
  } finally {
    restore();
  }
});

test("HUD reading mode and font scale update document attributes cleanly", () => {
  const ports: FakePort[] = [];
  const restore = installTestGlobals("<html><body><article><p>Body text.</p></article></body></html>", ports);
  try {
    showWidget();
    setWidgetReadingMode("focus");
    assert.equal(document.documentElement.getAttribute("data-paperlens-reading-mode"), "focus");
    setWidgetFontScale("lg");
    assert.equal(document.documentElement.getAttribute("data-paperlens-font-scale"), "lg");
    setWidgetReadingMode("bilingual");
    setWidgetFontScale("md");
    assert.equal(document.documentElement.getAttribute("data-paperlens-reading-mode"), null);
    assert.equal(document.documentElement.getAttribute("data-paperlens-font-scale"), null);
  } finally {
    restore();
  }
});

test("summary card supports Obsidian note copy with metadata and close button cleanup", async () => {
  const ports: FakePort[] = [];
  const restore = installTestGlobals(
    `<html><head>
      <meta name="citation_title" content="HZO Reliability Study">
      <meta name="citation_doi" content="10.1038/s41586-026-00001-1">
    </head><body><article><p id="src">Measured switching response remained stable.</p></article></body></html>`,
    ports,
  );
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let copied = "";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text: string) => { copied = text; } } },
  });
  let closedCount = 0;

  try {
    const note = formatSummaryReadingNote({
      title: "HZO Reliability Study",
      url: "https://www.nature.com/articles/s41586-026-00001-1",
      doi: "10.1038/s41586-026-00001-1",
      kind: "paper",
      summary: "## 1. 핵심 요약\n안정적인 스위칭을 확인했다.",
      clippedDate: "2026-11-23",
    });
    assert.match(note, /^---\ntitle: "HZO Reliability Study"/);
    assert.match(note, /doi: "10\.1038\/s41586-026-00001-1"/);
    assert.match(note, /# HZO Reliability Study/);

    const block = createSummaryBlock({
      insertionAnchor: document.getElementById("src")!,
      onClose: () => { closedCount += 1; },
    });
    finalizeSummaryBlock(block, "## 1. 핵심 요약\n안정적인 스위칭을 확인했다.");
    block.querySelector<HTMLButtonElement>(".paperlens-summary-copy-note")!.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.match(copied, /doi: "10\.1038\/s41586-026-00001-1"/);
    assert.match(copied, /안정적인 스위칭을 확인했다\./);

    block.querySelector<HTMLButtonElement>(".paperlens-summary-close")!.click();
    assert.equal(closedCount, 1);
    assert.equal(document.getElementById("paperlens-paper-summary"), null);
  } finally {
    if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
    else Reflect.deleteProperty(globalThis, "navigator");
    restore();
  }
});

test("glossary entries inject into system prompt, bust translation config key, and enforce runtime auth on new tab actions", async () => {
  const rawGlossary = "# Semiconductor terms\nferroelectric => 강유전체\nHZO\nwake-up effect: 웨이크업 효과";
  const entries = parseGlossary(rawGlossary);
  assert.deepEqual(entries, [
    { source: "ferroelectric", target: "강유전체" },
    { source: "HZO", target: null },
    { source: "wake-up effect", target: "웨이크업 효과" },
  ]);

  const prompt = buildSystemPrompt("Keep units.", rawGlossary);
  assert.match(prompt, /<glossary>/);
  assert.match(prompt, /- ferroelectric => 강유전체/);
  assert.match(prompt, /- HZO \(keep verbatim in English\)/);
  assert.match(prompt, /- wake-up effect => 웨이크업 효과/);

  const base = defaultSettings();
  const withGlossary = mergeSettings({ ...base, glossary: rawGlossary });
  assert.notEqual(
    await translationConfigurationKey(base),
    await translationConfigurationKey(withGlossary),
  );

  // Security boundary: tabs/page-status and tabs/stop-translate require an extension page
  assert.ok(runtimeRequestError({ type: "tabs/page-status" }, { id: "paperlens", tab: { id: 1 } }, "paperlens"));
  assert.ok(runtimeRequestError({ type: "tabs/stop-translate" }, { id: "paperlens", tab: { id: 1 } }, "paperlens"));
  const popupSender = { id: "paperlens", url: "chrome-extension://paperlens/popup.html" };
  assert.equal(runtimeRequestError({ type: "tabs/page-status" }, popupSender, "paperlens"), null);
  assert.equal(runtimeRequestError({ type: "tabs/stop-translate" }, popupSender, "paperlens"), null);
});

test("options page supports glossary persistence, password visibility toggles, domain presets, and unsaved indicator", async () => {
  const html = await readFile("options.html", "utf8");
  const parsed = parseHTML(html);
  const selectProto = Object.getPrototypeOf(parsed.document.createElement("select")) as object;
  Object.defineProperty(selectProto, "value", {
    configurable: true,
    get(this: HTMLSelectElement): string {
      return Array.from(this.options).find((o) => o.selected)?.value ?? "";
    },
    set(this: HTMLSelectElement, value: string) {
      Array.from(this.options).forEach((o) => o.removeAttribute("selected"));
      const selected = Array.from(this.options).find((o) => o.value === value);
      if (selected) selected.selected = true;
    },
  });
  Object.defineProperty(parsed.window, "setTimeout", { configurable: true, value: () => 0 });

  const initial = defaultSettings();
  initial.glossary = "ferroelectric => 강유전체";
  const updates: ExtensionSettings[] = [];
  const sendMessage = (async (message: RuntimeRequest): Promise<RuntimeResponse> => {
    if (message.type === "settings/get") return { ok: true, settings: initial };
    if (message.type === "settings/update") {
      updates.push(message.settings);
      return { ok: true, settings: message.settings };
    }
    return { ok: true } as RuntimeResponse;
  }) as typeof import("../src/shared/messages").sendRuntimeMessage;

  const session = createOptionsSettingsEditSession({
    document: parsed.document as unknown as Document,
    sendMessage,
    permissions: {
      contains: (_p, cb) => cb(true),
      request: (_p, cb) => cb(true),
    },
  });
  await session.start();

  const doc = parsed.document;
  const glossaryEl = doc.getElementById("glossary") as HTMLTextAreaElement;
  const unsavedEl = doc.getElementById("unsaved-indicator")!;
  assert.equal(glossaryEl.value, "ferroelectric => 강유전체");
  assert.equal(unsavedEl.classList.contains("hidden"), true);

  // Password show/hide toggle
  const apiKeyInput = doc.getElementById("api-key") as HTMLInputElement;
  const toggleBtn = doc.querySelector<HTMLButtonElement>('[data-toggle-password="api-key"]')!;
  assert.equal(apiKeyInput.type, "password");
  toggleBtn.dispatchEvent(new parsed.window.Event("click", { bubbles: true }));
  assert.equal(apiKeyInput.type, "text");
  assert.equal(toggleBtn.textContent, "Hide");

  // Domain preset appends instruction and marks unsaved
  const presetBtn = doc.querySelector<HTMLButtonElement>(".prompt-preset-btn")!;
  presetBtn.dispatchEvent(new parsed.window.Event("click", { bubbles: true }));
  const customPrompt = doc.getElementById("custom-prompt") as HTMLTextAreaElement;
  assert.ok(customPrompt.value.length > 0);
  assert.equal(unsavedEl.classList.contains("hidden"), false);

  // Edit glossary and save
  glossaryEl.value = "ferroelectric => 강유전체\nHZO";
  glossaryEl.dispatchEvent(new parsed.window.Event("input", { bubbles: true }));
  doc.getElementById("save-btn")!.dispatchEvent(new parsed.window.Event("click", { bubbles: true }));
  await waitFor(() => updates.length === 1, "options glossary save");

  assert.equal(updates[0].glossary, "ferroelectric => 강유전체\nHZO");
  await waitFor(() => unsavedEl.classList.contains("hidden"), "unsaved badge clears after save");
});

test("PageReadingSession reports live status including summary presence and stop action", async () => {
  const ports: FakePort[] = [];
  const restore = installTestGlobals(
    `<html><body><article><h1>Study</h1><p id="p1">Measured current remained constant after cycling.</p></article></body></html>`,
    ports,
  );
  const sendRuntimeMessage = (async (req: RuntimeRequest): Promise<RuntimeResponse> => {
    if (req.type === "settings/get") return { ok: true, settings: testSettings() };
    if (req.type === "summary/generate") return { ok: true, result: { summary: "요약 결과" } };
    return { ok: false, error: "unexpected" };
  }) as typeof import("../src/shared/messages").sendRuntimeMessage;

  const session = createPageReadingSession({
    sendRuntimeMessage,
    scheduleRetry: () => () => undefined,
  });

  try {
    assert.equal(session.getStatus().hasSummary, false);
    await session.summarize();
    assert.equal(session.getStatus().hasSummary, true);
    assert.equal(session.getStatus().summaryRunning, false);

    document.querySelector<HTMLButtonElement>(".paperlens-summary-close")!.click();
    assert.equal(session.getStatus().hasSummary, false);
  } finally {
    session.reset();
    restore();
  }
});
