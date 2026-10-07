import { PROVIDERS } from "./providers";

export interface VertexApiKeyUrlOptions {
  apiKey?: string;
  model?: string;
  stream: boolean;
}

const VERTEX_MODEL_MIGRATIONS: Record<string, string> = {
  "google/gemini-3.5-flash": "gemini-3.8-flash",
  "google/gemini-3.6-flash": "gemini-3.8-flash",
  "google/gemini-3.7-flash": "gemini-3.8-flash",
  "google/gemini-3.8-flash": "gemini-3.8-flash",
  "google/gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
  "google/gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
  "gemini-3.5-flash": "gemini-3.8-flash",
  "gemini-3.6-flash": "gemini-3.8-flash",
  "gemini-3.7-flash": "gemini-3.8-flash",
  "gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
  "gemini-flash-latest": "gemini-3.8-flash",
  "gemini-pro-latest": "gemini-3.1-pro-preview",
  "gemini-flash-lite-latest": "gemini-3.5-flash-lite",
  "gemini-2.5-flash": "gemini-3.8-flash",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
};

function extractModelId(model: string): string {
  const match = model.match(/\/models\/([^/:?#]+)/i);
  return match ? decodeURIComponent(match[1]) : model;
}

export function normalizeVertexModelForSettings(model?: string): string {
  const trimmed = model?.trim();
  if (!trimmed) return PROVIDERS.vertex.defaultModel;

  const modelId = extractModelId(trimmed);
  const migrated = VERTEX_MODEL_MIGRATIONS[modelId.toLowerCase()] ?? modelId;
  return PROVIDERS.vertex.models.some((known) => known.id === migrated)
    ? migrated
    : PROVIDERS.vertex.defaultModel;
}

export function normalizeVertexModel(model?: string): string {
  return normalizeVertexModelForSettings(model);
}

export function normalizeOptionalVertexModel(model?: string): string | undefined {
  const trimmed = model?.trim();
  return trimmed ? normalizeVertexModelForSettings(trimmed) : undefined;
}

function requireVertexApiKey(apiKey?: string): string {
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    throw new Error("Vertex API key is not configured.");
  }
  return trimmed;
}

export function buildVertexApiKeyUrl(options: VertexApiKeyUrlOptions): string {
  const method = options.stream ? "streamGenerateContent" : "generateContent";
  const model = encodeURIComponent(normalizeVertexModel(options.model));
  const url = new URL(`https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${method}`);
  url.searchParams.set("key", requireVertexApiKey(options.apiKey));
  if (options.stream) {
    url.searchParams.set("alt", "sse");
  }
  return url.toString();
}

export function buildVertexBody(
  systemPrompt: string,
  userPrompt: string,
  responseMimeType?: string,
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: responseMimeType ? { responseMimeType } : {},
  };
}
