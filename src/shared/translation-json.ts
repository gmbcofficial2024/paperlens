import type { ParagraphResult, SentenceAlignment } from "./types";

function stripCodeFence(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned.startsWith("```")) return cleaned;
  return cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
}

function isHexDigit(char: string | undefined): boolean {
  return char != null && /^[0-9a-fA-F]$/.test(char);
}

function isAsciiLetter(char: string | undefined): boolean {
  return char != null && /^[A-Za-z]$/.test(char);
}

function hasValidUnicodeEscape(text: string, slashIndex: number): boolean {
  return (
    text[slashIndex + 1] === "u" &&
    isHexDigit(text[slashIndex + 2]) &&
    isHexDigit(text[slashIndex + 3]) &&
    isHexDigit(text[slashIndex + 4]) &&
    isHexDigit(text[slashIndex + 5])
  );
}

function repairInvalidJsonEscapes(text: string): string {
  let repaired = "";
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (!inString) {
      repaired += char;
      if (char === "\"") inString = true;
      continue;
    }

    if (char === "\"") {
      repaired += char;
      inString = false;
      continue;
    }

    if (char !== "\\") {
      repaired += char;
      continue;
    }

    const next = text[i + 1];
    if (next == null) {
      repaired += "\\\\";
      continue;
    }

    if ("bfnrt".includes(next) && isAsciiLetter(text[i + 2])) {
      repaired += "\\\\";
      continue;
    }

    if ("\"\\/bfnrt".includes(next)) {
      repaired += char + next;
      i++;
      continue;
    }

    if (hasValidUnicodeEscape(text, i)) {
      repaired += text.slice(i, i + 6);
      i += 5;
      continue;
    }

    repaired += "\\\\";
  }

  return repaired;
}

function parseModelJson(raw: string): any {
  const cleaned = stripCodeFence(raw);
  const repaired = repairInvalidJsonEscapes(cleaned);
  try {
    return JSON.parse(repaired);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return JSON.parse(cleaned);
  }
}

export function parseTranslationJson(raw: string): { translation: string; alignment: SentenceAlignment[] } {
  const parsed = parseModelJson(raw);
  if (parsed.paragraphs && Array.isArray(parsed.paragraphs) && parsed.paragraphs.length === 1) {
    return {
      translation: parsed.paragraphs[0].translation ?? "",
      alignment: Array.isArray(parsed.paragraphs[0].alignment) ? parsed.paragraphs[0].alignment : [],
    };
  }
  return {
    translation: parsed.translation ?? "",
    alignment: Array.isArray(parsed.alignment) ? parsed.alignment : [],
  };
}

export function parseSectionTranslationJson(raw: string): ParagraphResult[] {
  const parsed = parseModelJson(raw);
  if (parsed.paragraphs && Array.isArray(parsed.paragraphs)) {
    return parsed.paragraphs.map((p: any) => ({
      translation: p.translation ?? "",
      alignment: Array.isArray(p.alignment) ? p.alignment : [],
    }));
  }
  return [{
    translation: parsed.translation ?? "",
    alignment: Array.isArray(parsed.alignment) ? parsed.alignment : [],
  }];
}
