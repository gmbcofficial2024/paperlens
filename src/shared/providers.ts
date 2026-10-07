import type { ProviderId } from "./types";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
  requiresApiKey: boolean;
  requiresUrl: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    defaultModel: "gemini-flash-latest",
    requiresApiKey: true,
    requiresUrl: false,
    models: [
      { id: "gemini-pro-latest", label: "Gemini Pro Latest" },
      { id: "gemini-flash-latest", label: "Gemini Flash Latest" },
      { id: "gemini-flash-lite-latest", label: "Gemini Flash Lite Latest" },
    ],
  },
  vertex: {
    id: "vertex",
    name: "Google Vertex AI",
    defaultModel: "gemini-3.8-flash",
    requiresApiKey: true,
    requiresUrl: false,
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-6.1-sol",
    requiresApiKey: true,
    requiresUrl: false,
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra" },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-6-luna", label: "GPT-6 Luna" },
    ],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    defaultModel: "claude-sonnet-5-5",
    requiresApiKey: true,
    requiresUrl: false,
    models: [
      { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  custom: {
    id: "custom",
    name: "Custom (OpenAI-Compatible)",
    defaultModel: "",
    requiresApiKey: true,
    requiresUrl: true,
    models: [],
  },
};

export const DEFAULT_PROVIDER: ProviderId = "gemini";

export function listProviders(): ProviderDefinition[] {
  return Object.values(PROVIDERS);
}
