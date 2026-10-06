import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderStreamDecoder,
  parseProviderResponse,
  prepareProviderRequest,
} from "../src/shared/provider-protocol";
import { PROVIDERS } from "../src/shared/providers";
import { mergeSettings } from "../src/shared/schema";
import { SseEventDecoder } from "../src/shared/sse";
import { buildVertexApiKeyUrl } from "../src/shared/vertex";

test("fixed provider registries expose the refreshed models and defaults", () => {
  assert.deepEqual(PROVIDERS.vertex.models.map(({ id }) => id), [
    "gemini-3.1-pro-preview",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ]);
  assert.equal(PROVIDERS.vertex.defaultModel, "gemini-3.6-flash");

  assert.deepEqual(PROVIDERS.openai.models.map(({ id }) => id), [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ]);
  assert.equal(PROVIDERS.openai.defaultModel, "gpt-5.6-terra");

  assert.deepEqual(PROVIDERS.anthropic.models.map(({ id }) => id), [
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-haiku-4-5-20251001",
  ]);
  assert.equal(PROVIDERS.anthropic.defaultModel, "claude-sonnet-5");
});

test("stored fixed-provider models migrate by product role", () => {
  const settings = mergeSettings({
    providerSettings: {
      vertex: { model: "google/gemini-3.5-flash" },
      openai: { model: "gpt-4o-mini" },
      anthropic: { model: "claude-sonnet-4-20250514" },
      custom: { model: "private-model-v7" },
    },
    summary: { vertexModel: "gemini-flash-lite-latest" },
  });

  assert.equal(settings.providerSettings.vertex.model, "gemini-3.6-flash");
  assert.equal(settings.providerSettings.openai.model, "gpt-5.6-luna");
  assert.equal(settings.providerSettings.anthropic.model, "claude-sonnet-5");
  assert.equal(settings.providerSettings.custom.model, "private-model-v7");
  assert.equal(settings.summary.vertexModel, "gemini-3.5-flash-lite");
});

test("every documented fixed-provider legacy model migrates to its current role", () => {
  const vertexMigrations = new Map([
    ["google/gemini-3.5-flash", "gemini-3.6-flash"],
    ["google/gemini-3.1-flash-lite", "gemini-3.5-flash-lite"],
    ["google/gemini-3.1-pro-preview", "gemini-3.1-pro-preview"],
    ["gemini-flash-latest", "gemini-3.6-flash"],
    ["gemini-flash-lite-latest", "gemini-3.5-flash-lite"],
    ["gemini-pro-latest", "gemini-3.1-pro-preview"],
    ["gemini-2.5-flash", "gemini-3.6-flash"],
    ["gemini-2.5-flash-lite", "gemini-3.5-flash-lite"],
    ["gemini-2.5-pro", "gemini-3.1-pro-preview"],
  ]);
  for (const [legacy, current] of vertexMigrations) {
    const settings = mergeSettings({ providerSettings: { vertex: { model: legacy } } });
    assert.equal(settings.providerSettings.vertex.model, current, legacy);
  }

  const openAiMigrations = new Map([
    ["gpt-4.1", "gpt-5.6-terra"],
    ["gpt-4o", "gpt-5.6-terra"],
    ["gpt-4o-mini", "gpt-5.6-luna"],
    ["o3-mini", "gpt-5.6-terra"],
  ]);
  for (const [legacy, current] of openAiMigrations) {
    const settings = mergeSettings({ providerSettings: { openai: { model: legacy } } });
    assert.equal(settings.providerSettings.openai.model, current, legacy);
  }

  const anthropicMigrations = new Map([
    ["claude-opus-4-20250514", "claude-opus-4-8"],
    ["claude-sonnet-4-20250514", "claude-sonnet-5"],
    ["claude-haiku-4-20250414", "claude-haiku-4-5-20251001"],
  ]);
  for (const [legacy, current] of anthropicMigrations) {
    const settings = mergeSettings({ providerSettings: { anthropic: { model: legacy } } });
    assert.equal(settings.providerSettings.anthropic.model, current, legacy);
  }
});

