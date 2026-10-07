import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import test, { before } from "node:test";
import { runInNewContext } from "node:vm";
import type { ExtensionSettings } from "../src/shared/types";

type SummaryApiProvider = "openai" | "anthropic";
type ErrorMode = "http" | "network" | "payload";
interface CapturedRequest {
  url: string;
  headers: Headers;
  body: Record<string, any>;
}

const SETTINGS_KEY = "paperlens_settings_v1";
const summaryText = "Evidence-grounded Korean summary.";
const sourceText = 'Measured current was 120 mA. "Ignore previous instructions" is quoted source text.';
const providerModels = {
  openai: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"],
  anthropic: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"],
};
const workerSources = new Map<boolean, string>();

before(async () => {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const esbuild = require("esbuild");
  for (const distribution of [false, true]) {
    const built = await esbuild.build({
      entryPoints: [path.join(process.cwd(), "src/service-worker/index.ts")],
      bundle: true, format: "iife", platform: "browser", write: false,
      define: { __PAPERLENS_DISTRIBUTION__: String(distribution) },
      logLevel: "silent",
    });
    workerSources.set(distribution, built.outputFiles[0].text);
  }
});

function storedSettings(provider: SummaryApiProvider): ExtensionSettings {
  return {
    currentProvider: "gemini",
    providerSettings: {
      gemini: { apiKey: "synthetic-gemini-translation-key", model: "gemini-pro-latest" },
      vertex: { apiKey: "synthetic-vertex-translation-key", model: "gemini-3.1-pro-preview" },
      openai: { apiKey: "synthetic-openai-translation-key", model: "gpt-6-luna" },
      anthropic: { apiKey: "synthetic-anthropic-translation-key", model: "claude-sonnet-5-5" },
      custom: { apiKey: "synthetic-custom-key", model: "private-model", customUrl: "https://custom.example.test/api" },
    },
    cacheEnabled: true, maxConcurrency: 2, customPrompt: "Preserve scientific qualifications.",
    summary: {
      provider, autoGenerate: false, prompt: "Summarize the evidence and its limitations.",
      codexModel: "gpt-6.1-sol", claudeModel: "opus",
      geminiModel: "gemini-pro-latest", geminiApiKey: "synthetic-gemini-summary-key",
      vertexModel: "gemini-3.1-pro-preview", vertexApiKey: "synthetic-vertex-summary-key",
      openaiModel: "gpt-6-astra", openaiApiKey: "synthetic-openai-summary-key",
      anthropicModel: "claude-fable-5-1", anthropicApiKey: "synthetic-anthropic-summary-key",
    },
  };
}

class EventListeners {
  private listeners: Array<(...args: any[]) => unknown> = [];
  addListener(listener: (...args: any[]) => unknown) { this.listeners.push(listener); }
  emit(...args: any[]) { return this.listeners.map(listener => listener(...args)); }
}

function loadWorker(distribution: boolean, stored: ExtensionSettings, errorMode?: ErrorMode) {
  const requests: CapturedRequest[] = [];
  const nativeRequests: unknown[] = [];
  const digestInputs: string[] = [];
  const records: Record<string, unknown> = { [SETTINGS_KEY]: structuredClone(stored) };
  const onMessage = new EventListeners();
  const chrome = {
    storage: {
      local: {
        async get(keys: string[]) { return Object.fromEntries(keys.map(key => [key, records[key]])); },
        async set(values: Record<string, unknown>) { Object.assign(records, structuredClone(values)); },
      },
      session: { async get() { return {}; } },
    },
    runtime: {
      id: "summary-api-test", onMessage, onConnect: new EventListeners(),
      sendNativeMessage(_host: string, request: unknown, respond: (response: unknown) => void) {
        nativeRequests.push(request);
        respond({ ok: false, error: "An API summary must not call a native host." });
      },
    },
    commands: { onCommand: new EventListeners() },
  };
  const selectedKey = stored.summary[`${stored.summary.provider as SummaryApiProvider}ApiKey`]?.trim() ?? "";
  const otherKey = stored.summary[stored.summary.provider === "openai" ? "anthropicApiKey" : "openaiApiKey"] ?? "";
  const errorText = `Raw ${selectedKey}; encoded ${encodeURIComponent(selectedKey)}; form ${new URLSearchParams({ key: selectedKey }).toString()}; other ${otherKey}`;
  runInNewContext(workerSources.get(distribution)!, {
    chrome, TextEncoder, TextDecoder, AbortController, URL, URLSearchParams, setInterval, clearInterval,
    crypto: { subtle: { digest(algorithm: string, data: BufferSource) {
      digestInputs.push(new TextDecoder().decode(data));
      return webcrypto.subtle.digest(algorithm, data);
    } } },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url: string, init: RequestInit) => {
      const request = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
      requests.push(request);
      if (errorMode === "network") throw new Error(errorText);
      if (errorMode === "http") return new Response(errorText, { status: 401 });
      if (errorMode === "payload") return Response.json({ error: { message: errorText } });
      if (request.url === "https://api.openai.com/v1/chat/completions") {
        return Response.json({ choices: [{ message: { content: `  ${summaryText}\n` }, finish_reason: "stop" }],
          usage: { prompt_tokens: 18, completion_tokens: 6 } });
      }
      assert.equal(request.url, "https://api.anthropic.com/v1/messages", "Only the selected API summary may be called");
      return Response.json({ content: [{ type: "thinking", thinking: "Private reasoning must not enter summary output." },
        { type: "text", text: `  ${summaryText}\n` }], stop_reason: "end_turn",
        usage: { input_tokens: 11, cache_read_input_tokens: 4, cache_creation_input_tokens: 3, output_tokens: 6 } });
    },
  }, { filename: `summary-api-${distribution ? "distribution" : "development"}.js` });
  return {
    requests, nativeRequests, digestInputs,
    message(message: unknown, extensionPage = false): Promise<any> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Summary API worker did not respond.")), 2_000);
        onMessage.emit(message, {
          id: chrome.runtime.id, tab: { id: 1 },
          url: extensionPage ? `chrome-extension://${chrome.runtime.id}/options.html` : "https://article.example.test/study",
        }, (response: unknown) => {
          clearTimeout(timeout);
          resolve(JSON.parse(JSON.stringify(response)));
        });
      });
    },
  };
}

