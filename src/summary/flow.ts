import type { RuntimeRequest } from "../shared/messages";
import type { ApiSummaryProviderId, SummaryProviderId, SummaryResult } from "../shared/types";

type SummaryGenerateRequest = Extract<
  RuntimeRequest,
  { type: "summary/generate" }
>;

export type SummaryRuntimeSender = (
  request: SummaryGenerateRequest,
) => Promise<SummaryRuntimeResponse>;

export type SummaryRuntimeResponse =
  | { ok: true; result: SummaryResult }
  | { ok: false; error: string };

export interface SummaryRequestInput {
  sourceScope?: "loaded-page" | "abstract-only";
  title?: string;
  articleText: string;
  kind?: "paper" | "article";
}

export async function requestSummaryOnce(
  input: SummaryRequestInput,
  send: SummaryRuntimeSender,
): Promise<SummaryRuntimeResponse> {
  if (!input.articleText.trim()) {
    throw new Error("No article text found for summarization.");
  }
  return send({
    type: "summary/generate",
    title: input.title,
    articleText: input.articleText,
    ...(input.kind ? {kind: input.kind} : {}),
    ...(input.sourceScope ? {sourceScope: input.sourceScope} : {}),
  });
}

export interface SummaryProviderAdapters {
  native(
    provider: "codex" | "claude",
    prompt: string,
  ): Promise<SummaryResult>;
  api(
    provider: ApiSummaryProviderId,
    prompt: string,
  ): Promise<SummaryResult>;
}

export function dispatchSummaryProviderOnce(
  provider: SummaryProviderId,
  prompt: string,
  adapters: SummaryProviderAdapters,
): Promise<SummaryResult> {
  switch (provider) {
    case "codex":
    case "claude":
      return adapters.native(provider, prompt);
    case "gemini":
    case "vertex":
    case "openai":
    case "anthropic":
      return adapters.api(provider, prompt);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown summary provider: ${exhaustive}`);
    }
  }
}