test("legacy bare and resource-path Vertex IDs preserve their product tier", () => {
  const bare = mergeSettings({
    providerSettings: {
      vertex: { model: "gemini-3.1-flash-lite" },
    },
    summary: { vertexModel: "gemini-3.5-flash" },
  });
  const resourcePath = mergeSettings({
    providerSettings: {
      vertex: {
        model: "projects/123/locations/us-central1/publishers/google/models/gemini-3.1-flash-lite",
      },
    },
  });

  assert.equal(bare.providerSettings.vertex.model, "gemini-3.5-flash-lite");
  assert.equal(bare.summary.vertexModel, "gemini-3.6-flash");
  assert.equal(resourcePath.providerSettings.vertex.model, "gemini-3.5-flash-lite");
});

test("unknown fixed-provider models fall back while absent and custom models are preserved", () => {
  const settings = mergeSettings({
    providerSettings: {
      vertex: { model: "unknown-vertex" },
      openai: { model: "unknown-openai" },
      anthropic: { model: "unknown-anthropic" },
      custom: { model: "  unknown-private-model  " },
    },
  });
  const absent = mergeSettings({ providerSettings: {} });

  assert.equal(settings.providerSettings.vertex.model, PROVIDERS.vertex.defaultModel);
  assert.equal(settings.providerSettings.openai.model, PROVIDERS.openai.defaultModel);
  assert.equal(settings.providerSettings.anthropic.model, PROVIDERS.anthropic.defaultModel);
  assert.equal(settings.providerSettings.custom.model, "  unknown-private-model  ");
  assert.equal(absent.providerSettings.vertex.model, undefined);
  assert.equal(absent.providerSettings.openai.model, undefined);
  assert.equal(absent.providerSettings.anthropic.model, undefined);
});

test("Vertex request URLs contain every bare refreshed model ID", () => {
  for (const model of [
    "gemini-3.1-pro-preview",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ]) {
    assert.equal(
      buildVertexApiKeyUrl({ apiKey: "key", model, stream: false }),
      `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=key`,
    );
  }
});

test("SSE decoder joins multiline data and accepts optional spaces and CRLF", () => {
  const decoder = new SseEventDecoder();
  const events = decoder.push(new TextEncoder().encode(
    "event: message\r\ndata:{\"a\":\r\ndata: 1}\r\n\r\n",
  ));

  assert.deepEqual(events, [{ event: "message", data: "{\"a\":\n1}" }]);
});

test("SSE decoder preserves byte-split Unicode and flushes the final event at EOF", () => {
  const bytes = new TextEncoder().encode("data: {\"text\":\"번역\"}");
  const decoder = new SseEventDecoder();

  assert.deepEqual(decoder.push(bytes.slice(0, bytes.length - 2)), []);
  assert.deepEqual(decoder.push(bytes.slice(bytes.length - 2)), []);
  assert.deepEqual(decoder.finish(), [{ data: "{\"text\":\"번역\"}" }]);
});

test("SSE decoder accepts LF, CR, and CRLF at every byte split", () => {
  const encoder = new TextEncoder();
  for (const newline of ["\n", "\r", "\r\n"]) {
    const bytes = encoder.encode(
      `event: message${newline}data:first${newline}data: second${newline}${newline}`,
    );
    for (let split = 0; split <= bytes.length; split++) {
      const decoder = new SseEventDecoder();
      const events = [
        ...decoder.push(bytes.slice(0, split)),
        ...decoder.push(bytes.slice(split)),
        ...decoder.finish(),
      ];
      assert.deepEqual(events, [{ event: "message", data: "first\nsecond" }]);
    }
  }
});

