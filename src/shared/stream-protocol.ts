import type { ParagraphResult, SentenceAlignment, TokenUsage } from "./types";

export type StreamRequest =
  | { type: "stream/translate"; text: string; paragraphId: string }
  | { type: "stream/translate-section"; paragraphTexts: string[]; paragraphIds: string[]; customPrompt: string; configurationKey?: string };

export type StreamMessage =
  | { type: "stream-chunk"; delta: string }
  | { type: "stream-done"; fullText: string; alignment: SentenceAlignment[]; usage?: TokenUsage }
  | { type: "stream-section-done"; paragraphs: ParagraphResult[]; usage?: TokenUsage }
  | { type: "stream-error"; error: string };
