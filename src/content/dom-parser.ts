import {
  DOM_PARSER_NON_TRANSLATABLE_HEADING_RE,
  HEADING_SELECTOR,
  REFERENCE_HEADING_RE,
  REFERENCE_META_RE,
  buildDocumentOrder,
  groupAnchorsByHeading,
  resolveRankedHierarchy,
  type HeadingAnchor,
  type RankedHierarchyNode,
  type Section,
} from "./content-policy";
import {
  FALLBACK_PROFILE,
  getProfile,
  isInsideProfileExclusionScope,
  isProfileSkipped,
  matchesOrClosest,
  type JournalProfile,
} from "./journal-profiles";
import { collectReadabilitySourceElements } from "./readability-adapter";

export type { Section };

// Skip selectors shared across all profiles in legacy/fallback paragraph collection.
const UNIVERSAL_SKIP_SELECTORS = [
  "nav", "header", "footer",
  "[role='navigation']", "[role='banner']", "[role='contentinfo']",
  ".sidebar", ".comments", ".cookie", ".modal", ".popup", ".tooltip",
  ".advertisement", ".ad-container",
  // Common reference/citation containers
  "#references", "#refs", "#bibliography", "#backmatter",
  ".references", ".bibliography", ".ref-list", ".backmatter", ".back-matter",
  "[role='doc-bibliography']", "[role='doc-endnotes']",
  "[aria-label='References']", "[aria-label='Bibliography']",
  "[class*='reference']", "[class*='bibliograph']", "[class*='backmatter']", "[class*='back-matter']",
  // Author/affiliation blocks
  ".author-info", ".author-group", ".contrib-group", ".affiliations",
  // Supplementary metadata
  ".metrics", ".keywords", ".copyright", ".license",
  ".paperlens-translation", ".paperlens-translation *",
  ".paperlens-summary", ".paperlens-summary *",
  "[class*='paywall']", "[id*='paywall']",
  ".subscription-gate", ".login-modal",
  ".related-content", ".related-articles", ".recommended-articles",
  ".purchase-access", ".signin", ".sign-in", ".subscription-access", ".access-gate",
  "#purchase-access", "#signin", "#sign-in", "#subscription-access", "#access-gate",
  "[aria-label='Related content']", "[aria-label='Recommended articles']",
];

function elementMetadata(el: Element): string {
  return [
    el.id,
    typeof el.className === "string" ? el.className : "",
    el.getAttribute("role"),
    el.getAttribute("aria-label"),
    el.getAttribute("data-title"),
  ].filter(Boolean).join(" ");
}

function isReferenceLikeElement(el: Element): boolean {
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.body && depth < 8) {
    if (REFERENCE_META_RE.test(elementMetadata(current))) return true;

    if (current.matches("section, div, aside")) {
      const heading = current.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6");
      const headingText = heading?.textContent?.trim() ?? "";
      if (REFERENCE_HEADING_RE.test(headingText)) return true;
    }

    current = current.parentElement;
    depth++;
  }
  return false;
}

function isNonTranslatableSectionLikeElement(el: Element): boolean {
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.body && depth < 8) {
    if (current.matches("section, div, aside")) {
      const heading = current.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6");
      const headingText = heading?.textContent?.trim() ?? "";
      if (DOM_PARSER_NON_TRANSLATABLE_HEADING_RE.test(headingText)) return true;
    }

    current = current.parentElement;
    depth++;
  }
  return false;
}

function isUniversallySkipped(el: Element): boolean {
  if (isReferenceLikeElement(el)) return true;
  if (isNonTranslatableSectionLikeElement(el)) return true;
  for (const sel of UNIVERSAL_SKIP_SELECTORS) {
    if (matchesOrClosest(el, sel)) return true;
  }
  return false;
}

function isSkipped(el: Element, profile: JournalProfile): boolean {
  if (isUniversallySkipped(el)) return true;
  return isProfileSkipped(el, profile);
}

function hasMinimumText(el: Element): boolean {
  const text = el.textContent?.trim() ?? "";
  return text.length > 30;
}