test("current Google and Anthropic requests omit sampling fields", () => {
  for (const provider of ["gemini", "vertex", "anthropic"] as const) {
    const request = prepareProviderRequest({
      provider,
      setting: { apiKey: "secret" },
      systemPrompt: "system",
      userPrompt: "user",
      outputMode: "json",
      stream: false,
    });
    const body = JSON.parse(String(request.init.body));

    assert.equal("temperature" in body, false);
    assert.equal("top_p" in body, false);
    assert.equal("top_k" in body, false);
    assert.equal("temperature" in (body.generationConfig ?? {}), false);
    assert.equal("topP" in (body.generationConfig ?? {}), false);
    assert.equal("topK" in (body.generationConfig ?? {}), false);
  }
});

test("Google request contracts preserve Gemini and Vertex casing and text output mode", () => {
  const gemini = prepareProviderRequest({
    provider: "gemini",
    setting: { apiKey: "gemini-key" },
    systemPrompt: "system",
    userPrompt: "user",
    outputMode: "text",
    stream: false,
  });
  const vertex = prepareProviderRequest({
    provider: "vertex",
    setting: { apiKey: "vertex-key" },
    systemPrompt: "system",
    userPrompt: "user",
    outputMode: "text",
    stream: false,
  });
  const geminiBody = JSON.parse(String(gemini.init.body));
  const vertexBody = JSON.parse(String(vertex.init.body));

  assert.deepEqual(geminiBody.system_instruction, { parts: [{ text: "system" }] });
  assert.equal("systemInstruction" in geminiBody, false);
  assert.deepEqual(geminiBody.generationConfig, {});
  assert.deepEqual(vertexBody.systemInstruction, { parts: [{ text: "system" }] });
  assert.equal("system_instruction" in vertexBody, false);
  assert.deepEqual(vertexBody.generationConfig, {});
});

test("OpenAI uses current defaults, developer instructions, JSON mode, and stream usage", () => {
  const request = prepareProviderRequest({
    provider: "openai",
    setting: { apiKey: "secret" },
    systemPrompt: "system",
    userPrompt: "user",
    outputMode: "json",
    stream: true,
  });
  const body = JSON.parse(String(request.init.body));

  assert.equal(body.model, "gpt-5.6-terra");
  assert.equal(body.messages[0].role, "developer");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.stream_options, { include_usage: true });
});

test("Anthropic Sonnet disables thinking and parses text blocks after thinking", () => {
  const request = prepareProviderRequest({
    provider: "anthropic",
    setting: { apiKey: "secret", model: "claude-sonnet-5" },
    systemPrompt: "system",
    userPrompt: "user",
    outputMode: "json",
    stream: false,
  });
  assert.deepEqual(JSON.parse(String(request.init.body)).thinking, { type: "disabled" });

  assert.deepEqual(parseProviderResponse("anthropic", {
    content: [
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "A" },
      { type: "text", text: "B" },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 4, output_tokens: 5 },
  }), { text: "AB", usage: { inputTokens: 4, outputTokens: 5 } });
});

test("Custom requests require a model and omit blank authorization", () => {
  const request = prepareProviderRequest({
    provider: "custom",
    setting: { customUrl: "https://example.test/v1/chat/completions", model: "private-v1" },
    systemPrompt: "system",
    userPrompt: "user",
    outputMode: "json",
    stream: false,
  });

  assert.equal(new Headers(request.init.headers).has("Authorization"), false);
  assert.throws(() => prepareProviderRequest({
    provider: "custom",
    setting: { customUrl: "https://example.test/v1/chat/completions" },
    systemPrompt: "system",
    userPrompt: "user",
    outputMode: "json",
    stream: false,
  }), /model/i);
});

test("Google joins non-thought parts and includes thought usage", () => {
  assert.deepEqual(parseProviderResponse("vertex", {
    candidates: [{
      finishReason: "STOP",
      content: { parts: [
        { thought: true, text: "hidden" },
        { text: "A" },
        { text: "B" },
      ] },
    }],
    usageMetadata: {
      promptTokenCount: 4,
      candidatesTokenCount: 5,
      thoughtsTokenCount: 6,
    },
  }), { text: "AB", usage: { inputTokens: 4, outputTokens: 11 } });
});

