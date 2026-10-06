import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { runInNewContext } from "node:vm";

const SETTINGS_KEY = "paperlens_settings_v1";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest";
const TRANSLATION_KEY = "synthetic-gemini-translation-key";
const SUMMARY_KEY = "synthetic-gemini-summary-key";
const translation = { translation: "Translated evidence.", alignment: [] };
let outputDir: string;
let workerSource: string;

before(async () => {
  outputDir = await mkdtemp(path.join(tmpdir(), "paperlens-distribution-worker-"));
  const built = spawnSync(process.execPath, ["scripts/package-share.mjs", "--output-dir", outputDir], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "manifest.json"), "utf8"));
  workerSource = await readFile(path.join(outputDir, `paperlens-${manifest.version}`, "background.js"), "utf8");
});

after(async () => {
  if (!outputDir) return;
  assert.equal(path.dirname(path.resolve(outputDir)), path.resolve(tmpdir()));
  assert.ok(path.basename(outputDir).startsWith("paperlens-distribution-worker-"));
  await rm(outputDir, { recursive: true, force: true });
});

function legacySettings(provider: "gemini" | "vertex" | "openai", summaryProvider = "gemini") {
  return {
    currentProvider: provider,
    providerSettings: {
      gemini: { apiKey: TRANSLATION_KEY, model: "gemini-pro-latest" },
      vertex: { apiKey: "synthetic-vertex-only-key", model: "gemini-3.1-pro-preview" },
      openai: { apiKey: "synthetic-openai-only-key", model: "gpt-5.6-sol" },
      anthropic: { apiKey: "synthetic-anthropic-only-key", model: "claude-opus-4-8" },
      custom: { apiKey: "synthetic-custom-only-key", model: "private-model", customUrl: "https://custom.example.test/api" },
    },
    cacheEnabled: false, maxConcurrency: 1, customPrompt: "Translate the evidence.",
    summary: {
      provider: summaryProvider, autoGenerate: false, prompt: "Summarize the evidence.",
      geminiApiKey: SUMMARY_KEY, geminiModel: "gemini-pro-latest",
      vertexApiKey: "synthetic-summary-vertex-only-key", vertexModel: "gemini-3.1-pro-preview",
      codexModel: "gpt-5.5", claudeModel: "opus",
    },
  };
}

type Listener = (...args: any[]) => any;
class EventListeners {
  private listeners = new Set<Listener>();
  addListener(listener: Listener) { this.listeners.add(listener); }
  removeListener(listener: Listener) { this.listeners.delete(listener); }
  emit(...args: any[]) { return [...this.listeners].map(listener => listener(...args)); }
}

interface CapturedRequest { url: string; headers: Headers; body: Record<string, any>; }

// The packaged worker executes unchanged. Only browser/network boundaries are
// replaced; no schema, provider dispatcher, parser or request builder is mocked.
function loadWorker(stored: ReturnType<typeof legacySettings>) {
  const records: Record<string, unknown> = { [SETTINGS_KEY]: structuredClone(stored) };
  const requests: CapturedRequest[] = [];
  const nativeRequests: Array<{ host: string; request: Record<string, any> }> = [];
  const onMessage = new EventListeners();
  const onConnect = new EventListeners();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const chrome = {
    storage: {
      local: {
        async get(keys: string[]) { return Object.fromEntries(keys.map(key => [key, records[key]])); },
        async set(values: Record<string, unknown>) { Object.assign(records, clone(values)); },
      },
      session: { async get() { return {}; } },
    },
    runtime: {
      id: "distribution-worker-test", onMessage, onConnect,
      sendNativeMessage(host: string, request: Record<string, any>, respond: (value: unknown) => void) {
        nativeRequests.push({ host, request: clone(request) });
        respond({ ok: true, summary: "Native summary retained." });
      },
    },
    commands: { onCommand: new EventListeners() },
  };
  const googlePayload = (text: string) => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
  });
  runInNewContext(workerSource, {
    chrome, crypto: webcrypto, TextEncoder, TextDecoder, AbortController, URL,
    console: { log() {}, warn() {}, error() {} },
    setInterval(handler: () => void, delay: number) {
      const interval = setInterval(handler, delay);
      interval.unref();
      intervals.add(interval);
      return interval;
    },
    clearInterval(interval: ReturnType<typeof setInterval>) { clearInterval(interval); intervals.delete(interval); },
    fetch: async (input: string, init: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init.body));
      requests.push({ url, headers: new Headers(init.headers), body });
      const streamed = url.includes("streamGenerateContent");
      const text = streamed
        ? JSON.stringify({ paragraphs: [translation] })
        : body.generationConfig?.responseMimeType === "application/json"
          ? JSON.stringify(translation)
          : "API summary retained.";
      return streamed
        ? new Response(`data: ${JSON.stringify(googlePayload(text))}\n\n`, { headers: { "Content-Type": "text/event-stream" } })
        : Response.json(googlePayload(text));
    },
  }, { filename: "distribution/background.js" });
  return {
    requests, nativeRequests,
    message(message: unknown, content = false): Promise<any> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Worker did not respond.")), 2_000);
        onMessage.emit(message, { id: chrome.runtime.id, ...(content ? { tab: { id: 1 } } : {}) }, (response: unknown) => {
          clearTimeout(timeout);
          resolve(clone(response));
        });
      });
    },
    async stream(message: unknown): Promise<any[]> {
      const sent: any[] = [];
      const port = {
        name: "paperlens-stream", sender: { id: chrome.runtime.id, tab: { id: 1 } },
        onMessage: new EventListeners(), onDisconnect: new EventListeners(),
        postMessage(value: unknown) { sent.push(clone(value)); },
      };
      onConnect.emit(port);
      try {
        port.onMessage.emit(message);
        const deadline = performance.now() + 2_000;
        while (!sent.some(item => ["stream-done", "stream-section-done", "stream-error"].includes(item.type))) {
          assert.ok(performance.now() < deadline, "worker stream must finish");
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        return sent;
      } finally { port.onDisconnect.emit(); }
    },
    dispose() { for (const interval of intervals) clearInterval(interval); },
  };
}

