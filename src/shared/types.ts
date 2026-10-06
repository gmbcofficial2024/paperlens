export const PROVIDER_IDS = ["gemini", "vertex", "openai", "anthropic", "custom"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const SUMMARY_PROVIDER_IDS = ["codex", "claude", "gemini", "vertex"] as const;
export type SummaryProviderId = (typeof SUMMARY_PROVIDER_IDS)[number];

export interface ProviderSetting {
  apiKey?: string;
  model?: string;
  customUrl?: string;
}

export interface ExtensionSettings {
  translationConfigKey?: string;
  currentProvider: ProviderId;
  providerSettings: Record<ProviderId, ProviderSetting>;
  cacheEnabled: boolean;
  maxConcurrency: number;
  customPrompt: string;
  summary: SummarySettings;
}

export interface SummarySettings {
  provider: SummaryProviderId;
  autoGenerate: boolean;
  prompt: string;
  codexModel?: string;
  claudeModel?: string;
  geminiModel?: string;
  geminiApiKey?: string;
  vertexApiKey?: string;
  vertexModel?: string;
}

export interface SentenceAlignment {
  original: string;
  translated: string;
}

export interface ParagraphResult {
  translation: string;
  alignment: SentenceAlignment[];
}

export interface TranslationResult {
  translation: string;
  alignment: SentenceAlignment[];
  usage?: TokenUsage;
}

export interface SummaryResult {
  summary: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CacheEntry {
  hash: string;
  paragraphs: ParagraphResult[];
  timestamp: number;
  size: number;
}

export interface CacheIndex {
  entries: Array<{ hash: string; timestamp: number; size: number }>;
}