// ---------------------------------------------------------------------------
// Generic reader-mode content detection (Readability-style)
// ---------------------------------------------------------------------------

const POSITIVE_ID_CLASS_RE = /article|content|post|entry|body|text|story/i;
const NEGATIVE_ID_CLASS_RE =
  /sidebar|nav|menu|footer|header|comment|widget|ad|banner|modal|popup|cookie|social|share|related/i;

function computeLinkDensity(el: Element): number {
  const totalText = el.textContent?.length ?? 0;
  if (totalText === 0) return 1;
  const links = el.querySelectorAll("a");
  let linkText = 0;
  for (const a of links) {
    linkText += a.textContent?.length ?? 0;
  }
  return linkText / totalText;
}

function idClassString(el: Element): string {
  return (el.id || "") + " " + (el.className || "");
}

function scoreElement(el: Element, paragraphCount: number): number {
  let score = 0;
  const tag = el.tagName.toLowerCase();
  const idClass = idClassString(el);

  // Positive signals
  if (tag === "article") score += 30;
  if (tag === "main" || el.getAttribute("role") === "main") score += 25;
  if (
    el.getAttribute("itemprop") === "articleBody" ||
    el.getAttribute("itemtype")?.includes("schema.org")
  ) {
    score += 20;
  }
  if (POSITIVE_ID_CLASS_RE.test(idClass)) score += 15;
  if (tag === "section") score += 5;
  if (el.querySelector(":scope > h1, :scope > h2")) score += 5;

  // Paragraph contribution
  score += paragraphCount * 3;

  // Text length bonus (capped at +30)
  const textLen = el.textContent?.length ?? 0;
  score += Math.min(Math.floor(textLen / 100), 30);

  // Negative signals
  if (["nav", "aside", "footer", "header"].includes(tag)) score -= 30;
  const role = el.getAttribute("role") ?? "";
  if (["navigation", "banner", "contentinfo", "complementary"].includes(role)) {
    score -= 30;
  }
  if (NEGATIVE_ID_CLASS_RE.test(idClass)) score -= 25;

  // Link density penalty
  const linkDensity = computeLinkDensity(el);
  if (linkDensity > 0.5) score -= 50;
  else if (linkDensity > 0.3) score -= 20;

  // Body/html penalty
  if (tag === "body" || tag === "html") score -= 15;

  // Low paragraph count penalty
  if (paragraphCount <= 1) score -= 10;

  return score;
}

function detectContentContainer(): Element | null {
  const paragraphs = document.querySelectorAll("p");
  const qualifying: Element[] = [];
  for (const p of paragraphs) {
    if ((p.textContent?.trim().length ?? 0) > 30) {
      qualifying.push(p);
    }
  }

  if (qualifying.length === 0) return null;

  const scores = new Map<Element, number>();
  const pCounts = new Map<Element, number>();

  for (const p of qualifying) {
    let ancestor: Element | null = p.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth++) {
      pCounts.set(ancestor, (pCounts.get(ancestor) ?? 0) + 1);
      ancestor = ancestor.parentElement;
    }
  }

  for (const [el, count] of pCounts) {
    const s = scoreElement(el, count);
    scores.set(el, (scores.get(el) ?? 0) + s);
  }

  for (const p of qualifying) {
    const parent = p.parentElement;
    if (!parent) continue;
    const parentScore = scores.get(parent) ?? 0;
    const grandparent = parent.parentElement;
    if (grandparent && scores.has(grandparent)) {
      scores.set(
        grandparent,
        (scores.get(grandparent) ?? 0) + Math.floor(parentScore / 2),
      );
    }
  }

  let best: Element | null = null;
  let bestScore = 0;
  for (const [el, s] of scores) {
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }

  return bestScore >= 20 ? best : null;
}

interface CollectOptions {
  includeTranslatedParagraphs?: boolean;
}

type CandidateSource =
  | "profile"
  | "readability"
  | "legacy"
  | "fallback"
  | "marked";

