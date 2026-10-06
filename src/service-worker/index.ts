import { readSettings, writeSettings } from "../shared/storage";
import { getCached, putCached, clearCache } from "../shared/cache";
import { buildSystemPrompt, buildUserPrompt } from "../shared/prompts";
import {
  buildSummaryPrompt,
  SUMMARY_SYSTEM_PROMPT,
} from "../shared/summary-prompts";
import {readingSettings, runtimeRequestError, isExtensionPageSender, translationConfigurationKey, assertTranslationConfiguration} from "../shared/runtime-policy";
import { dispatchSummaryProviderOnce } from "../summary/flow";
import { PROVIDERS } from "../shared/providers";
import {
  createProviderStreamDecoder,
  parseProviderResponse,
  prepareProviderRequest,
} from "../shared/provider-protocol";
import { redactSecrets } from "../shared/secrets";
import { parseSectionTranslationJson, parseTranslationJson } from "../shared/translation-json";
import type { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import type { StreamRequest, StreamMessage } from "../shared/stream-protocol";
import type { ExtensionSettings, TranslationResult, SummaryResult, TokenUsage, SentenceAlignment, ParagraphResult, ProviderSetting } from "../shared/types";
import type { ProviderCallOptions, ProviderPayloadResult } from "../shared/provider-protocol";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sanitizeErrorBody(body: string, settings: ExtensionSettings): string {
  const providerKeys = (["gemini", "vertex", "openai", "anthropic", "custom"] as const)
    .map((pid) => settings.providerSettings[pid].apiKey);
  return redactSecrets(body, [
    ...providerKeys,
    settings.summary.geminiApiKey,
    settings.summary.vertexApiKey,
  ], 200);
}

// ---------------------------------------------------------------------------
// Active-tab content script injection
// ---------------------------------------------------------------------------

const CONTENT_SCRIPT_FILE = "content.js";
const CONTENT_CSS_FILE = "content.css";

function sendTabMessage<T = unknown>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as T);
    });
  });
}

async function isContentScriptReady(tabId: number): Promise<boolean> {
  try {
    const response = await sendTabMessage<{ ok?: boolean }>(tabId, { type: "paperlens/ping" });
    return response?.ok === true;
  } catch {
    return false;
  }
}

function assertInjectableTab(tab: chrome.tabs.Tab): asserts tab is chrome.tabs.Tab & { id: number } {
  if (tab.id == null) {
    throw new Error("No active tab found.");
  }

  if (!tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error("PaperLens can only run on regular web pages.");
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await isContentScriptReady(tabId)) return;

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: [CONTENT_CSS_FILE],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  });

  if (!(await isContentScriptReady(tabId))) {
    throw new Error("PaperLens content script did not initialize.");
  }
}

async function toggleActiveTabTranslation(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  assertInjectableTab(tab);
  await ensureContentScript(tab.id);
  await sendTabMessage(tab.id, { type: "toggle-translate" });
}

async function summarizeActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  assertInjectableTab(tab);
  await ensureContentScript(tab.id);
  await sendTabMessage(tab.id, { type: "summarize-paper" });
}

// ---------------------------------------------------------------------------
// Provider API calls (non-streaming) - now accept systemPrompt + userPrompt
// ---------------------------------------------------------------------------

