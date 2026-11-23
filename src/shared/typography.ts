export const FONT_FAMILY_PRESETS = [
  "default",
  "pretendard",
  "malgun",
  "noto-sans",
  "nanum-gothic",
  "serif",
  "system",
  "inherit",
  "custom",
] as const;

export type FontFamilyPreset = (typeof FONT_FAMILY_PRESETS)[number];

export const FONT_SCALES = ["sm", "md", "lg"] as const;
export type FontScale = (typeof FONT_SCALES)[number];

export interface FontFamilyOption {
  id: FontFamilyPreset;
  label: string;
}

export const FONT_FAMILY_OPTIONS: readonly FontFamilyOption[] = [
  { id: "default", label: "Default (Noto Sans KR / Malgun Gothic)" },
  { id: "pretendard", label: "Pretendard" },
  { id: "malgun", label: "Malgun Gothic (맑은 고딕)" },
  { id: "noto-sans", label: "Noto Sans KR (본고딕)" },
  { id: "nanum-gothic", label: "NanumGothic (나눔고딕)" },
  { id: "serif", label: "Serif / Myeongjo (명조체)" },
  { id: "system", label: "System UI" },
  { id: "inherit", label: "Match article page font" },
  { id: "custom", label: "Custom installed font..." },
];

export const FONT_SCALE_OPTIONS: ReadonlyArray<{ id: FontScale; label: string }> = [
  { id: "sm", label: "Small (A-)" },
  { id: "md", label: "Default (A)" },
  { id: "lg", label: "Large (A+)" },
];

const FALLBACK_SANS_STACK =
  '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, -apple-system, sans-serif';

const PRESET_CSS_STACKS: Record<Exclude<FontFamilyPreset, "default" | "custom">, string> = {
  pretendard: `"Pretendard", "Pretendard Variable", ${FALLBACK_SANS_STACK}`,
  malgun: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif',
  "noto-sans": '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
  "nanum-gothic": '"NanumGothic", "NanumBarunGothic", "Malgun Gothic", system-ui, sans-serif',
  serif: '"Noto Serif KR", "RIDIBatang", "KoPubWorldBatang", "NanumMyeongjo", "Batang", Georgia, serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  inherit: "inherit",
};

const GENERIC_FONT_KEYWORDS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "cursive",
  "fantasy",
  "inherit",
]);

/**
 * Strips any characters that could break out of a CSS font-family declaration
 * while preserving Latin, Korean, CJK, digits, spaces, hyphens, underscores, and dots.
 */
export function sanitizeCustomFontFamily(raw?: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleanedParts = raw
    .split(",")
    .map((part) =>
      part
        .replace(/['"`\\;{}()<>:@/!?\r\n\t]/g, " ")
        .replace(/[^\p{L}\p{N}\s._-]/gu, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => part.length > 0 && part.length <= 64)
    .slice(0, 5);
  return cleanedParts.length > 0 ? cleanedParts.join(", ") : undefined;
}

export function resolveFontFamilyCss(
  preset?: FontFamilyPreset,
  customFontFamily?: string,
): string | undefined {
  if (!preset || preset === "default") return undefined;
  if (preset === "custom") {
    const sanitized = sanitizeCustomFontFamily(customFontFamily);
    if (!sanitized) return undefined;
    const families = sanitized.split(",").map((name) => {
      const trimmed = name.trim();
      return GENERIC_FONT_KEYWORDS.has(trimmed.toLowerCase())
        ? trimmed.toLowerCase()
        : `"${trimmed}"`;
    });
    return `${families.join(", ")}, ${FALLBACK_SANS_STACK}`;
  }
  return PRESET_CSS_STACKS[preset];
}

export function normalizeFontScale(scale?: string): FontScale | undefined {
  if (scale === "sm" || scale === "lg") return scale;
  return undefined;
}
