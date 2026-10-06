import type {ExtensionSettings} from "./types";
import {z} from "zod";
import {settingsSchema} from "./schema";
import {hashText} from "./cache";
import {PROVIDERS} from "./providers";

export async function translationConfigurationKey(settings: ExtensionSettings): Promise<string> {
  const provider = settings.currentProvider;
  const setting = settings.providerSettings[provider];
  return hashText(JSON.stringify({provider, model: setting.model || PROVIDERS[provider].defaultModel,
    endpoint: provider === "custom" ? setting.customUrl : undefined, customPrompt: settings.customPrompt}));
}

export async function assertTranslationConfiguration(settings: ExtensionSettings, key?: string): Promise<void> {
  if (key && key !== await translationConfigurationKey(settings)) {
    throw new Error("PaperLens settings changed. Reload this page to start with the saved provider settings.");
  }
}

const paragraph = z.object({translation: z.string(), alignment: z.array(z.object({original: z.string(), translated: z.string()}))});
const sourceText = z.string().min(1).max(64 * 1024 * 1024);
const requestSchema = z.discriminatedUnion("type", [
  z.object({type: z.literal("settings/get")}),
  z.object({type: z.literal("settings/update"), settings: settingsSchema}),
  z.object({type: z.literal("translate/paragraph"), text: sourceText, paragraphId: z.string().max(256)}),
  z.object({type: z.literal("summary/generate"), title: z.string().max(10000).optional(), articleText: sourceText, kind: z.enum(["paper", "article"]).optional(), sourceScope: z.enum(["loaded-page", "abstract-only"]).optional()}),
  z.object({type: z.literal("cache/get"), hash: z.string().min(1).max(256)}),
  z.object({type: z.literal("cache/put"), entry: z.object({hash: z.string().min(1).max(256), paragraphs: z.array(paragraph).max(10000), timestamp: z.number().finite(), size: z.number().finite().nonnegative()})}),
  z.object({type: z.literal("cache/clear")}),
  z.object({type: z.literal("tabs/toggle-translate")}),
  z.object({type: z.literal("tabs/summarize-paper")}),
  z.object({type: z.literal("toggle-translate")}),
]);

export function readingSettings(settings: ExtensionSettings): ExtensionSettings {
  const providerSettings = {...settings.providerSettings};
  for (const key of Object.keys(providerSettings) as Array<keyof typeof providerSettings>) {
    providerSettings[key] = {model: providerSettings[key].model};
  }
  const {geminiApiKey, vertexApiKey, ...summary} = settings.summary;
  return {...settings, providerSettings, summary};
}

export function runtimeRequestError(message: unknown, sender: {id?: string; tab?: unknown}, extensionId: string): string | null {
  if (sender.id && sender.id !== extensionId) return "Unauthorized extension sender.";
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success) return "Invalid PaperLens request.";
  if (sender.tab && ["settings/update", "cache/clear", "tabs/toggle-translate", "tabs/summarize-paper"].includes(parsed.data.type)) {
    return "This action requires a PaperLens extension page.";
  }
  return null;
}