type CandidateStrength = 1 | 2 | 3;

interface CandidateEvidence {
  element: HTMLElement;
  source: CandidateSource;
}

interface CandidateRecord {
  element: HTMLElement;
  sources: Set<CandidateSource>;
  strength: CandidateStrength;
  translated: boolean;
}

const SEMANTIC_LIVE_ANCHOR_SELECTOR = [
  "p",
  "[role='paragraph']",
  ".NLM_p",
  ".Para",
  ".paragraph-element",
  ".section-paragraph",
  "figcaption",
].join(",");

const PARAGRAPH_TOKEN_RE = /(^|[\s_-])(p|para|paragraph)([\s_-]|$)/i;

function sortInDocumentOrder(
  elements: HTMLElement[],
  order: ReadonlyMap<Node, number>,
): HTMLElement[] {
  return elements.sort((a, b) => {
    if (a === b) return 0;
    const aIndex = order.get(a);
    const bIndex = order.get(b);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return 0;
  });
}

function collectSelectorCandidates(selectors: string[]): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  for (const selector of selectors) {
    try {
      candidates.push(...document.querySelectorAll<HTMLElement>(selector));
    } catch {
      // Ignore one invalid publisher selector without losing other candidates.
    }
  }
  return candidates;
}

function candidateStrength(
  element: HTMLElement,
  sources: ReadonlySet<CandidateSource>,
): CandidateStrength {
  if (element.matches(SEMANTIC_LIVE_ANCHOR_SELECTOR)) return 3;

  const metadata = `${element.id} ${element.getAttribute("class") ?? ""}`;
  if (PARAGRAPH_TOKEN_RE.test(metadata) || sources.has("profile")) return 2;
  return 1;
}

function coalesceCandidateEvidence(
  evidence: Iterable<CandidateEvidence>,
): CandidateRecord[] {
  const sourcesByElement = new Map<HTMLElement, Set<CandidateSource>>();
  for (const { element, source } of evidence) {
    let sources = sourcesByElement.get(element);
    if (!sources) {
      sources = new Set<CandidateSource>();
      sourcesByElement.set(element, sources);
    }
    sources.add(source);
  }

  return Array.from(sourcesByElement, ([element, sources]) => ({
    element,
    sources,
    strength: candidateStrength(element, sources),
    translated: element.hasAttribute("data-paperlens-id"),
  }));
}

function isEligibleCandidateRecord(
  record: CandidateRecord,
  profile: JournalProfile,
): boolean {
  const { element } = record;
  if (element.ownerDocument !== document || !document.contains(element)) return false;
  if (!hasMinimumText(element)) return false;
  return !isSkipped(element, profile);
}

