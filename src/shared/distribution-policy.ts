import type { ExtensionSettings } from "./types";

declare const __PAPERLENS_DISTRIBUTION__: boolean;

export const IS_DISTRIBUTION = typeof __PAPERLENS_DISTRIBUTION__ !== "undefined"
  && __PAPERLENS_DISTRIBUTION__;
export const DISTRIBUTION_API_MODEL = "gemini-flash-latest";

export function applyDistributionPolicy(settings: ExtensionSettings): ExtensionSettings {
  if (!IS_DISTRIBUTION) return settings;
  return {
    ...settings,
    providerSettings: {
      ...settings.providerSettings,
      gemini: { ...settings.providerSettings.gemini, model: DISTRIBUTION_API_MODEL },
    },
    summary: {
      ...settings.summary,
      geminiModel: DISTRIBUTION_API_MODEL,
    },
  };
}
