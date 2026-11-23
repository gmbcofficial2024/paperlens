import {
  CAPTION_SELECTOR,
  computeElementLinkDensity,
  isCodeBlockElement,
  isFigureChromeElement,
  isStandaloneMathElement,
  type Section,
} from "./content-policy";
import {
  collectReadingDocument,
  type ReadingDocument,
  type ReadingDocumentOptions,
} from "./reading-document";
import { extractParagraphText, isSourceHidden } from "./text-extraction";

const INLINE_ONLY_TAGS = new Set([
  "SPAN", "A", "EM", "STRONG", "B", "I", "SMALL", "TIME", "SUP", "SUB",
  "ABBR", "CODE", "SAMP", "KBD", "VAR", "MARK", "Q", "CITE", "LABEL",
  "FONT", "U", "S", "DEL", "INS",
]);

const INLINE_DISPLAY_VALUES = new Set([
  "inline", "inline-block", "inline-flex", "inline-grid", "table-cell", "contents",
]);

const BARE_REFERENCE_LABEL_RE =
  /^(?:(?:extended\s+data|supplementary|supporting)\s+)?(?:fig(?:ure)?s?|tables?|eq(?:uation)?s?|schemes?|charts?|panels?|boxes?|sections?|sec\.?|appendix|algorithm|listing|movie|video|audio|dataset|data)\s*\.?\s*[a-zA-Z0-9.\-()]+$/i;