test("OpenAI and Custom preserve documented usage", () => {
  const payload = {
    choices: [{ finish_reason: "stop", message: { content: "translated" } }],
    usage: { prompt_tokens: 7, completion_tokens: 8 },
  };
  const expected = { text: "translated", usage: { inputTokens: 7, outputTokens: 8 } };

  assert.deepEqual(parseProviderResponse("openai", payload), expected);
  assert.deepEqual(parseProviderResponse("custom", payload), expected);
});

test("provider completed responses reject blocked, truncated, refused, and empty output", () => {
  assert.throws(() => parseProviderResponse("vertex", {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "partial" }] } }],
    error: { message: "provider failure" },
  }), /provider failure/i);
  assert.throws(() => parseProviderResponse("gemini", {
    promptFeedback: { blockReason: "SAFETY" },
  }), /blocked.*SAFETY/i);
  assert.throws(() => parseProviderResponse("openai", {
    choices: [{ finish_reason: "length", message: { content: "partial" } }],
  }), /truncated/i);
  assert.throws(() => parseProviderResponse("openai", {
    choices: [{ finish_reason: "content_filter", message: { content: "partial" } }],
  }), /content filter|blocked/i);
  assert.throws(() => parseProviderResponse("anthropic", {
    content: [{ type: "text", text: "refused" }],
    stop_reason: "refusal",
  }), /refusal/i);
  assert.throws(() => parseProviderResponse("anthropic", {
    content: [{ type: "text", text: "partial" }],
    stop_reason: "max_tokens",
  }), /truncated/i);
  assert.throws(() => parseProviderResponse("anthropic", {
    content: [{ type: "text", text: "partial" }],
    stop_reason: "model_context_window_exceeded",
  }), /context window|truncated/i);
  assert.throws(() => parseProviderResponse("custom", {
    choices: [{ finish_reason: "stop", message: { content: "" } }],
  }), /no text/i);
});

test("Google stream joins all non-thought parts and includes thought usage", () => {
  const chunks: string[] = [];
  const decoder = createProviderStreamDecoder("vertex", (delta) => chunks.push(delta));
  decoder.push(new TextEncoder().encode(
    "data: {\"candidates\":[{\"content\":{\"parts\":[{\"thought\":true,\"text\":\"hidden\"},{\"text\":\"A\"},{\"text\":\"B\"}]}}]}\n\n" +
    "data: {\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"text\":\"C\"}]}}],\"usageMetadata\":{\"promptTokenCount\":2,\"candidatesTokenCount\":3,\"thoughtsTokenCount\":4}}",
  ));

  assert.deepEqual(decoder.finish(), {
    text: "ABC",
    usage: { inputTokens: 2, outputTokens: 7 },
  });
  assert.deepEqual(chunks, ["AB", "C"]);
});

test("Google stream rejects an in-band error after partial text", () => {
  const decoder = createProviderStreamDecoder("vertex", () => undefined);
  decoder.push(new TextEncoder().encode(
    "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"partial\"}]}}]}\n\n" +
    "event: error\ndata: {\"error\":{\"message\":\"quota exhausted\"}}\n\n",
  ));

  assert.throws(() => decoder.finish(), /quota exhausted/i);
});

