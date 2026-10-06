import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { parseHTML } from "linkedom";
import type { ExtensionSettings } from "../src/shared/types";

type Listener = (...args: any[]) => any;

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
  readonly onMessage = new FakeChromeEvent<(message: unknown) => void>();
  readonly onDisconnect = new FakeChromeEvent<() => void>();
  readonly postedMessages: unknown[] = [];
  disconnected = false;

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  emitMessage(message: unknown): void {
    for (const listener of this.onMessage.listeners) {
      listener(message);
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
  request: { type: "summary/generate"; title?: string; articleText: string };
  responded: boolean;
  respond(response: unknown): void;
}

class FakeRuntime {
  readonly id = "paperlens-entrypoint-test";
  readonly onMessage = new FakeChromeEvent<(
    message: { type?: string },
    sender: unknown,
    sendResponse: (response: unknown) => void,
  ) => void>();
  readonly summaryCalls: PendingSummary[] = [];
  readonly ports: FakePort[] = [];
  readonly requests: Array<{ type?: string; title?: string; articleText?: string }> = [];
  lastError: { message?: string } | undefined;

  constructor(private readonly settings: ExtensionSettings) {}

  sendMessage = (
    message: { type?: string; title?: string; articleText?: string },
    callback?: (response: unknown) => void,
  ): void => {
    this.requests.push(message);
    if (!callback) return;
    if (message.type === "settings/get") {
      queueMicrotask(() => callback({ ok: true, settings: this.settings }));
      return;
    }
    if (message.type === "summary/generate") {
      const request = message as PendingSummary["request"];
      const call: PendingSummary = {
        request,
        responded: false,
        respond(response: unknown) {
          if (call.responded) return;
          call.responded = true;
          queueMicrotask(() => callback(response));
        },
      };
      this.summaryCalls.push(call);
      return;
    }
    queueMicrotask(() => callback({
      ok: false,
      error: `Unexpected runtime request: ${message.type}`,
    }));
  };

  connect = (): chrome.runtime.Port => {
    const port = new FakePort();
    this.ports.push(port);
    return port as unknown as chrome.runtime.Port;
  };

  dispatch(message: { type: string }): void {
    for (const listener of this.onMessage.listeners) {
      listener(message, {}, () => undefined);
    }
  }

  getURL(path: string): string {
    return `chrome-extension://${this.id}/${path}`;
  }

  getManifest(): chrome.runtime.Manifest {
    return { manifest_version: 3, name: "PaperLens test", version: "1.0.0" };
  }
}

class FakeNavigation {
  private readonly successListeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === "navigatesuccess") this.successListeners.add(listener);
  }

  emitSuccess(): void {
    for (const listener of this.successListeners) listener();
  }
}

const GLOBAL_NAMES = [
  "document",
  "window",
  "location",
  "navigation",
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

function settings(): ExtensionSettings {
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
      autoGenerate: false,
      prompt: "Summarize faithfully.",
    },
  };
}