const STANDALONE_DATE_RE =
  /^(?:(?:published|received|revised|accepted|available\s+online|first\s+published|published\s+online|issue\s+date|updated|posted|submitted)(?:\s+on)?\s*:?\s*)?(?:(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|(?:\d{1,2}(?:st|nd|rd|th)?\s+)(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\.?$/i;

const PUBLICATION_HISTORY_LINE_RE =
  /^(?:received|revised|accepted|published|available\s+online|first\s+published|published\s+online|date\s+of\s+publication)\s*:?\s*[\d\w\s,./-]{4,55}$/i;

const ARTICLE_BADGE_OR_CONTROL_RE =
  /^(?:open\s+access|research\s+article|original\s+(?:paper|article|research)|review(?:\s+article)?|brief\s+communication|perspective|commentary|editorial|letter|correspondence|erratum|corrigendum|retraction|news(?:\s+&\s+views)?|feature|article|short\s+communication|technical\s+note|case\s+report|protocol|preprint|peer[\s-]reviewed|full\s+size\s+(?:image|table|figure)|download(?:\s+(?:pdf|xml|epub|citation|image|figure|table|data|ris|bibtex|ppt|powerpoint|article|full\s+text|supplement\w*))?|view(?:\s+(?:pdf|full\s+text|high[\s-]res(?:olution)?|larger|image|figure|table|author\s+publications|more|all|article))?|open\s+in\s+(?:new\s+(?:tab|window)|viewer|figure\s+viewer)|powerpoint\s+slide|source\s+data|cite\s+this\s+article|export\s+citation|share(?:\s+this\s+article)?|get\s+shareable\s+link|(?:reprints|rights)\s+and\s+permissions|check\s+for\s+updates|crossmark|back\s+to\s+top|skip\s+to\s+(?:main\s+)?content|show\s+(?:more|less)|hide|expand|collapse|copy(?:\s+link)?|print|email|save|bookmark|metrics|citations|accesses|altmetric|views|downloads|search\s+author\s+on[\s\S]*)$/i;

const METRIC_COUNTER_RE =
  /^\d[\d,.]*[kKmM]?\s+(?:accesses?|citations?|views?|downloads?|shares?|altmetric(?:\s+score)?|mentions?)$/i;

const VOLUME_PAGES_RE =
  /^(?:volume|vol\.?)\s*\d+(?:\s*,?\s*(?:issue|no\.?)\s*\d+)?(?:\s*,?\s*(?:pages?|pp?\.?)\s*[\d\s\-–—]+)?(?:\s*,?\s*\(?\d{4}\)?)?\.?$/i;

const IDENTIFIER_LINE_RE =
  /^(?:issn|eissn|isbn|doi|pmid|pmcid|arxiv)\s*:?\s*[\w./:\-[\]\s]+$/i;

const COPYRIGHT_OR_LICENSE_RE =
  /^(?:(?:©|\(c\)|copyright\b)[\s\S]{0,240}|all\s+rights\s+reserved\.?|(?:open\s+access\s+)?this\s+(?:is\s+an\s+open[\s-]access\s+)?article\s+(?:is\s+)?(?:licensed|distributed)\s+under\s+(?:a\s+|the\s+terms\s+of\s+the\s+)?creative\s+commons\b[\s\S]*|(?:springer\s+nature|elsevier|wiley|taylor\s*&\s*francis|american\s+chemical\s+society|ieee)\s+remains\s+neutral\s+with\s+regard\s+to\s+jurisdictional\s+claims[\s\S]*)$/i;

const URL_OR_DOI_RE = /\b(?:https?:\/\/\S+|www\.\S+|doi:\s*\S+|10\.\d{4,9}\/\S+)\b/gi;
const SCIENTIFIC_UNIT_OR_STAT_RE =
  /\b(?:nm|µm|μm|mm|cm|km|mg|kg|ml|mL|µL|μL|nA|µA|μA|mA|mV|kV|Hz|kHz|MHz|GHz|THz|ns|µs|μs|ms|min|hr|hrs|eV|meV|keV|MeV|GeV|Pa|kPa|MPa|GPa|Oe|mT|mol|mM|µM|μM|nM|mW|µW|μW|kJ|kcal|ppm|ppb|wt|at|vol|rpm|fps|dB|bps|kbps|Mbps|Gbps|KB|MB|GB|TB|SD|SE|SEM|CI|df|R2|vs|et|al)\b/g;

function getSafeComputedStyle(element: Element): CSSStyleDeclaration | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return null;
  }
  try {
    return window.getComputedStyle(element);
  } catch {
    return null;
  }
}

export function isMultiTrackGrid(style: CSSStyleDeclaration): boolean {
  if (style.display !== "grid" && style.display !== "inline-grid") return false;
  if (style.gridAutoFlow?.includes("column")) return true;
  const cols = style.gridTemplateColumns?.trim();
  if (!cols || cols === "none") return false;
  return cols.split(/\s+/).filter(Boolean).length > 1;
}

export function isHorizontalFlex(style: CSSStyleDeclaration): boolean {
  if (style.display !== "flex" && style.display !== "inline-flex") return false;
  const direction = style.flexDirection?.trim() || "row";
  return direction === "row" || direction === "row-reverse";
}

function isHorizontalOrNavListItem(element: HTMLElement): boolean {
  if (element.tagName !== "LI" && element.tagName !== "DD") return false;
  const parent = element.parentElement;
  if (!parent) return false;

  const parentStyle = getSafeComputedStyle(parent);
  if (parentStyle) {
    if (
      isHorizontalFlex(parentStyle) ||
      isMultiTrackGrid(parentStyle) ||
      INLINE_DISPLAY_VALUES.has(parentStyle.display)
    ) {
      return true;
    }
  }

  // A list where every item is a short link (e.g., TOC, section tabs, subject tags,
  // breadcrumbs, or download links) is UI navigation rather than body prose.
  if (parent.tagName === "UL" || parent.tagName === "OL") {
    const items = Array.from(parent.children).filter((child) => child.tagName === "LI");
    if (items.length >= 2) {
      const allShortLinks = items.every((item) => {
        const text = (item.textContent ?? "").replace(/\s+/g, " ").trim();
        return text.length > 0 && text.length < 140 && computeElementLinkDensity(item) >= 0.85;
      });
      if (allShortLinks) return true;
    }
  }

  return false;
}

function isAlreadyKorean(text: string): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false;
  const hangul = text.match(/[\uAC00-\uD7A3]/g)?.length ?? 0;
  if (hangul < 4) return false;
  const nonHangulLetters = letters.length - hangul;
  return hangul / letters.length >= 0.7 && nonHangulLetters < 15;
}

