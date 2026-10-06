import type { ExtensionSettings } from "./types";
import { mergeSettings } from "./schema";

const SETTINGS_KEY = "paperlens_settings_v1";

export async function readSettings(): Promise<ExtensionSettings> {
  const raw = await chrome.storage.local.get([SETTINGS_KEY]);
  return mergeSettings(raw[SETTINGS_KEY]);
}

export async function writeSettings(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const normalized = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export async function patchSettings(
  patch: Partial<ExtensionSettings> | ((current: ExtensionSettings) => ExtensionSettings),
): Promise<ExtensionSettings> {
  const current = await readSettings();
  const next =
    typeof patch === "function"
      ? patch(current)
      : {
          ...current,
          ...patch,
          providerSettings: {
            ...current.providerSettings,
            ...(patch.providerSettings ?? {}),
          },
        };
  return writeSettings(next);
}
