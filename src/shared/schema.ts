import { z } from "zod";
import { applyDistributionPolicy } from "./distribution-policy";
import {
  PROVIDER_IDS,
  SUMMARY_PROVIDER_IDS,
  type ExtensionSettings,
  type ProviderSetting,
  type ProviderId,
  type SummarySettings,
} from "./types";
import { DEFAULT_PROVIDER, PROVIDERS } from "./providers";
import {
  DEFAULT_CLAUDE_SUMMARY_MODEL,
  DEFAULT_CODEX_SUMMARY_MODEL,
  DEFAULT_SUMMARY_PROMPT,
} from "./summary-prompts";
import { normalizeOptionalVertexModel } from "./vertex";

const OPENAI_MODEL_MIGRATIONS: Record<string, string> = {
  "gpt-5.6-sol": "gpt-6.1-sol",
  "gpt-5.6-terra": "gpt-6.1-sol",
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-4.1": "gpt-6.1-sol",
  "gpt-4o": "gpt-6.1-sol",
  "gpt-4o-mini": "gpt-6-luna",
  "o3-mini": "gpt-6.1-sol",
};

const ANTHROPIC_MODEL_MIGRATIONS: Record<string, string> = {
  "claude-opus-4-8": "claude-opus-5-5",
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-opus-4-20250514": "claude-opus-5-5",
  "claude-sonnet-4-20250514": "claude-sonnet-5-5",
  "claude-haiku-4-20250414": "claude-haiku-4-5-20251001",
};

const providerSettingSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  customUrl: z.string().optional(),
});

const providerSettingsSchema = z.object({
  gemini: providerSettingSchema,
  vertex: providerSettingSchema,
  openai: providerSettingSchema,
  anthropic: providerSettingSchema,
  custom: providerSettingSchema,
});

const summarySettingsSchema = z.object({
  provider: z.enum(SUMMARY_PROVIDER_IDS).default("gemini"),
  autoGenerate: z.boolean().default(false),
  prompt: z.string().default(DEFAULT_SUMMARY_PROMPT),
  codexModel: z.string().default(DEFAULT_CODEX_SUMMARY_MODEL),
  claudeModel: z.string().default(DEFAULT_CLAUDE_SUMMARY_MODEL),
  geminiModel: z.string().optional(),
  geminiApiKey: z.string().optional(),
  vertexApiKey: z.string().optional(),
  vertexModel: z.string().optional(),
});

export const settingsSchema = z.object({
  currentProvider: z.enum(PROVIDER_IDS).default(DEFAULT_PROVIDER),
  providerSettings: providerSettingsSchema.default({
    gemini: {},
    vertex: {},
    openai: {},
    anthropic: {},
    custom: {},
  }),
  cacheEnabled: z.boolean().default(true),
  maxConcurrency: z.number().int().min(1).max(10).default(3),
  customPrompt: z.string().default(""),
  summary: summarySettingsSchema.default({
    provider: "gemini",
    autoGenerate: false,
    prompt: DEFAULT_SUMMARY_PROMPT,
    codexModel: DEFAULT_CODEX_SUMMARY_MODEL,
    claudeModel: DEFAULT_CLAUDE_SUMMARY_MODEL,
  }),
});

export function defaultProviderSettings(): Record<ProviderId, ProviderSetting> {
  return { gemini: {}, vertex: {}, openai: {}, anthropic: {}, custom: {} };
}

export function defaultSettings(): ExtensionSettings {
  return applyDistributionPolicy(settingsSchema.parse({ providerSettings: defaultProviderSettings() }));
}

function normalizeFixedModel(
  provider: "gemini" | "openai" | "anthropic",
  model: string | undefined,
  migrations: Record<string, string> = {},
): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  const migrated = migrations[trimmed] ?? trimmed;
  return PROVIDERS[provider].models.some(({ id }) => id === migrated)
    ? migrated
    : PROVIDERS[provider].defaultModel;
}

export function mergeSettings(raw: unknown): ExtensionSettings {
  const defaults = defaultSettings();
  const obj = (raw != null && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const ps = (obj.providerSettings != null && typeof obj.providerSettings === "object")
    ? obj.providerSettings as Record<string, unknown>
    : {};
  const providerSettings = migrateProviderSettings(defaults.providerSettings, ps);
  const summary = mergeSummarySettings(defaults.summary, obj.summary);
  return applyDistributionPolicy(settingsSchema.parse({
    ...defaults,
    ...obj,
    providerSettings,
    summary,
  }));
}

function mergeSummarySettings(defaults: SummarySettings, rawSummary: unknown): SummarySettings {
  const raw = (rawSummary != null && typeof rawSummary === "object")
    ? rawSummary as Partial<SummarySettings>
    : {};
  const vertexModel = normalizeOptionalVertexModel(raw.vertexModel ?? defaults.vertexModel);
  return {
    ...defaults,
    ...raw,
    ...(raw.codexModel === "gpt-5.5" ? { codexModel: DEFAULT_CODEX_SUMMARY_MODEL } : {}),
    vertexModel,
    prompt: typeof raw.prompt === "string" && raw.prompt.trim()
      ? raw.prompt
      : defaults.prompt,
  };
}

function migrateProviderSettings(
  defaults: Record<ProviderId, ProviderSetting>,
  rawProviderSettings: Record<string, unknown>,
): Record<ProviderId, ProviderSetting> {
  const merged = {
    ...defaults,
    ...rawProviderSettings,
  } as Record<ProviderId, ProviderSetting>;

  const gemini = {
    ...defaults.gemini,
    ...(rawProviderSettings.gemini != null && typeof rawProviderSettings.gemini === "object"
      ? rawProviderSettings.gemini as ProviderSetting
      : {}),
  };

  const vertex = {
    ...defaults.vertex,
    ...(rawProviderSettings.vertex != null && typeof rawProviderSettings.vertex === "object"
      ? rawProviderSettings.vertex as ProviderSetting
      : {}),
  };

  return {
    ...merged,
    gemini: {
      ...gemini,
      model: normalizeFixedModel("gemini", gemini.model),
    },
    vertex: {
      ...vertex,
      model: normalizeOptionalVertexModel(vertex.model),
    },
    openai: {
      ...defaults.openai,
      ...(rawProviderSettings.openai != null && typeof rawProviderSettings.openai === "object"
        ? rawProviderSettings.openai as ProviderSetting
        : {}),
      model: normalizeFixedModel(
        "openai",
        rawProviderSettings.openai != null && typeof rawProviderSettings.openai === "object"
          ? (rawProviderSettings.openai as ProviderSetting).model
          : undefined,
        OPENAI_MODEL_MIGRATIONS,
      ),
    },
    anthropic: {
      ...defaults.anthropic,
      ...(rawProviderSettings.anthropic != null && typeof rawProviderSettings.anthropic === "object"
        ? rawProviderSettings.anthropic as ProviderSetting
        : {}),
      model: normalizeFixedModel(
        "anthropic",
        rawProviderSettings.anthropic != null && typeof rawProviderSettings.anthropic === "object"
          ? (rawProviderSettings.anthropic as ProviderSetting).model
          : undefined,
        ANTHROPIC_MODEL_MIGRATIONS,
      ),
    },
  };
}
