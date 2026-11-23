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
      { id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
      { id: "gemini-4-neon", label: "Gemini 4 Neon" },
      { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
      { id: "gemini-pro-latest", label: "Gemini Pro Latest" },
      { id: "gemini-flash-latest", label: "Gemini Flash Latest" },
      { id: "gemini-flash-lite-latest", label: "Gemini Flash Lite Latest" },
    ],
  },
  vertex: {
    id: "vertex",
    name: "Google Vertex AI",
    defaultModel: "gemini-4-hydrogen",
    requiresApiKey: true,
    requiresUrl: false,
    models: [
      { id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
      { id: "gemini-4-neon", label: "Gemini 4 Neon" },
      { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-6.2-sol",
    requiresApiKey: true,
    requiresUrl: false,
    models: [
      { id: "gpt-6.2-astra", label: "GPT-6.2 Astra" },
      { id: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
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
      { id: "claude-fable-5-2", label: "Claude Fable 5.2" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
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