function installGlobals(runtime: FakeRuntime, fakeNavigation: FakeNavigation): {
  location: URL;
  restore(): void;
} {
  const parsed = parseHTML(`
    <html>
      <head><title>Page A</title></head>
      <body>
        <article>
          <h1>Page A</h1>
          <p id="page-a-source">Page A contains enough scientific detail to summarize and translate.</p>
        </article>
      </body>
    </html>
  `);
  const pageLocation = new URL("https://journal.example/page-a");
  Object.defineProperty(parsed.window, "location", {
    configurable: true,
    value: pageLocation,
  });
  Object.defineProperty(parsed.window, "navigation", {
    configurable: true,
    value: fakeNavigation,
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
    navigation: fakeNavigation,
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

  return {
    location: pageLocation,
    restore() {
      for (const name of [...GLOBAL_NAMES].reverse()) {
        const descriptor = previous.get(name);
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    },
  };
}

async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
}

async function flushTasks(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await flushTasks(1);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test("entrypoint routes page actions and resets only accepted replacement navigation", async () => {
  const runtime = new FakeRuntime(settings());
  const fakeNavigation = new FakeNavigation();
  const globals = installGlobals(runtime, fakeNavigation);

  try {
    await import("../src/content/index");

    runtime.dispatch({ type: "summarize-paper" });
    await waitFor(() => runtime.summaryCalls.length === 1, "page A summary request");
    assert.equal(runtime.summaryCalls[0].request.title, "Page A");
    runtime.summaryCalls[0].respond({
      ok: true,
      result: {
        summary: "Page A summary",
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    });
    await waitFor(
      () => document.querySelector(".paperlens-summary-body")?.textContent === "Page A summary",
      "page A summary UI",
    );

    runtime.dispatch({ type: "toggle-translate" });
    await waitFor(() => runtime.ports.length === 1, "page A translation Port");
    const pageAPort = runtime.ports[0];
    await waitFor(() => pageAPort.postedMessages.length === 1, "page A translation request");
    pageAPort.emitMessage({
      type: "stream-section-done",
      paragraphs: [{ translation: "Page A translation", alignment: [] }],
      usage: { inputTokens: 11, outputTokens: 5 },
    });
    await waitFor(
      () => document.querySelector<HTMLElement>("#paperlens-token-widget")
        ?.shadowRoot?.querySelector(".progress-text")?.textContent === "1 / 1",
      "page A translation widget",
    );

    const pageASummaryBlock = document.querySelector<HTMLElement>(
      "#paperlens-paper-summary",
    )!;
    const pageATranslationBlock = document.querySelector<HTMLElement>(
      ".paperlens-translation",
    )!;
    const pageAWidget = document.querySelector<HTMLElement>("#paperlens-token-widget")!;
    assert.equal(pageATranslationBlock.textContent, "Page A translation");
    assert.equal(pageAWidget.shadowRoot?.querySelector(".input-tokens")?.textContent, "18");
    assert.equal(pageAWidget.shadowRoot?.querySelector(".output-tokens")?.textContent, "8");
    assert.equal(
      runtime.requests.filter((request) => request.type === "settings/get").length,
      1,
    );

    globals.location.hash = "#results";
    fakeNavigation.emitSuccess();
    assert.strictEqual(document.querySelector("#paperlens-paper-summary"), pageASummaryBlock);
    assert.strictEqual(document.querySelector(".paperlens-translation"), pageATranslationBlock);
    assert.strictEqual(document.querySelector("#paperlens-token-widget"), pageAWidget);
    assert.equal(runtime.summaryCalls.length, 1);
    assert.equal(runtime.ports.length, 1);

    globals.location.href = "https://journal.example/page-b";
    fakeNavigation.emitSuccess();
    assert.equal(pageASummaryBlock.parentNode, null);
    assert.equal(pageATranslationBlock.parentNode, null);
    assert.equal(pageAWidget.parentNode, null);

    document.title = "Page B";
    document.body.innerHTML = `
      <article>
        <h1>Page B</h1>
        <p id="page-b-source">Page B contains distinct scientific evidence for a replacement action.</p>
      </article>
    `;
    runtime.dispatch({ type: "summarize-paper" });
    await waitFor(() => runtime.summaryCalls.length === 2, "page B summary request");
    assert.equal(runtime.summaryCalls[1].request.title, "Page B");
    assert.equal(
      runtime.requests.filter((request) => request.type === "settings/get").length,
      2,
      "replacement page must reload settings",
    );
    runtime.summaryCalls[1].respond({
      ok: true,
      result: {
        summary: "Page B summary",
        usage: { inputTokens: 2, outputTokens: 1 },
      },
    });
    await waitFor(
      () => document.querySelector(".paperlens-summary-body")?.textContent === "Page B summary",
      "page B summary UI",
    );
  } finally {
    for (const call of runtime.summaryCalls) {
      call.respond({ ok: false, error: "test cleanup" });
    }
    for (let round = 0; round < 5; round++) {
      await flushTasks(2);
      for (const port of runtime.ports) port.disconnect();
    }
    await flushMicrotasks(20);
    window.dispatchEvent(new window.Event("pagehide"));
    globals.restore();
  }
});