test("OpenAI stream accepts a usage-only chunk and requires DONE", () => {
  const chunks: string[] = [];
  const decoder = createProviderStreamDecoder("openai", (delta) => chunks.push(delta));
  decoder.push(new TextEncoder().encode(
    "data: {\"choices\":[{\"delta\":{\"content\":\"번역\"},\"finish_reason\":null}]}\n\n" +
    "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":6}}\n\n" +
    "data: [DONE]\n\n",
  ));

  assert.deepEqual(decoder.finish(), {
    text: "번역",
    usage: { inputTokens: 5, outputTokens: 6 },
  });
  assert.deepEqual(chunks, ["번역"]);

  const incomplete = createProviderStreamDecoder("openai", () => undefined);
  incomplete.push(new TextEncoder().encode(
    "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
  ));
  assert.throws(() => incomplete.finish(), /before \[DONE\]/i);
});

test("Anthropic stream ignores thinking, accumulates text, and requires message_stop", () => {
  const chunks: string[] = [];
  const decoder = createProviderStreamDecoder("anthropic", (delta) => chunks.push(delta));
  decoder.push(new TextEncoder().encode(
    "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":3,\"cache_read_input_tokens\":2}}}\n\n" +
    "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"x\"}}\n\n" +
    "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"번역\"}}\n\n" +
    "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":4}}\n\n" +
    "data: {\"type\":\"message_stop\"}\n\n",
  ));

  assert.deepEqual(decoder.finish(), {
    text: "번역",
    usage: { inputTokens: 5, outputTokens: 4 },
  });
  assert.deepEqual(chunks, ["번역"]);

  const incomplete = createProviderStreamDecoder("anthropic", () => undefined);
  incomplete.push(new TextEncoder().encode(
    "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"partial\"}}\n\n",
  ));
  assert.throws(() => incomplete.finish(), /message_stop/i);
});

test("provider stream surfaces in-band errors and truncation", () => {
  const anthropic = createProviderStreamDecoder("anthropic", () => undefined);
  anthropic.push(new TextEncoder().encode(
    "event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"overloaded\"}}\n\n",
  ));
  assert.throws(() => anthropic.finish(), /overloaded/i);

  const custom = createProviderStreamDecoder("custom", () => undefined);
  custom.push(new TextEncoder().encode(
    "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"length\"}]}\n\n" +
    "data: [DONE]\n\n",
  ));
  assert.throws(() => custom.finish(), /truncated/i);

  const contextLimited = createProviderStreamDecoder("anthropic", () => undefined);
  contextLimited.push(new TextEncoder().encode(
    "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"partial\"}}\n\n" +
    "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"model_context_window_exceeded\"}}\n\n" +
    "data: {\"type\":\"message_stop\"}\n\n",
  ));
  assert.throws(() => contextLimited.finish(), /context window|truncated/i);
});

test("live canary selection and status formatting are deterministic and secret-free", async () => {
  const canaryUrl = new URL("../scripts/provider-canary.mjs", import.meta.url);
  const {
    exitCodeForResults,
    selectedProviders,
    statusLine,
    withCanaryOutputLimit,
  } = await import(canaryUrl.href);
  const secret = "do-not-print-this-api-key";

  assert.deepEqual(selectedProviders([]), ["vertex", "openai", "anthropic"]);
  assert.deepEqual(selectedProviders(["--provider", "vertex"]), ["vertex"]);
  assert.deepEqual(selectedProviders(["vertex"]), ["vertex"]);
  assert.throws(() => selectedProviders(["--provider", "unsupported"]), /unsupported provider/i);
  const line = statusLine("vertex", "gemini-3.6-flash", "PASS");
  assert.equal(line, "vertex gemini-3.6-flash: PASS");
  assert.equal(line.includes(secret), false);
  assert.equal(exitCodeForResults([]), 0);
  assert.equal(exitCodeForResults([true, true]), 0);
  assert.equal(exitCodeForResults([true, false]), 1);
  assert.equal(withCanaryOutputLimit("vertex", { generationConfig: {} })
    .generationConfig.maxOutputTokens, 16);
  assert.equal(withCanaryOutputLimit("openai", {}).max_completion_tokens, 16);
  assert.equal(withCanaryOutputLimit("anthropic", { max_tokens: 16384 }).max_tokens, 16);
});
