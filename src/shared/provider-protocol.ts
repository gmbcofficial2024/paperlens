import { PROVIDERS } from "./providers";
import { SseEventDecoder, type SseEvent } from "./sse";
import { buildVertexApiKeyUrl, buildVertexBody } from "./vertex";
import type { ProviderId, ProviderSetting, TokenUsage } from "./types";

export type ProviderOutputMode = "json" | "text";

export interface ProviderCallOptions {
  provider: ProviderId;
  setting: ProviderSetting;
  systemPrompt: string;
  userPrompt: string;
  outputMode: ProviderOutputMode;
  stream: boolean;
}

export interface PreparedProviderRequest {
  url: string;
  init: RequestInit;
}

export interface ProviderPayloadResult {
  text: string;
  usage?: TokenUsage;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function required(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function jsonRequest(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): PreparedProviderRequest {
  return {
    url,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  };
}

export function prepareProviderRequest(options: ProviderCallOptions): PreparedProviderRequest {
  const { provider, setting, systemPrompt, userPrompt, outputMode, stream } = options;
  const model = setting.model?.trim() || PROVIDERS[provider].defaultModel;

  switch (provider) {
    case "gemini":
      return jsonRequest(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
        {
          "Content-Type": "application/json",
          "x-goog-api-key": required(setting.apiKey, "Gemini API key is not configured."),
        },
        {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: outputMode === "json"
            ? { responseMimeType: "application/json" }
            : {},
        },
      );

    case "vertex":
      return jsonRequest(
        buildVertexApiKeyUrl({ apiKey: setting.apiKey, model, stream }),
        { "Content-Type": "application/json" },
        buildVertexBody(
          systemPrompt,
          userPrompt,
          outputMode === "json" ? "application/json" : undefined,
        ),
      );

    case "openai":
      return jsonRequest(
        "https://api.openai.com/v1/chat/completions",
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${required(setting.apiKey, "OpenAI API key is not configured.")}`,
        },
        {
          model,
          temperature: 0.3,
          ...(outputMode === "json" ? { response_format: { type: "json_object" } } : {}),
          ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
          messages: [
            { role: "developer", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
      );

    case "anthropic":
      return jsonRequest(
        "https://api.anthropic.com/v1/messages",
        {
          "Content-Type": "application/json",
          "x-api-key": required(setting.apiKey, "Anthropic API key is not configured."),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        {
          model,
          max_tokens: 16384,
          ...(model === "claude-sonnet-5" ? { thinking: { type: "disabled" } } : {}),
          ...(stream ? { stream: true } : {}),
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
      );

    case "custom": {
      const customModel = required(setting.model, "Custom provider model is not configured.");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (setting.apiKey?.trim()) {
        headers.Authorization = `Bearer ${setting.apiKey.trim()}`;
      }
      return jsonRequest(
        required(setting.customUrl, "Custom provider URL is not configured."),
        headers,
        {
          model: customModel,
          temperature: 0.3,
          ...(outputMode === "json" && !stream
            ? { response_format: { type: "json_object" } }
            : {}),
          ...(stream ? { stream: true } : {}),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
      );
    }
  }
}

function googleText(payload: unknown): ProviderPayloadResult {
  const root = asRecord(payload);
  const providerError = asRecord(root?.error);
  if (providerError) {
    throw new Error(
      typeof providerError.message === "string"
        ? providerError.message
        : "Google provider error.",
    );
  }
  const promptFeedback = asRecord(root?.promptFeedback);
  const blocked = promptFeedback?.blockReason;
  if (typeof blocked === "string" && blocked) {
    throw new Error(`Google blocked the prompt: ${blocked}.`);
  }

  const candidate = asRecordArray(root?.candidates)[0];
  if (!candidate) throw new Error("Google returned no candidate.");
  const finishReason = candidate.finishReason;
  if (typeof finishReason === "string" && finishReason && finishReason !== "STOP") {
    throw new Error(`Google stopped with ${finishReason}.`);
  }

  const content = asRecord(candidate.content);
  const text = asRecordArray(content?.parts)
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
  if (!text) throw new Error("Google returned no text.");

  const metadata = asRecord(root?.usageMetadata);
  return {
    text,
    usage: metadata ? {
      inputTokens: tokenCount(metadata.promptTokenCount),
      outputTokens: tokenCount(metadata.candidatesTokenCount)
        + tokenCount(metadata.thoughtsTokenCount),
    } : undefined,
  };
}

function openAiText(payload: unknown): ProviderPayloadResult {
  const root = asRecord(payload);
  const providerError = asRecord(root?.error);
  if (providerError) {
    throw new Error(
      typeof providerError.message === "string"
        ? providerError.message
        : "OpenAI-compatible provider error.",
    );
  }

  const choice = asRecordArray(root?.choices)[0];
  if (!choice) throw new Error("OpenAI-compatible provider returned no choice.");
  if (choice.finish_reason === "length") {
    throw new Error("OpenAI-compatible output was truncated.");
  }
  if (choice.finish_reason === "content_filter") {
    throw new Error("OpenAI-compatible output was blocked by a content filter.");
  }

  const message = asRecord(choice.message);
  if (typeof message?.refusal === "string" && message.refusal) {
    throw new Error("OpenAI-compatible provider returned a refusal.");
  }
  const text = message?.content;
  if (typeof text !== "string" || !text) {
    throw new Error("OpenAI-compatible provider returned no text.");
  }

  const usage = asRecord(root?.usage);
  return {
    text,
    usage: usage ? {
      inputTokens: tokenCount(usage.prompt_tokens),
      outputTokens: tokenCount(usage.completion_tokens),
    } : undefined,
  };
}

function anthropicText(payload: unknown): ProviderPayloadResult {
  const root = asRecord(payload);
  const providerError = asRecord(root?.error);
  if (providerError) {
    throw new Error(
      typeof providerError.message === "string"
        ? providerError.message
        : "Anthropic error.",
    );
  }
  if (root?.stop_reason === "refusal") {
    throw new Error("Anthropic returned a refusal.");
  }
  if (root?.stop_reason === "max_tokens") {
    throw new Error("Anthropic output was truncated.");
  }
  if (root?.stop_reason === "model_context_window_exceeded") {
    throw new Error("Anthropic stopped because the context window was exceeded.");
  }
  if (root?.stop_reason === "pause_turn") {
    throw new Error("Anthropic paused before completing the response.");
  }

  const text = asRecordArray(root?.content)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
  if (!text) throw new Error("Anthropic returned no text.");

  const usage = asRecord(root?.usage);
  return {
    text,
    usage: usage ? {
      inputTokens: tokenCount(usage.input_tokens)
        + tokenCount(usage.cache_creation_input_tokens)
        + tokenCount(usage.cache_read_input_tokens),
      outputTokens: tokenCount(usage.output_tokens),
    } : undefined,
  };
}

export function parseProviderResponse(
  provider: ProviderId,
  payload: unknown,
): ProviderPayloadResult {
  switch (provider) {
    case "gemini":
    case "vertex":
      return googleText(payload);
    case "openai":
    case "custom":
      return openAiText(payload);
    case "anthropic":
      return anthropicText(payload);
  }
}

export interface ProviderStreamDecoder {
  push(chunk: Uint8Array): void;
  finish(): ProviderPayloadResult;
}

class ProviderStreamDecoderImpl implements ProviderStreamDecoder {
  private readonly sse = new SseEventDecoder();
  private text = "";
  private usage: TokenUsage | undefined;
  private seenDone = false;
  private seenMessageStop = false;
  private terminalError: Error | undefined;

  constructor(
    private readonly provider: ProviderId,
    private readonly onText: (delta: string) => void,
  ) {}

  push(chunk: Uint8Array): void {
    for (const event of this.sse.push(chunk)) {
      this.consume(event);
    }
  }

  finish(): ProviderPayloadResult {
    for (const event of this.sse.finish()) {
      this.consume(event);
    }

    if (this.terminalError) throw this.terminalError;
    if ((this.provider === "openai" || this.provider === "custom") && !this.seenDone) {
      throw new Error(`${this.provider} stream ended before [DONE].`);
    }
    if (this.provider === "anthropic" && !this.seenMessageStop) {
      throw new Error("Anthropic stream ended before message_stop.");
    }
    if (!this.text) throw new Error(`${this.provider} stream returned no text.`);

    return {
      text: this.text,
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }

  private append(delta: unknown): void {
    if (typeof delta !== "string" || !delta) return;
    this.text += delta;
    this.onText(delta);
  }

  private fail(message: string): void {
    this.terminalError ??= new Error(message);
  }

  private consume(event: SseEvent): void {
    const { data } = event;
    if (data === "[DONE]") {
      this.seenDone = true;
      return;
    }
    if (this.terminalError) return;

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      this.fail(`${this.provider} returned malformed stream JSON.`);
      return;
    }

    const root = asRecord(payload);
    if (!root) {
      this.fail(`${this.provider} returned malformed stream JSON.`);
      return;
    }
    if (event.event === "error") {
      const providerError = asRecord(root.error);
      this.fail(
        typeof providerError?.message === "string"
          ? providerError.message
          : `${this.provider} stream error.`,
      );
      return;
    }

    if (this.provider === "gemini" || this.provider === "vertex") {
      this.consumeGoogle(root);
      return;
    }
    if (this.provider === "openai" || this.provider === "custom") {
      this.consumeOpenAi(root);
      return;
    }
    this.consumeAnthropic(root);
  }

  private consumeGoogle(payload: JsonRecord): void {
    const providerError = asRecord(payload.error);
    if (providerError) {
      this.fail(
        typeof providerError.message === "string"
          ? providerError.message
          : "Google stream error.",
      );
      return;
    }
    const promptFeedback = asRecord(payload.promptFeedback);
    if (typeof promptFeedback?.blockReason === "string" && promptFeedback.blockReason) {
      this.fail(`Google blocked the prompt: ${promptFeedback.blockReason}.`);
      return;
    }

    const candidate = asRecordArray(payload.candidates)[0];
    if (candidate) {
      const finishReason = candidate.finishReason;
      if (typeof finishReason === "string" && finishReason && finishReason !== "STOP") {
        this.fail(`Google stopped with ${finishReason}.`);
        return;
      }
      const content = asRecord(candidate.content);
      const delta = asRecordArray(content?.parts)
        .filter((part) => part.thought !== true && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("");
      this.append(delta);
    }

    const metadata = asRecord(payload.usageMetadata);
    if (metadata) {
      this.usage = {
        inputTokens: tokenCount(metadata.promptTokenCount),
        outputTokens: tokenCount(metadata.candidatesTokenCount)
          + tokenCount(metadata.thoughtsTokenCount),
      };
    }
  }

  private consumeOpenAi(payload: JsonRecord): void {
    const providerError = asRecord(payload.error);
    if (providerError) {
      this.fail(
        typeof providerError.message === "string"
          ? providerError.message
          : "OpenAI-compatible stream error.",
      );
      return;
    }

    const choice = asRecordArray(payload.choices)[0];
    if (choice?.finish_reason === "length") {
      this.fail("OpenAI-compatible output was truncated.");
      return;
    }
    if (choice?.finish_reason === "content_filter") {
      this.fail("OpenAI-compatible output was blocked by a content filter.");
      return;
    }
    const delta = asRecord(choice?.delta);
    if (typeof delta?.refusal === "string" && delta.refusal) {
      this.fail("OpenAI-compatible provider returned a refusal.");
      return;
    }
    this.append(delta?.content);

    const usage = asRecord(payload.usage);
    if (usage) {
      this.usage = {
        inputTokens: tokenCount(usage.prompt_tokens),
        outputTokens: tokenCount(usage.completion_tokens),
      };
    }
  }

  private consumeAnthropic(payload: JsonRecord): void {
    if (payload.type === "error") {
      const providerError = asRecord(payload.error);
      this.fail(
        typeof providerError?.message === "string"
          ? providerError.message
          : "Anthropic stream error.",
      );
      return;
    }

    if (payload.type === "content_block_delta") {
      const delta = asRecord(payload.delta);
      if (delta?.type === "text_delta") this.append(delta.text);
      return;
    }

    if (payload.type === "message_start") {
      const message = asRecord(payload.message);
      const usage = asRecord(message?.usage);
      if (usage) {
        this.usage = {
          inputTokens: tokenCount(usage.input_tokens)
            + tokenCount(usage.cache_creation_input_tokens)
            + tokenCount(usage.cache_read_input_tokens),
          outputTokens: tokenCount(usage.output_tokens),
        };
      }
      return;
    }

    if (payload.type === "message_delta") {
      const delta = asRecord(payload.delta);
      if (delta?.stop_reason === "refusal") {
        this.fail("Anthropic returned a refusal.");
        return;
      }
      if (delta?.stop_reason === "max_tokens") {
        this.fail("Anthropic output was truncated.");
        return;
      }
      if (delta?.stop_reason === "model_context_window_exceeded") {
        this.fail("Anthropic stopped because the context window was exceeded.");
        return;
      }
      if (delta?.stop_reason === "pause_turn") {
        this.fail("Anthropic paused before completing the response.");
        return;
      }
      const usage = asRecord(payload.usage);
      if (usage) {
        this.usage ??= { inputTokens: 0, outputTokens: 0 };
        this.usage.outputTokens = tokenCount(usage.output_tokens);
      }
      return;
    }

    if (payload.type === "message_stop") {
      this.seenMessageStop = true;
    }
  }
}

export function createProviderStreamDecoder(
  provider: ProviderId,
  onText: (delta: string) => void,
): ProviderStreamDecoder {
  return new ProviderStreamDecoderImpl(provider, onText);
}
