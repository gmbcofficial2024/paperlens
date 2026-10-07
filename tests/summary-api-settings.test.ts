import assert from "node:assert/strict";
import test from "node:test";
import { mergeSettings } from "../src/shared/schema";
import { readingSettings, runtimeRequestError } from "../src/shared/runtime-policy";

test("API summary settings roundtrip and migrate current presets without altering keys or native models", () => {
  for (const provider of ["openai", "anthropic"] as const) {
    const settings = mergeSettings({
      currentProvider: "vertex",
      summary: {
        provider,
        openaiApiKey: "synthetic-summary-openai-key",
        openaiModel: "gpt-5.6-luna",
        anthropicApiKey: "synthetic-summary-anthropic-key",
        anthropicModel: "claude-opus-4-8",
        codexModel: "private-codex-v7",
        claudeModel: "private-claude-v7",
      },
    });
    assert.equal(settings.summary.provider, provider);
    assert.equal(settings.summary.openaiModel, "gpt-6-luna");
    assert.equal(settings.summary.anthropicModel, "claude-opus-5-5");
    assert.equal(settings.summary.openaiApiKey, "synthetic-summary-openai-key");
    assert.equal(settings.summary.anthropicApiKey, "synthetic-summary-anthropic-key");
    assert.equal(settings.summary.codexModel, "private-codex-v7");
    assert.equal(settings.summary.claudeModel, "private-claude-v7");
    assert.equal(settings.currentProvider, "vertex");
    assert.deepEqual(mergeSettings(settings), settings);
    assert.equal(runtimeRequestError({ type: "settings/update", settings },
      { id: "test-extension", url: "chrome-extension://test-extension/options.html" }, "test-extension"), null);
    const redacted = readingSettings(settings);
    assert.equal(redacted.summary.provider, provider);
    assert.equal(redacted.summary.openaiModel, "gpt-6-luna");
    assert.doesNotMatch(JSON.stringify(redacted), /synthetic-summary-(?:openai|anthropic)-key/);
  }
});

test("unset API summary overrides remain unset so same-provider translation fallback can apply", () => {
  const settings = mergeSettings({ summary: { provider: "openai", openaiModel: " ", anthropicModel: "" } });
  assert.equal(settings.summary.openaiModel, undefined);
  assert.equal(settings.summary.anthropicModel, undefined);
  assert.equal(settings.summary.openaiApiKey, undefined);
  assert.equal(settings.summary.anthropicApiKey, undefined);
});