function hasTranslatableLinguisticContent(text: string): boolean {
  const stripped = text
    .replace(URL_OR_DOI_RE, " ")
    .replace(SCIENTIFIC_UNIT_OR_STAT_RE, " ");
  const words = stripped.match(/[\p{L}]{2,}/gu) ?? [];
  const totalLetters = words.reduce((sum, word) => sum + word.length, 0);
  return (words.length >= 2 && totalLetters >= 5) || totalLetters >= 6;
}

export function isTranslatableProseText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 2) return false;
  if (isAlreadyKorean(normalized)) return false;
  if (BARE_REFERENCE_LABEL_RE.test(normalized)) return false;
  if (STANDALONE_DATE_RE.test(normalized)) return false;
  if (normalized.length <= 120 && PUBLICATION_HISTORY_LINE_RE.test(normalized)) return false;
  if (ARTICLE_BADGE_OR_CONTROL_RE.test(normalized)) return false;
  if (METRIC_COUNTER_RE.test(normalized)) return false;
  if (VOLUME_PAGES_RE.test(normalized)) return false;
  if (normalized.length <= 100 && IDENTIFIER_LINE_RE.test(normalized)) return false;
  if (COPYRIGHT_OR_LICENSE_RE.test(normalized)) return false;
  return hasTranslatableLinguisticContent(normalized);
}

export function isTranslatableAnchor(element: HTMLElement): boolean {
  if (!element.isConnected || isSourceHidden(element)) return false;
  if (INLINE_ONLY_TAGS.has(element.tagName)) return false;
  if (isStandaloneMathElement(element) || isCodeBlockElement(element) || isFigureChromeElement(element)) {
    return false;
  }

  const style = getSafeComputedStyle(element);
  if (style && INLINE_DISPLAY_VALUES.has(style.display)) return false;

  if (isHorizontalOrNavListItem(element)) return false;

  const text = extractParagraphText(element);
  if (!isTranslatableProseText(text)) return false;

  // Reject single-item link-only UI controls/chips/badges (not prose sentences).
  const linkDensity = computeElementLinkDensity(element);
  if (linkDensity >= 0.9 && text.length < 160 && !/[.!?]\s+\S/.test(text)) {
    return false;
  }

  // Inside <figure>, only explicit captions or non-chrome prose paragraphs receive inline translations.
  if (
    element.closest("figure") &&
    element.tagName !== "P" &&
    !element.matches(CAPTION_SELECTOR) &&
    !element.closest(CAPTION_SELECTOR)
  ) {
    return false;
  }

  return true;
}

function resolveTableTranslationTarget(table: HTMLElement): HTMLElement | null {
  const caption = Array.from(table.children).find(
    (child): child is HTMLElement => child.tagName === "CAPTION",
  );
  if (!caption) return null;
  return isTranslatableAnchor(caption) ? caption : null;
}

/**
 * Converts a complete ReadingDocument (which includes tables and diagnostic loose
 * fragments for summary fidelity) into prose-worthy, layout-safe Live Anchors
 * suitable for in-place DOM translation.
 */
export function selectTranslatableSections(
  reading: ReadingDocument,
  options: ReadingDocumentOptions = {},
): Section[] {
  const includeTranslated = options.includeTranslatedParagraphs === true;
  const seen = new Set<HTMLElement>();
  const sections: Section[] = [];

  for (const section of reading.sections) {
    const anchors: HTMLElement[] = [];
    for (const element of section.paragraphs) {
      const target = element.tagName === "TABLE"
        ? resolveTableTranslationTarget(element)
        : isTranslatableAnchor(element)
          ? element
          : null;
      if (!target || seen.has(target)) continue;
      if (!includeTranslated && target.closest("[data-paperlens-id]")) continue;
      seen.add(target);
      anchors.push(target);
    }
    if (anchors.length > 0) {
      sections.push({
        heading: section.heading,
        paragraphs: anchors,
      });
    }
  }

  return sections;
}

export function collectTranslatableSections(
  options: ReadingDocumentOptions = {},
): Section[] {
  const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
  return selectTranslatableSections(reading, options);
}