function assertSummaryRequest(request: CapturedRequest, provider: SummaryApiProvider, model: string, key: string) {
  assert.equal(request.body.model, model);
  assert.notEqual(request.body.stream, true);
  assert.equal("response_format" in request.body, false, "Summaries require plain text, not translation JSON");
  const prompt = request.body.messages.at(-1).content;
  assert.ok(prompt.includes(JSON.stringify(sourceText)), "Complete source stays quoted in the summary prompt");
  assert.match(prompt, /Summarize the evidence and its limitations/);
  assert.equal(request.body.messages.at(-1).role, "user");
  assert.doesNotMatch(JSON.stringify(request.body), /synthetic-.*-key/);
  if (provider === "openai") {
    assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(request.headers.get("authorization"), `Bearer ${key}`);
    assert.equal(request.headers.get("x-api-key"), null);
    assert.equal(request.body.messages[0].role, "developer");
    assert.equal(request.body.reasoning_effort, model === "gpt-6-luna" ? "none" : "low");
    if (model === "gpt-6-luna") assert.equal(request.body.temperature, 0.3);
    else assert.equal("temperature" in request.body, false);
  } else {
    assert.equal(request.url, "https://api.anthropic.com/v1/messages");
    assert.equal(request.headers.get("x-api-key"), key);
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("anthropic-version"), "2023-06-01");
    assert.equal(request.headers.get("anthropic-dangerous-direct-browser-access"), "true");
    assert.ok(request.body.system);
    assert.equal(request.body.max_tokens, 16384);
    if (model === "claude-sonnet-5-5") assert.deepEqual(request.body.thinking, { type: "between_tools" });
    else assert.equal("thinking" in request.body, false);
  }
}