function resolveNestedCandidates(
  records: CandidateRecord[],
  documentOrder: ReadonlyMap<Node, number>,
): HTMLElement[] {
  if (records.length === 0) return [];

  const recordsByElement = new Map(
    records.map((record) => [record.element, record] as const),
  );
  const orderedElements = sortInDocumentOrder(
    records.map((record) => record.element),
    documentOrder,
  );
  const nodes = orderedElements.map<RankedHierarchyNode<HTMLElement>>((element) => {
    const record = recordsByElement.get(element)!;
    return {
      item: element,
      tier: record.strength,
      children: [],
      maxSubtreeTier: record.strength,
      excludedByDescendant: false,
      excluded: false,
    };
  });

  const roots: RankedHierarchyNode<HTMLElement>[] = [];
  const ancestorStack: RankedHierarchyNode<HTMLElement>[] = [];
  for (const node of nodes) {
    while (
      ancestorStack.length > 0 &&
      !ancestorStack[ancestorStack.length - 1].item.contains(node.item)
    ) {
      ancestorStack.pop();
    }

    const parent = ancestorStack[ancestorStack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    ancestorStack.push(node);
  }

  return resolveRankedHierarchy(nodes, roots);
}

function finalizeCandidateEvidence(
  evidence: Iterable<CandidateEvidence>,
  profile: JournalProfile,
  options: CollectOptions,
  documentOrder: ReadonlyMap<Node, number>,
): HTMLElement[] {
  const eligibleRecords = coalesceCandidateEvidence(evidence)
    .filter((record) => isEligibleCandidateRecord(record, profile));
  const includeTranslated = options.includeTranslatedParagraphs === true;
  const translatedAncestors = new Set<HTMLElement>();
  if (!includeTranslated) {
    const candidateElements = new Set(
      eligibleRecords.map((record) => record.element),
    );
    for (const record of eligibleRecords) {
      if (!record.translated) continue;
      let ancestor = record.element.parentElement;
      while (ancestor) {
        if (candidateElements.has(ancestor)) {
          translatedAncestors.add(ancestor as HTMLElement);
        }
        ancestor = ancestor.parentElement;
      }
    }
  }
  const markerVisibleRecords = eligibleRecords.filter((record) =>
    (includeTranslated || !record.translated) &&
    !translatedAncestors.has(record.element),
  );
  const hasUsableReaderEvidence = markerVisibleRecords.some((record) =>
    record.sources.has("readability") || record.sources.has("legacy"),
  );
  const fallbackActive = !hasUsableReaderEvidence;
  const activeRecords = markerVisibleRecords.filter((record) =>
    Array.from(record.sources).some((source) =>
      source !== "fallback" || fallbackActive,
    ),
  );
  return resolveNestedCandidates(activeRecords, documentOrder);
}

function appendCandidateEvidence(
  evidence: CandidateEvidence[],
  elements: Iterable<HTMLElement>,
  source: CandidateSource,
): void {
  for (const element of elements) evidence.push({ element, source });
}

export function collectParagraphs(options: CollectOptions = {}): HTMLElement[] {
  const profile = getProfile();
  const profileCandidates = profile === FALLBACK_PROFILE
    ? []
    : collectSelectorCandidates([
      ...profile.selectors,
      ...(profile.captionSelectors ?? []),
    ]);
  const readabilityCandidates = collectReadabilitySourceElements(document);
  const container = detectContentContainer();
  const legacyCandidates = container
    ? Array.from(container.querySelectorAll<HTMLElement>("p"))
    : [];
  const fallbackCandidates = Array.from(
    document.querySelectorAll<HTMLElement>("p"),
  );
  const markedCandidates = Array.from(
    document.querySelectorAll<HTMLElement>("[data-paperlens-id]"),
  );
  const evidence: CandidateEvidence[] = [];
  appendCandidateEvidence(evidence, profileCandidates, "profile");
  appendCandidateEvidence(evidence, readabilityCandidates, "readability");
  appendCandidateEvidence(evidence, legacyCandidates, "legacy");
  appendCandidateEvidence(evidence, fallbackCandidates, "fallback");
  appendCandidateEvidence(evidence, markedCandidates, "marked");

  return finalizeCandidateEvidence(evidence, profile, options, buildDocumentOrder());
}

function collectHeadingEvidence(
  profile: JournalProfile,
  documentOrder: ReadonlyMap<Node, number>,
): HeadingAnchor[] {
  return Array.from(document.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).flatMap((element) => {
    const text = element.textContent?.trim() ?? "";
    const order = documentOrder.get(element);
    if (
      !text ||
      order === undefined ||
      element.ownerDocument !== document ||
      !document.contains(element) ||
      matchesOrClosest(element, ".paperlens-translation, .paperlens-summary") ||
      isInsideProfileExclusionScope(element, profile) ||
      isSkipped(element, profile)
    ) {
      return [];
    }

    return [{
      element,
      text,
      sectionScope: element.closest("section"),
      order,
    }];
  });
}

export function collectSections(options: CollectOptions = {}): Section[] {
  const paragraphs = collectParagraphs(options);
  if (paragraphs.length === 0) return [];
  const documentOrder = buildDocumentOrder();
  const headings = collectHeadingEvidence(getProfile(), documentOrder);
  return groupAnchorsByHeading(paragraphs, headings, documentOrder);
}
