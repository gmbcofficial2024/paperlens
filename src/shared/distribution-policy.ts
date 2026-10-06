import type { ExtensionSettings } from "./types";

declare const __PAPERLENS_DISTRIBUTION__: boolean;

export const IS_DISTRIBUTION = typeof __PAPERLENS_DISTRIBUTION__ !== "undefined"
  && __PAPERLENS_DISTRIBUTION__;
export const DISTRIBUTION_API_MODEL = "gemini-flash-latest";

export function applyDistributionPolicy(settings: ExtensionSettings): ExtensionSettings {
  if (!IS_DISTRIBUTION) return settings;
  return {
    ...settings,
    currentProvider: "gemini",
    providerSettings: {
      ...settings.providerSettings,
      gemini: { ...settings.providerSettings.gemini, model: DISTRIBUTION_API_MODEL },
    },
    summary: {
      ...settings.summary,
      provider: settings.summary.provider === "codex" || settings.summary.provider === "claude"
        ? settings.summary.provider
        : "gemini",
      geminiModel: DISTRIBUTION_API_MODEL,
    },
  };
}