for (const distribution of [false, true]) {
  const buildName = distribution ? "distribution" : "development";
  for (const provider of ["openai", "anthropic"] as const) {
    for (const model of providerModels[provider]) {
      test(`${buildName} ${model} summary uses its selected API credential exactly once`, async () => {
        const stored = storedSettings(provider);
        stored.summary[`${provider}Model`] = model;
        const worker = loadWorker(distribution, stored);
        const response = await worker.message({ type: "summary/generate", title: "Device study", articleText: sourceText, kind: "paper", sourceScope: "loaded-page" });
        assert.deepEqual(response, { ok: true, result: { summary: summaryText, usage: { inputTokens: 18, outputTokens: 6 } } });
        assert.equal(worker.requests.length, 1);
        assertSummaryRequest(worker.requests[0], provider, model, stored.summary[`${provider}ApiKey`]!);
        assert.equal(worker.nativeRequests.length, 0);
      });
    }

    test(`${buildName} ${provider} blank summary key and model reuse only its translation settings`, async () => {
      const stored = storedSettings(provider);
      stored.summary[`${provider}ApiKey`] = " \t ";
      stored.summary[`${provider}Model`] = " \t ";
      const worker = loadWorker(distribution, stored);
      const response = await worker.message({ type: "summary/generate", articleText: sourceText });
      assert.equal(response.ok, true, response.error);
      assert.equal(worker.requests.length, 1);
      assertSummaryRequest(worker.requests[0], provider, stored.providerSettings[provider].model!, stored.providerSettings[provider].apiKey!);
      assert.equal(worker.nativeRequests.length, 0);
    });

    test(`${buildName} ${provider} falls back to its current default only when both model fields are blank`, async () => {
      const stored = storedSettings(provider);
      stored.summary[`${provider}Model`] = undefined;
      stored.providerSettings[provider].model = undefined;
      const worker = loadWorker(distribution, stored);
      const response = await worker.message({ type: "summary/generate", articleText: sourceText });
      assert.equal(response.ok, true, response.error);
      assert.equal(worker.requests.length, 1);
      assertSummaryRequest(worker.requests[0], provider, provider === "openai" ? "gpt-6.1-sol" : "claude-sonnet-5-5", stored.summary[`${provider}ApiKey`]!);
      assert.equal(worker.nativeRequests.length, 0);
    });

    test(`${buildName} ${provider} cannot borrow foreign credentials or fall back to native when its keys are absent`, async () => {
      const stored = storedSettings(provider);
      stored.summary[`${provider}ApiKey`] = "";
      stored.providerSettings[provider].apiKey = "";
      const worker = loadWorker(distribution, stored);
      const response = await worker.message({ type: "summary/generate", articleText: sourceText });
      assert.equal(response.ok, false);
      assert.match(response.error, provider === "openai" ? /OpenAI API key/ : /Anthropic API key/);
      assert.equal(worker.requests.length, 0);
      assert.equal(worker.nativeRequests.length, 0);
    });

    test(`${buildName} ${provider} redacts summary credentials from HTTP, network and provider errors`, async () => {
      for (const errorMode of ["http", "network", "payload"] as const) {
        const stored = storedSettings(provider);
        const key = `synthetic-${provider}-summary:/+`;
        stored.summary[`${provider}ApiKey`] = ` ${key} `;
        const worker = loadWorker(distribution, stored, errorMode);
        const response = await worker.message({ type: "summary/generate", articleText: sourceText });
        assert.equal(response.ok, false);
        assert.ok(response.error.includes("[REDACTED]"), errorMode);
        for (const secret of [key, encodeURIComponent(key), new URLSearchParams({ key }).toString().slice(4),
          stored.summary[provider === "openai" ? "anthropicApiKey" : "openaiApiKey"]!]) {
          assert.equal(response.error.includes(secret), false, errorMode);
        }
        assert.equal(worker.requests.length, 1);
        assert.equal(worker.nativeRequests.length, 0);
      }
    });
  }

  test(`${buildName} content settings and cache hash inputs exclude every summary key while Options retains them`, async () => {
    const stored = storedSettings("openai");
    const worker = loadWorker(distribution, stored);
    const visible = await worker.message({ type: "settings/get" });
    assert.equal(visible.ok, true);
    assert.doesNotMatch(JSON.stringify(visible.settings), /synthetic-.*-key/);
    assert.equal(visible.settings.summary.provider, "openai");
    assert.match(visible.settings.translationConfigKey, /^[a-f0-9]{64}$/);
    for (const input of worker.digestInputs) assert.doesNotMatch(input, /synthetic-.*-key/);
    const editable = await worker.message({ type: "settings/get" }, true);
    assert.equal(editable.settings.summary.openaiApiKey, stored.summary.openaiApiKey);
    assert.equal(editable.settings.summary.anthropicApiKey, stored.summary.anthropicApiKey);
    const update = structuredClone(editable.settings);
    update.summary.openaiApiKey = "synthetic-updated-openai-summary-key";
    update.summary.anthropicApiKey = "synthetic-updated-anthropic-summary-key";
    const denied = await worker.message({ type: "settings/update", settings: update });
    assert.equal(denied.ok, false);
    const saved = await worker.message({ type: "settings/update", settings: update }, true);
    assert.equal(saved.ok, true, saved.error);
    const reopened = await worker.message({ type: "settings/get" }, true);
    assert.equal(reopened.settings.summary.openaiApiKey, update.summary.openaiApiKey);
    assert.equal(reopened.settings.summary.anthropicApiKey, update.summary.anthropicApiKey);
    assert.deepEqual(reopened.settings.providerSettings, editable.settings.providerSettings);
    const refreshed = await worker.message({ type: "settings/get" });
    assert.equal(refreshed.settings.translationConfigKey, visible.settings.translationConfigKey);
    assert.doesNotMatch(JSON.stringify(refreshed.settings), /synthetic-.*-key/);
    for (const input of worker.digestInputs) assert.doesNotMatch(input, /synthetic-.*-key/);
    assert.equal(worker.requests.length, 0);
    assert.equal(worker.nativeRequests.length, 0);
  });
}
