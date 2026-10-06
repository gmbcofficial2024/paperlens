import assert from "node:assert/strict";
import test from "node:test";
import {defaultSettings} from "../src/shared/schema";
import {readingSettings, runtimeRequestError, translationConfigurationKey, assertTranslationConfiguration} from "../src/shared/runtime-policy";

test("content settings omit every API key while keeping reading preferences and saved settings intact", () => {
  const saved = defaultSettings();
  saved.providerSettings.gemini.apiKey = "secret-gemini";
  saved.providerSettings.custom.apiKey = "secret-custom";
  saved.providerSettings.custom.customUrl = "https://example.test/api?token=secret";
  saved.summary.geminiApiKey = "secret-summary";
  saved.summary.vertexApiKey = "secret-vertex";
  saved.customPrompt = "Keep units.";
  const visible = readingSettings(saved);
  assert.equal(JSON.stringify(visible).includes("secret"), false);
  assert.equal(visible.customPrompt, "Keep units.");
  assert.equal(saved.providerSettings.gemini.apiKey, "secret-gemini");
});

test("a changed provider endpoint or model cannot put new results in an old translation cache", async () => {
  const saved = defaultSettings();
  saved.currentProvider = "custom";
  saved.providerSettings.custom = {apiKey: "secret", model: "model-a", customUrl: "https://one.example/api"};
  const initial = await translationConfigurationKey(saved);
  await assertTranslationConfiguration(saved, initial);
  const changed = {...saved, providerSettings: {...saved.providerSettings, custom: {...saved.providerSettings.custom, customUrl: "https://two.example/api"}}};
  assert.notEqual(await translationConfigurationKey(changed), initial);
  await assert.rejects(assertTranslationConfiguration(changed, initial), /Reload/);
});

test("runtime boundary rejects malformed or unauthorized input before any provider or storage call", () => {
  assert.ok(runtimeRequestError({type: "summary/generate", articleText: {bad: true}}, {}, "paperlens"));
  assert.ok(runtimeRequestError({type: "summary/generate", articleText: "source", kind: "system"}, {}, "paperlens"));
  assert.ok(runtimeRequestError({type: "settings/get"}, {id: "different-extension"}, "paperlens"));
  assert.ok(runtimeRequestError({type: "settings/update", settings: defaultSettings()}, {tab: {id: 1}}, "paperlens"));
  assert.ok(runtimeRequestError({type: "unknown"}, {}, "paperlens"));
  assert.equal(runtimeRequestError({type: "summary/generate", articleText: "source", kind: "article"}, {id: "paperlens", tab: {id: 1}}, "paperlens"), null);
});
