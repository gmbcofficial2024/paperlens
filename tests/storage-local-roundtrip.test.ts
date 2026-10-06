import test from "node:test";
import assert from "node:assert/strict";
import { readSettings, writeSettings } from "../src/shared/storage";
import type { ExtensionSettings } from "../src/shared/types";

test("local storage round-trips all five translation keys and two summary keys", async () => {
  const records: Record<string, unknown> = {};
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          async get(keys: string[]) {
            return Object.fromEntries(keys.map((key) => [key, records[key]]));
          },
          async set(values: Record<string, unknown>) {
            Object.assign(records, values);
          },
        },
      },
    },
  });

  const settings: ExtensionSettings = {
    currentProvider: "gemini",
    providerSettings: {
      gemini: { apiKey: "synthetic-translation-gemini-key", model: "gemini-flash-latest" },
      vertex: { apiKey: "synthetic-translation-vertex-key", model: "gemini-3.6-flash" },
      openai: { apiKey: "synthetic-translation-openai-key", model: "gpt-5.6-terra" },
      anthropic: { apiKey: "synthetic-translation-anthropic-key", model: "claude-sonnet-5" },
      custom: {
        apiKey: "synthetic-translation-custom-key",
        model: "synthetic-custom-model",
        customUrl: "https://api.example.test/v1/chat/completions",
      },
    },
    cacheEnabled: true,
    maxConcurrency: 3,
    customPrompt: "Use clear technical Korean.",
    summary: {
      provider: "gemini",
      autoGenerate: true,
      prompt: "Summarize the measured evidence.",
      codexModel: "gpt-5.5",
      claudeModel: "opus",
      geminiApiKey: "synthetic-summary-gemini-key",
      geminiModel: "gemini-flash-latest",
      vertexApiKey: "synthetic-summary-vertex-key",
      vertexModel: "gemini-3.6-flash",
    },
  };

  try {
    await writeSettings(settings);
    const loaded = await readSettings();

    assert.deepEqual(Object.keys(records), ["paperlens_settings_v1"]);
    assert.equal(loaded.providerSettings.gemini.apiKey, "synthetic-translation-gemini-key");
    assert.equal(loaded.providerSettings.vertex.apiKey, "synthetic-translation-vertex-key");
    assert.equal(loaded.providerSettings.openai.apiKey, "synthetic-translation-openai-key");
    assert.equal(loaded.providerSettings.anthropic.apiKey, "synthetic-translation-anthropic-key");
    assert.equal(loaded.providerSettings.custom.apiKey, "synthetic-translation-custom-key");
    assert.equal(loaded.summary.geminiApiKey, "synthetic-summary-gemini-key");
    assert.equal(loaded.summary.vertexApiKey, "synthetic-summary-vertex-key");
  } finally {
    if (previousChrome) {
      Object.defineProperty(globalThis, "chrome", previousChrome);
    } else {
      delete (globalThis as { chrome?: unknown }).chrome;
    }
  }
});
