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

function decodePartialJsonString(rawInner: string): string | null {
  // Drop any incomplete trailing escape sequence (\ or \uXXX) while mid-stream.
  let safe = rawInner.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
  let trailingSlashes = 0;
  for (let i = safe.length - 1; i >= 0 && safe[i] === "\\"; i -= 1) {
    trailingSlashes += 1;
  }
  if (trailingSlashes % 2 === 1) {
    safe = safe.slice(0, -1);
  }
  const literal = `"${safe}"`;
  try {
    return JSON.parse(repairInvalidJsonEscapes(literal)) as string;
  } catch {
    try {
      return JSON.parse(literal) as string;
    } catch {
      return null;
    }
  }
}

/**
 * Incrementally extracts paragraph "translation" fields from a partial JSON stream
 * of shape {"paragraphs":[{"translation":"...","alignment":[...]}, ...]}.
 * Returns strings indexed by paragraph position (including live in-progress text).
 */
export function extractStreamingParagraphTranslations(raw: string): Array<string | undefined> {
  const cleaned = raw.trimStart().replace(/^```(?:json)?\s*/i, "");
  const results: Array<string | undefined> = [];

  let i = 0;
  const len = cleaned.length;
  const skipWs = () => {
    while (i < len && /\s/.test(cleaned[i])) i += 1;
  };
  const readString = (): { value: string; complete: boolean } | null => {
    if (cleaned[i] !== "\"") return null;
    const start = i + 1;
    i += 1;
    while (i < len) {
      const ch = cleaned[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "\"") {
        const inner = cleaned.slice(start, i);
        i += 1;
        const decoded = decodePartialJsonString(inner);
        return decoded !== null ? { value: decoded, complete: true } : null;
      }
      i += 1;
    }
    const inner = cleaned.slice(start);
    const decoded = decodePartialJsonString(inner);
    return decoded !== null ? { value: decoded, complete: false } : null;
  };

  // Locate the opening '[' of the top-level "paragraphs" array.
  let foundArray = false;
  let rootDepth = 0;
  while (i < len) {
    const ch = cleaned[i];
    if (ch === "\"") {
      const str = readString();
      if (!str?.complete) return results;
      if (rootDepth === 1 && str.value === "paragraphs") {
        skipWs();
        if (cleaned[i] === ":") {
          i += 1;
          skipWs();
          if (cleaned[i] === "[") {
            i += 1;
            foundArray = true;
            break;
          }
        }
      }
      continue;
    }
    if (ch === "{") rootDepth += 1;
    else if (ch === "}") rootDepth = Math.max(0, rootDepth - 1);
    i += 1;
  }

  if (!foundArray) return results;

  // Walk inside the "paragraphs" array, tracking object depth relative to each item.
  let itemIndex = -1;
  let objDepth = 0;
  let arrDepth = 0;

  while (i < len) {
    const ch = cleaned[i];
    if (ch === "\"") {
      const str = readString();
      if (!str?.complete) return results;
      if (objDepth === 1 && arrDepth === 0 && str.value === "translation" && itemIndex >= 0) {
        skipWs();
        if (cleaned[i] === ":") {
          i += 1;
          skipWs();
          if (cleaned[i] === "\"") {
            const val = readString();
            if (val && val.value.length > 0) {
              results[itemIndex] = val.value;
            }
            if (!val?.complete) return results;
          }
        }
      }
      continue;
    }

    if (ch === "{") {
      if (objDepth === 0 && arrDepth === 0) itemIndex += 1;
      objDepth += 1;
    } else if (ch === "}") {
      objDepth = Math.max(0, objDepth - 1);
    } else if (ch === "[") {
      arrDepth += 1;
    } else if (ch === "]") {
      if (objDepth === 0 && arrDepth === 0) break;
      arrDepth = Math.max(0, arrDepth - 1);
    }
    i += 1;
  }

  return results;
}