function assertGeminiRequest(request: CapturedRequest, key: string, stream = false): void {
  assert.equal(request.url, `${GEMINI_URL}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`);
  assert.equal(request.headers.get("x-goog-api-key"), key);
  assert.equal(request.headers.get("authorization"), null);
  assert.doesNotMatch(JSON.stringify({ url: request.url, body: request.body, headers: [...request.headers] }),
    /synthetic-(?:vertex|openai|anthropic|custom|summary-vertex)-only-key/);
}

for (const provider of ["vertex", "openai", "gemini"] as const) {
  test(`distribution worker routes stored ${provider} and Pro summary settings through fixed Gemini Flash`, async () => {
    const stored = legacySettings(provider, provider === "vertex" ? "vertex" : "gemini");
    const worker = loadWorker(stored);
    try {
      const settings = await worker.message({ type: "settings/get" });
      assert.equal(settings.ok, true);
      assert.equal(settings.settings.currentProvider, "gemini");
      assert.equal(settings.settings.providerSettings.gemini.model, "gemini-flash-latest");
      assert.equal(settings.settings.summary.provider, "gemini");
      assert.equal(settings.settings.summary.geminiModel, "gemini-flash-latest");
      assert.equal(settings.settings.providerSettings.gemini.apiKey, TRANSLATION_KEY);
      assert.equal(settings.settings.summary.geminiApiKey, SUMMARY_KEY);
      const visible = await worker.message({ type: "settings/get" }, true);
      assert.doesNotMatch(JSON.stringify(visible.settings), /synthetic-.*-key/);
      const translated = await worker.message({ type: "translate/paragraph", text: "Independent evidence.", paragraphId: "p1" });
      assertGeminiRequest(worker.requests[0], TRANSLATION_KEY);
      assert.equal(translated.ok, true);
      assert.deepEqual(translated.result, { ...translation, usage: { inputTokens: 4, outputTokens: 2 } });
      const summarized = await worker.message({ type: "summary/generate", title: "Study", articleText: "Independent evidence.", kind: "paper" });
      assertGeminiRequest(worker.requests[1], SUMMARY_KEY);
      assert.equal(summarized.ok, true);
      assert.equal(summarized.result.summary, "API summary retained.");
      assert.equal(worker.requests.length, 2);
      assert.equal(worker.nativeRequests.length, 0);
    } finally { worker.dispose(); }
  });
}

for (const type of ["stream/translate", "stream/translate-section"] as const) {
  test(`distribution worker ${type} uses Gemini Flash and the Gemini translation credential`, async () => {
    const worker = loadWorker(legacySettings("openai"));
    try {
      const messages = await worker.stream(type === "stream/translate"
        ? { type, text: "Independent evidence.", paragraphId: "p1" }
        : { type, paragraphTexts: ["Independent evidence."], paragraphIds: ["p1"], customPrompt: "Translate." });
      assertGeminiRequest(worker.requests[0], TRANSLATION_KEY, true);
      assert.equal(worker.requests.length, 1);
      const terminal = messages.at(-1);
      assert.equal(terminal.type, type === "stream/translate" ? "stream-done" : "stream-section-done");
      assert.equal(type === "stream/translate" ? terminal.fullText : terminal.paragraphs[0].translation, translation.translation);
    } finally { worker.dispose(); }
  });
}

test("distribution worker cannot substitute foreign credentials when Gemini credentials are absent", async () => {
  const stored = legacySettings("vertex", "vertex");
  stored.providerSettings.gemini.apiKey = "";
  stored.summary.geminiApiKey = "";
  const worker = loadWorker(stored);
  try {
    for (const request of [
      { type: "translate/paragraph", text: "Independent evidence.", paragraphId: "p1" },
      { type: "summary/generate", articleText: "Independent evidence." },
    ]) {
      const response = await worker.message(request);
      assert.equal(response.ok, false);
      assert.match(response.error, /Gemini API key/i);
    }
    assert.equal(worker.requests.length, 0);
  } finally { worker.dispose(); }
});

for (const provider of ["codex", "claude"] as const) {
  test(`distribution worker preserves the ${provider} native summary route without an API request`, async () => {
    const worker = loadWorker(legacySettings("vertex", provider));
    try {
      const response = await worker.message({ type: "summary/generate", articleText: "Independent evidence." });
      assert.equal(response.ok, true);
      assert.equal(response.result.summary, "Native summary retained.");
      assert.equal(worker.requests.length, 0);
      assert.equal(worker.nativeRequests.length, 1);
      assert.equal(worker.nativeRequests[0].host, "com.paperlens.summary_host");
      assert.equal(worker.nativeRequests[0].request.provider, provider);
      assert.doesNotMatch(JSON.stringify(worker.nativeRequests), /synthetic-.*-key/);
    } finally { worker.dispose(); }
  });
}
