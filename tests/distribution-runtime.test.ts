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

type ApiProvider = "gemini" | "vertex" | "openai" | "anthropic" | "custom";

function legacySettings(provider: ApiProvider, summaryProvider = "gemini") {
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
      const google = url.includes("googleapis.com/");
      const anthropic = url === "https://api.anthropic.com/v1/messages";
      const text = streamed
        ? JSON.stringify({ paragraphs: [translation] })
        : body.generationConfig?.responseMimeType === "application/json" || !google
          ? JSON.stringify(translation)
          : "API summary retained.";
      if (streamed) {
        return new Response(`data: ${JSON.stringify(googlePayload(text))}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      }
      return Response.json(google ? googlePayload(text) : anthropic ? {
        content: [{ type: "text", text }], stop_reason: "end_turn",
        usage: { input_tokens: 4, output_tokens: 2 },
      } : {
        choices: [{ message: { content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      });
    },
  }, { filename: "distribution/background.js" });
  return {
    requests, nativeRequests,
    message(message: unknown, sender: boolean | { id?: string; url?: string; tab?: unknown } = false): Promise<any> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Worker did not respond.")), 2_000);
        const messageSender = typeof sender === "boolean"
          ? { id: chrome.runtime.id, url: sender ? "https://article.example.test/reading" : `chrome-extension://${chrome.runtime.id}/popup.html`, ...(sender ? { tab: { id: 1 } } : {}) }
          : { id: chrome.runtime.id, ...sender };
        onMessage.emit(message, messageSender, (response: unknown) => {
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

function assertOtherProviderRequest(request: CapturedRequest, provider: Exclude<ApiProvider, "gemini">, setting: { apiKey: string; model: string; customUrl?: string }): void {
  assert.equal(request.headers.get("content-type"), "application/json");
  assert.equal(request.headers.get("x-goog-api-key"), null);
  if (provider === "vertex") {
    assert.equal(request.url, `https://aiplatform.googleapis.com/v1/publishers/google/models/${setting.model}:generateContent?key=${setting.apiKey}`);
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.body.contents[0].role, "user");
    assert.equal(request.body.system_instruction, undefined);
    assert.ok(request.body.systemInstruction.parts[0].text);
  } else {
    assert.equal(request.body.model, setting.model);
    if (provider === "anthropic") {
      assert.equal(request.url, "https://api.anthropic.com/v1/messages");
      assert.equal(request.headers.get("x-api-key"), setting.apiKey);
      assert.equal(request.headers.get("authorization"), null);
      assert.equal(request.headers.get("anthropic-version"), "2023-06-01");
      assert.ok(request.body.system);
    } else {
      assert.equal(request.url, provider === "openai" ? "https://api.openai.com/v1/chat/completions" : setting.customUrl);
      assert.equal(request.headers.get("authorization"), `Bearer ${setting.apiKey}`);
      assert.equal(request.body.messages[0].role, provider === "openai" ? "developer" : "system");
    }
  }
  assert.doesNotMatch(JSON.stringify({ url: request.url, body: request.body, headers: [...request.headers] }),
    /synthetic-gemini-(?:translation|summary)-key/);
}

test("tab-hosted options page can read saved credentials and persist settings in the packaged worker", async () => {
  const stored = legacySettings("gemini");
  const worker = loadWorker(stored);
  const optionsSender = { url: "chrome-extension://distribution-worker-test/options.html", tab: { id: 31 } };
  try {
    const initial = await worker.message({ type: "settings/get" }, optionsSender);
    assert.equal(initial.settings.providerSettings.gemini.apiKey, TRANSLATION_KEY);
    assert.equal(initial.settings.summary.geminiApiKey, SUMMARY_KEY);
    const next = structuredClone(stored);
    next.providerSettings.gemini.apiKey = "synthetic-updated-gemini-key";
    const saved = await worker.message({ type: "settings/update", settings: next }, optionsSender);
    assert.equal(saved.ok, true, saved.error);
    const reopened = await worker.message({ type: "settings/get" }, optionsSender);
    assert.equal(reopened.settings.providerSettings.gemini.apiKey, "synthetic-updated-gemini-key");
    assert.equal(reopened.settings.summary.geminiApiKey, SUMMARY_KEY);
    assert.equal(reopened.settings.providerSettings.gemini.model, "gemini-flash-latest");
    assert.equal(reopened.settings.providerSettings.openai.model, "gpt-6.1-sol");
    assert.equal(reopened.settings.providerSettings.openai.apiKey, stored.providerSettings.openai.apiKey);
    assert.equal(reopened.settings.providerSettings.anthropic.model, "claude-opus-5-5");
    assert.equal(reopened.settings.providerSettings.anthropic.apiKey, stored.providerSettings.anthropic.apiKey);
    assert.equal(reopened.settings.summary.codexModel, "gpt-6.1-sol");
    assert.deepEqual(reopened.settings.providerSettings.custom, stored.providerSettings.custom);
    assert.equal(worker.requests.length, 0);
  } finally { worker.dispose(); }
});

test("unknown and web senders cannot access credentials or mutate packaged-worker settings", async () => {
  const worker = loadWorker(legacySettings("gemini"));
  const next = legacySettings("openai");
  try {
    for (const sender of [
      {},
      { url: "https://article.example.test/reading" },
      { url: "chrome-extension://distribution-worker-test.evil/options.html", tab: { id: 1 } },
      { url: "https://example.test/chrome-extension://distribution-worker-test/options.html", tab: { id: 1 } },
      { url: "chrome-extension://distribution-worker-test/options.html.evil", tab: { id: 1 } },
    ]) {
      const visible = await worker.message({ type: "settings/get" }, sender);
      assert.equal(visible.ok, true);
      assert.doesNotMatch(JSON.stringify(visible.settings), /synthetic-.*-key/);
      const blocked = await worker.message({ type: "settings/update", settings: next }, sender);
      assert.equal(blocked.ok, false);
      const saved = await worker.message({ type: "settings/get" });
      assert.equal(saved.settings.currentProvider, "gemini");
      assert.equal(saved.settings.providerSettings.gemini.apiKey, TRANSLATION_KEY);
    }
    assert.equal(worker.requests.length, 0);
  } finally { worker.dispose(); }
});

for (const provider of ["vertex", "openai", "anthropic", "custom", "gemini"] as const) {
  test(`distribution worker preserves stored ${provider} selection while migrating known models and fixing Gemini`, async () => {
    const stored = legacySettings(provider, provider === "vertex" ? "vertex" : "gemini");
    const expectedProviderSettings = {
      ...stored.providerSettings,
      openai: { ...stored.providerSettings.openai, model: "gpt-6.1-sol" },
      anthropic: { ...stored.providerSettings.anthropic, model: "claude-opus-5-5" },
    };
    const worker = loadWorker(stored);
    try {
      const settings = await worker.message({ type: "settings/get" });
      assert.equal(settings.ok, true);
      assert.equal(settings.settings.currentProvider, provider);
      assert.equal(settings.settings.providerSettings.gemini.model, "gemini-flash-latest");
      assert.equal(settings.settings.summary.provider, stored.summary.provider);
      assert.equal(settings.settings.summary.geminiModel, "gemini-flash-latest");
      assert.equal(settings.settings.providerSettings.gemini.apiKey, TRANSLATION_KEY);
      assert.equal(settings.settings.summary.geminiApiKey, SUMMARY_KEY);
      for (const preserved of ["vertex", "openai", "anthropic", "custom"] as const) {
        assert.deepEqual(settings.settings.providerSettings[preserved], expectedProviderSettings[preserved]);
      }
      assert.equal(settings.settings.summary.vertexModel, stored.summary.vertexModel);
      assert.equal(settings.settings.summary.vertexApiKey, stored.summary.vertexApiKey);
      const visible = await worker.message({ type: "settings/get" }, true);
      assert.doesNotMatch(JSON.stringify(visible.settings), /synthetic-.*-key/);
      const translated = await worker.message({ type: "translate/paragraph", text: "Independent evidence.", paragraphId: "p1" });
      if (provider === "gemini") assertGeminiRequest(worker.requests[0], TRANSLATION_KEY);
      else assertOtherProviderRequest(worker.requests[0], provider, expectedProviderSettings[provider]);
      assert.equal(translated.ok, true);
      assert.deepEqual(translated.result, { ...translation, usage: { inputTokens: 4, outputTokens: 2 } });
      const summarized = await worker.message({ type: "summary/generate", title: "Study", articleText: "Independent evidence.", kind: "paper" });
      if (stored.summary.provider === "vertex") {
        assertOtherProviderRequest(worker.requests[1], "vertex", { apiKey: stored.summary.vertexApiKey, model: stored.summary.vertexModel });
      } else assertGeminiRequest(worker.requests[1], SUMMARY_KEY);
      assert.equal(summarized.ok, true);
      assert.equal(summarized.result.summary, "API summary retained.");
      assert.equal(worker.requests.length, 2);
      assert.equal(worker.nativeRequests.length, 0);
    } finally { worker.dispose(); }
  });
}

for (const type of ["stream/translate", "stream/translate-section"] as const) {
  test(`distribution worker ${type} uses Gemini Flash and the Gemini translation credential`, async () => {
    const worker = loadWorker(legacySettings("gemini"));
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
  const stored = legacySettings("gemini", "gemini");
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
      assert.equal(worker.nativeRequests[0].request.codexModel, "gpt-6.1-sol");
      assert.equal(worker.nativeRequests[0].request.claudeModel, "opus");
      assert.doesNotMatch(JSON.stringify(worker.nativeRequests), /synthetic-.*-key/);
    } finally { worker.dispose(); }
  });
}

test("distribution worker preserves an explicit native Codex model independently of API migrations", async () => {
  const stored = legacySettings("openai", "codex");
  stored.summary.codexModel = "private-codex-model-v7";
  const worker = loadWorker(stored);
  try {
    const response = await worker.message({ type: "summary/generate", articleText: "Independent evidence." });
    assert.equal(response.ok, true);
    assert.equal(worker.requests.length, 0);
    assert.equal(worker.nativeRequests.length, 1);
    assert.equal(worker.nativeRequests[0].request.codexModel, "private-codex-model-v7");
    assert.doesNotMatch(JSON.stringify(worker.nativeRequests), /synthetic-.*-key/);
  } finally { worker.dispose(); }
});

for (const [provider, models] of [
  ["openai", ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]],
  ["anthropic", ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"]],
] as const) {
  for (const model of models) {
    test(`distribution worker retains explicit ${model} and uses its own provider credential`, async () => {
      const stored = legacySettings(provider);
      stored.providerSettings[provider].model = model;
      const worker = loadWorker(stored);
      try {
        const response = await worker.message({ type: "translate/paragraph", text: "Independent evidence.", paragraphId: "p1" });
        assert.equal(response.ok, true);
        assert.equal(worker.requests.length, 1);
        assertOtherProviderRequest(worker.requests[0], provider, stored.providerSettings[provider]);
        if (provider === "openai") {
          assert.equal(worker.requests[0].body.reasoning_effort, model === "gpt-6-luna" ? "none" : "low");
          if (model === "gpt-6-luna") assert.equal(worker.requests[0].body.temperature, 0.3);
          else assert.equal("temperature" in worker.requests[0].body, false);
        }
        assert.equal(worker.nativeRequests.length, 0);
      } finally { worker.dispose(); }
    });
  }
}
