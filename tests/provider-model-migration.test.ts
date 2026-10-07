import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings, mergeSettings } from "../src/shared/schema";

const legacySettings = () => ({
  currentProvider: "openai",
  providerSettings: {
    gemini: { apiKey: "synthetic-gemini-key", model: "gemini-flash-latest" },
    vertex: { apiKey: "synthetic-vertex-key", model: "gemini-3.6-flash" },
    openai: { apiKey: "synthetic-openai-key", model: "gpt-5.6-sol" },
    anthropic: { apiKey: "synthetic-anthropic-key", model: "claude-opus-4-8" },
    custom: {
      apiKey: "synthetic-custom-key",
      model: "private-model-v7",
      customUrl: "https://custom.example.test/v1/chat/completions",
    },
  },
  cacheEnabled: true,
  maxConcurrency: 2,
  customPrompt: "Preserve scientific qualifications.",
  summary: {
    provider: "codex",
    autoGenerate: true,
    prompt: "Summarize the supplied evidence.",
    codexModel: "gpt-5.5",
    claudeModel: "opus",
    geminiModel: "gemini-flash-latest",
    geminiApiKey: "synthetic-summary-gemini-key",
    vertexModel: "gemini-3.6-flash",
    vertexApiKey: "synthetic-summary-vertex-key",
  },
});

test("known OpenAI model migrations preserve balanced and economical choices", () => {
  for (const [previous, current] of [
    ["gpt-5.6-sol", "gpt-6.1-sol"],
    ["gpt-5.6-terra", "gpt-6.1-sol"],
    ["gpt-5.6-luna", "gpt-6-luna"],
    ["gpt-4.1", "gpt-6.1-sol"],
    ["gpt-4o", "gpt-6.1-sol"],
    ["gpt-4o-mini", "gpt-6-luna"],
    ["o3-mini", "gpt-6.1-sol"],
  ]) {
    const raw = legacySettings();
    raw.providerSettings.openai.model = previous;
    const migrated = mergeSettings(raw);
    assert.equal(migrated.providerSettings.openai.model, current, previous);
    assert.equal(migrated.providerSettings.openai.apiKey, raw.providerSettings.openai.apiKey);
    assert.equal(migrated.currentProvider, "openai");
  }
});

test("known Anthropic model migrations retain Opus, Sonnet and Haiku roles", () => {
  for (const [previous, current] of [
    ["claude-opus-4-8", "claude-opus-5-5"],
    ["claude-sonnet-5", "claude-sonnet-5-5"],
    ["claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001"],
    ["claude-opus-4-20250514", "claude-opus-5-5"],
    ["claude-sonnet-4-20250514", "claude-sonnet-5-5"],
    ["claude-haiku-4-20250414", "claude-haiku-4-5-20251001"],
  ]) {
    const raw = legacySettings();
    raw.currentProvider = "anthropic";
    raw.providerSettings.anthropic.model = previous;
    const migrated = mergeSettings(raw);
    assert.equal(migrated.providerSettings.anthropic.model, current, previous);
    assert.equal(migrated.providerSettings.anthropic.apiKey, raw.providerSettings.anthropic.apiKey);
    assert.equal(migrated.currentProvider, "anthropic");
  }
});

test("model refresh preserves every key, provider, custom endpoint and unrelated setting", () => {
  const raw = legacySettings();
  const migrated = mergeSettings(raw);
  assert.equal(migrated.providerSettings.openai.model, "gpt-6.1-sol");
  assert.equal(migrated.providerSettings.anthropic.model, "claude-opus-5-5");
  assert.equal(migrated.providerSettings.vertex.model, "gemini-3.8-flash");
  assert.equal(migrated.summary.vertexModel, "gemini-3.8-flash");
  for (const provider of ["gemini", "vertex", "openai", "anthropic", "custom"] as const) {
    assert.equal(migrated.providerSettings[provider].apiKey, raw.providerSettings[provider].apiKey);
  }
  assert.deepEqual(migrated.providerSettings.custom, raw.providerSettings.custom);
  assert.equal(migrated.summary.geminiApiKey, raw.summary.geminiApiKey);
  assert.equal(migrated.summary.vertexApiKey, raw.summary.vertexApiKey);
  assert.equal(migrated.summary.codexModel, "gpt-6.1-sol");
  assert.equal(migrated.summary.claudeModel, "opus");
  assert.equal(migrated.summary.provider, "codex");
  assert.equal(migrated.summary.autoGenerate, true);
  assert.equal(migrated.summary.prompt, raw.summary.prompt);
  assert.equal(migrated.currentProvider, raw.currentProvider);
  assert.equal(migrated.cacheEnabled, raw.cacheEnabled);
  assert.equal(migrated.maxConcurrency, raw.maxConcurrency);
  assert.equal(migrated.customPrompt, raw.customPrompt);
  assert.deepEqual(mergeSettings(migrated), migrated);
});

test("current explicit API model IDs survive migration unchanged", () => {
  for (const model of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]) {
    assert.equal(mergeSettings({ providerSettings: { openai: { model } } })
      .providerSettings.openai.model, model);
  }
  for (const model of ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"]) {
    assert.equal(mergeSettings({ providerSettings: { anthropic: { model } } })
      .providerSettings.anthropic.model, model);
  }
});

test("Codex default refresh migrates only the exact previous default", () => {
  assert.equal(defaultSettings().summary.codexModel, "gpt-6.1-sol");
  assert.equal(mergeSettings({ summary: { codexModel: "gpt-5.5" } }).summary.codexModel, "gpt-6.1-sol");
  for (const model of ["gpt-5.5-pro", "gpt-5.6-sol", "gpt-6-astra", "private-codex-model-v7"]) {
    assert.equal(mergeSettings({ summary: { provider: "codex", codexModel: model } })
      .summary.codexModel, model);
  }
  assert.equal(defaultSettings().summary.claudeModel, "opus");
});