async function fetchPreparedProviderResponse(
  options: ProviderCallOptions,
  settings: ExtensionSettings,
  signal?: AbortSignal,
): Promise<Response> {
  const prepared = prepareProviderRequest(options);
  let response: Response;
  try {
    response = await fetch(prepared.url, { ...prepared.init, signal });
  } catch (error) {
    throw new Error(
      `${PROVIDERS[options.provider].name}: ${sanitizeErrorBody(toErrorMessage(error), settings)}`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${PROVIDERS[options.provider].name} ${response.status}: ${sanitizeErrorBody(body, settings)}`,
    );
  }
  return response;
}

async function fetchProviderPayload(
  options: ProviderCallOptions,
  settings: ExtensionSettings,
  signal?: AbortSignal,
): Promise<ProviderPayloadResult> {
  const response = await fetchPreparedProviderResponse(options, settings, signal);
  try {
    return parseProviderResponse(options.provider, await response.json());
  } catch (error) {
    throw new Error(
      `${PROVIDERS[options.provider].name}: ${sanitizeErrorBody(toErrorMessage(error), settings)}`,
    );
  }
}

function translationCallOptions(
  systemPrompt: string,
  userPrompt: string,
  settings: ExtensionSettings,
  stream: boolean,
): ProviderCallOptions {
  const provider = settings.currentProvider;
  return {
    provider,
    setting: settings.providerSettings[provider],
    systemPrompt,
    userPrompt,
    outputMode: "json",
    stream,
  };
}

async function dispatchTranslation(
  systemPrompt: string,
  userPrompt: string,
  settings: ExtensionSettings,
): Promise<TranslationResult> {
  const result = await fetchProviderPayload(
    translationCallOptions(systemPrompt, userPrompt, settings, false),
    settings,
  );
  return {
    ...parseTranslationJson(result.text),
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

// ---------------------------------------------------------------------------
// Summary provider calls
// ---------------------------------------------------------------------------

const NATIVE_SUMMARY_HOST = "com.paperlens.summary_host";

interface NativeSummaryRequest {
  provider: "codex" | "claude";
  prompt: string;
  systemPrompt: string;
  codexModel?: string;
  claudeModel?: string;
}

interface NativeSummaryResponse {
  ok?: boolean;
  summary?: string;
  error?: string;
}

function sendNativeSummaryMessage(request: NativeSummaryRequest): Promise<NativeSummaryResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_SUMMARY_HOST, request, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve((response ?? {}) as NativeSummaryResponse);
    });
  });
}

async function callNativeSummary(
  provider: "codex" | "claude",
  prompt: string,
  settings: ExtensionSettings,
): Promise<SummaryResult> {
  const response = await sendNativeSummaryMessage({
    provider,
    prompt,
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    codexModel: settings.summary.codexModel,
    claudeModel: settings.summary.claudeModel,
  });

  if (!response.ok) {
    throw new Error(
      response.error ||
      `Native summary host is not available. Register ${NATIVE_SUMMARY_HOST} first.`,
    );
  }

  const summary = response.summary?.trim();
  if (!summary) {
    throw new Error("Summary provider returned an empty response.");
  }
  return { summary };
}

function buildGoogleSummarySetting(
  provider: "gemini" | "vertex",
  settings: ExtensionSettings,
): ProviderSetting {
  if (provider === "gemini") {
    return {
      apiKey: settings.summary.geminiApiKey || settings.providerSettings.gemini.apiKey,
      model: settings.summary.geminiModel
        || settings.providerSettings.gemini.model
        || PROVIDERS.gemini.defaultModel,
    };
  }
  return {
    apiKey: settings.summary.vertexApiKey || settings.providerSettings.vertex.apiKey,
    model: settings.summary.vertexModel
      || settings.providerSettings.vertex.model
      || PROVIDERS.vertex.defaultModel,
  };
}

async function callGoogleSummary(
  provider: "gemini" | "vertex",
  prompt: string,
  settings: ExtensionSettings,
): Promise<SummaryResult> {
  const result = await fetchProviderPayload({
    provider,
    setting: buildGoogleSummarySetting(provider, settings),
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    userPrompt: prompt,
    outputMode: "text",
    stream: false,
  }, settings);
  const summary = result.text.trim();
  if (!summary) {
    throw new Error(`${PROVIDERS[provider].name} summary returned an empty response.`);
  }
  return {
    summary,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

async function dispatchSummary(title: string | undefined, articleText: string, settings: ExtensionSettings, kind?: "paper" | "article", sourceScope?: "loaded-page" | "abstract-only"): Promise<SummaryResult> {
  const prompt = buildSummaryPrompt({
    customPrompt: settings.summary.prompt,
    title,
    articleText,
    kind,
    sourceScope,
  });

  return dispatchSummaryProviderOnce(settings.summary.provider, prompt, {
    native: (provider, fullPrompt) =>
      callNativeSummary(provider, fullPrompt, settings),
    google: (provider, fullPrompt) =>
      callGoogleSummary(provider, fullPrompt, settings),
  });
}

// ---------------------------------------------------------------------------
// Streaming provider calls - now accept systemPrompt + userPrompt
// ---------------------------------------------------------------------------

async function fetchProviderStream(
  options: ProviderCallOptions,
  settings: ExtensionSettings,
  onChunk: (delta: string) => void,
  signal?: AbortSignal,
): Promise<ProviderPayloadResult> {
  const response = await fetchPreparedProviderResponse(options, settings, signal);
  if (!response.body) {
    throw new Error(`${PROVIDERS[options.provider].name} returned no response stream.`);
  }

  const decoder = createProviderStreamDecoder(options.provider, onChunk);
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      decoder.push(value);
    }
    return decoder.finish();
  } catch (error) {
    throw new Error(
      `${PROVIDERS[options.provider].name}: ${sanitizeErrorBody(toErrorMessage(error), settings)}`,
    );
  } finally {
    reader.releaseLock();
  }
}

async function dispatchStream(
  systemPrompt: string,
  userPrompt: string,
  settings: ExtensionSettings,
  onChunk: (delta: string) => void,
  signal?: AbortSignal,
): Promise<{ fullText: string; usage?: TokenUsage }> {
  const result = await fetchProviderStream(
    translationCallOptions(systemPrompt, userPrompt, settings, true),
    settings,
    onChunk,
    signal,
  );
  return {
    fullText: result.text,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

// ---------------------------------------------------------------------------
// Message router (non-streaming)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: RuntimeRequest, sender, sendResponse) => {
  const requestError = runtimeRequestError(message, sender, chrome.runtime.id);
  if (requestError) {
    sendResponse({ok: false, error: requestError});
    return false;
  }
  void (async () => {
    try {
      switch (message.type) {
        case "settings/get": {
          const settings = await readSettings();
          const publicSettings = readingSettings(settings);
          publicSettings.translationConfigKey = await translationConfigurationKey(settings);
          sendResponse({ ok: true, settings: isExtensionPageSender(sender, chrome.runtime.id) ? settings : publicSettings } as RuntimeResponse);
          return;
        }
        case "settings/update": {
          const settings = await writeSettings(message.settings);
          sendResponse({ ok: true, settings } as RuntimeResponse);
          return;
        }
        case "translate/paragraph": {
          const settings = await readSettings();
          const sysPrompt = buildSystemPrompt(settings.customPrompt);
          const usrPrompt = buildUserPrompt([message.text]);
          const result = await dispatchTranslation(sysPrompt, usrPrompt, settings);
          sendResponse({ ok: true, result } as RuntimeResponse);
          return;
        }
        case "summary/generate": {
          const settings = await readSettings();
          const result = await dispatchSummary(message.title, message.articleText, settings, message.kind, message.sourceScope);
          sendResponse({ ok: true, result } as RuntimeResponse);
          return;
        }
        case "cache/get": {
          const entry = await getCached(message.hash);
          sendResponse({ ok: true, entry } as RuntimeResponse);
          return;
        }
        case "cache/put": {
          await putCached(message.entry);
          sendResponse({ ok: true } as RuntimeResponse);
          return;
        }
        case "cache/clear": {
          await clearCache();
          sendResponse({ ok: true } as RuntimeResponse);
          return;
        }
        case "tabs/toggle-translate": {
          await toggleActiveTabTranslation();
          sendResponse({ ok: true } as RuntimeResponse);
          return;
        }
        case "tabs/summarize-paper": {
          await summarizeActiveTab();
          sendResponse({ ok: true } as RuntimeResponse);
          return;
        }
        case "toggle-translate": {
          await toggleActiveTabTranslation();
          sendResponse({ ok: true } as RuntimeResponse);
          return;
        }
        default: {
          const _exhaustive: never = message;
          sendResponse({ ok: false, error: `Unknown message type: ${(_exhaustive as RuntimeRequest).type}` } as RuntimeResponse);
        }
      }
    } catch (error) {
      sendResponse({ ok: false, error: toErrorMessage(error) } as RuntimeResponse);
    }
  })();
  return true;
});

// ---------------------------------------------------------------------------
// Keepalive (while ports are connected)
// ---------------------------------------------------------------------------

let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepalive() {
  if (keepaliveInterval) return;
  keepaliveInterval = setInterval(() => {
    chrome.storage.session.get("_keepalive");
  }, 25000);
}

function stopKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

let connectedPorts = 0;

// ---------------------------------------------------------------------------
// Streaming via Port
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "paperlens-stream") return;

  connectedPorts++;
  startKeepalive();

  let disconnectCounted = false;
  port.onDisconnect.addListener(() => {
    if (disconnectCounted) return;
    disconnectCounted = true;
    connectedPorts--;
    if (connectedPorts <= 0) {
      connectedPorts = 0;
      stopKeepalive();
    }
  });

  port.onMessage.addListener((msg: StreamRequest) => {
    if (msg.type === "stream/translate") {
      // Legacy single-paragraph streaming
      void (async () => {
        const controller = new AbortController();
        const abortOnDisconnect = () => controller.abort();
        port.onDisconnect.addListener(abortOnDisconnect);
        try {
          const settings = await readSettings();
          const sysPrompt = buildSystemPrompt(settings.customPrompt);
          const usrPrompt = buildUserPrompt([msg.text]);
          const { fullText, usage } = await dispatchStream(sysPrompt, usrPrompt, settings, (delta) => {
            try {
              port.postMessage({ type: "stream-chunk", delta } satisfies StreamMessage);
            } catch {
              // Port disconnected
            }
          }, controller.signal);

          const parsed = parseTranslationJson(fullText);
          try {
            port.postMessage({
              type: "stream-done",
              fullText: parsed.translation,
              alignment: parsed.alignment,
              usage,
            } satisfies StreamMessage);
          } catch {
            // Port disconnected
          }
        } catch (error) {
          try {
            port.postMessage({
              type: "stream-error",
              error: toErrorMessage(error),
            } satisfies StreamMessage);
          } catch {
            // Port disconnected
          }
        } finally {
          port.onDisconnect.removeListener(abortOnDisconnect);
        }
      })();
    } else if (msg.type === "stream/translate-section") {
      // Section-level streaming
      void (async () => {
        const controller = new AbortController();
        const abortOnDisconnect = () => controller.abort();
        port.onDisconnect.addListener(abortOnDisconnect);
        try {
          const settings = await readSettings();
          const sysPrompt = buildSystemPrompt(msg.customPrompt);
          await assertTranslationConfiguration(settings, msg.configurationKey);
          const usrPrompt = buildUserPrompt(msg.paragraphTexts);
          const { fullText, usage } = await dispatchStream(sysPrompt, usrPrompt, settings, (delta) => {
            try {
              port.postMessage({ type: "stream-chunk", delta } satisfies StreamMessage);
            } catch {
              // Port disconnected
            }
          }, controller.signal);

          const paragraphs = parseSectionTranslationJson(fullText);
          try {
            port.postMessage({
              type: "stream-section-done",
              paragraphs,
              usage,
            } satisfies StreamMessage);
          } catch {
            // Port disconnected
          }
        } catch (error) {
          try {
            port.postMessage({
              type: "stream-error",
              error: toErrorMessage(error),
            } satisfies StreamMessage);
          } catch {
            // Port disconnected
          }
        } finally {
          port.onDisconnect.removeListener(abortOnDisconnect);
        }
      })();
    }
  });
});

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-translate") {
    void (async () => {
      try {
        await toggleActiveTabTranslation();
      } catch (error) {
        console.error(toErrorMessage(error));
      }
    })();
    return;
  }

  if (command === "summarize-paper") {
    void (async () => {
      try {
        await summarizeActiveTab();
      } catch (error) {
        console.error(toErrorMessage(error));
      }
    })();
  }
});

console.log("PaperLens service worker loaded");
