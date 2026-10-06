import type { ExtensionSettings, TranslationResult, SummaryResult, CacheEntry } from "./types";

export type RuntimeRequest =
  | { type: "settings/get" }
  | { type: "settings/update"; settings: ExtensionSettings }
  | { type: "translate/paragraph"; text: string; paragraphId: string }
  | { type: "summary/generate"; title?: string; articleText: string; kind?: "paper" | "article"; sourceScope?: "loaded-page" | "abstract-only" }
  | { type: "cache/get"; hash: string }
  | { type: "cache/put"; entry: CacheEntry }
  | { type: "cache/clear" }
  | { type: "tabs/toggle-translate" }
  | { type: "tabs/summarize-paper" }
  | { type: "toggle-translate" };

type SuccessResponses = {
  "settings/get": { ok: true; settings: ExtensionSettings };
  "settings/update": { ok: true; settings: ExtensionSettings };
  "translate/paragraph": { ok: true; result: TranslationResult };
  "summary/generate": { ok: true; result: SummaryResult };
  "cache/get": { ok: true; entry: CacheEntry | null };
  "cache/put": { ok: true };
  "cache/clear": { ok: true };
  "tabs/toggle-translate": { ok: true };
  "tabs/summarize-paper": { ok: true };
  "toggle-translate": { ok: true };
};

export type RuntimeResponse =
  | SuccessResponses[keyof SuccessResponses]
  | { ok: false; error: string };

export async function sendRuntimeMessage<K extends RuntimeRequest["type"]>(
  message: Extract<RuntimeRequest, { type: K }>,
): Promise<SuccessResponses[K] | { ok: false; error: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message ?? "Unknown error" });
        return;
      }
      resolve(response && typeof response.ok === "boolean"
        ? response
        : {ok: false, error: "PaperLens did not return a valid response. Reload the extension and page."});
    });
  });
}
