import { collectReadabilitySourceElements } from "./readability-adapter";

interface JournalProfile {
  hostPattern: RegExp;
  selectors: string[];
  skipSelectors: string[];
  skipPredicate?: (el: Element) => boolean;
  captionSelectors?: string[];
}

const ARXIV_PERMISSION_NOTICE_RE =
  /\b(?:provided proper attribution|grants? permission|permission (?:is )?granted)\b[\s\S]{0,240}\b(?:reproduce|reuse|distribute)\b/i;

function isArxivPermissionNotice(el: Element): boolean {
  if (matchesOrClosest(el, ".ltx_permission")) return true;

  const text = el.textContent?.trim() ?? "";
  if (!ARXIV_PERMISSION_NOTICE_RE.test(text)) return false;
  if (matchesOrClosest(el, ".ltx_section, .ltx_abstract")) return false;

  return el.matches("p.ltx_align_center") && el.closest(".ltx_para") !== null;
}

const JOURNAL_PROFILES: JournalProfile[] = [
  {
    hostPattern: /nature\.com/,
    selectors: [
      "article .c-article-body.main-content > p",
      "article.c-article-body section p",
      "article .article-body section p",
      "div.c-article-section__content p",
    ],
    skipSelectors: [
      "#references p",
      ".c-article-references p",
      ".c-article-references__container p",
      "[id^='Bib'][id$='-section'] p",
      "section[data-title='References'] p",
      "section[data-title='Bibliography'] p",
      "section[data-title='Author information'] p",
      "section[data-title='Ethics declarations'] p",
      ".c-article-table tbody p",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: ["figcaption p", ".c-article-table caption"],
  },
  {
    hostPattern: /wiley\.com|onlinelibrary\.wiley\.com/,
    selectors: [
      "#article__body p",
      ".article-section__content p",
      "div.paragraph-element > p",
      "div.paragraph-element",
    ],
    skipSelectors: [".article-section--references p", ".article-section--references div.paragraph-element", "nav p", "header p", "footer p"],
    captionSelectors: ["figcaption p"],
  },
  {
    hostPattern: /sciencedirect\.com/,
    selectors: [
      "#abstracts .abstract div[id^='spara']",
      ".Abstracts .abstract div[id^='spara']",
      ".abstract div[id^='spara']",
      "#body div.u-margin-s-bottom[id^='p']",
      ".Body div.u-margin-s-bottom[id^='p']",
      "#body div.u-margin-s-bottom > div[id^='p']",
      ".Body div.u-margin-s-bottom > div[id^='p']",
      "#body section[id^='sec'] div[id^='p']",
      ".Body section[id^='sec'] div[id^='p']",
      "#abstracts div[id^='abspara']",
      ".Abstracts div[id^='abspara']",
      ".abstract div[id^='abspara']",
      "section[id^='abst'] div[id^='abspara']",
      ".section-paragraph",
      "#body section[id^='sec'] > p",
      ".Body section[id^='sec'] > p",
    ],
    skipSelectors: [
      ".reference-links p",
      ".reference-links",
      ".author-group p",
      ".AuthorGroups",
      ".RelatedArticles",
      ".recommended-articles",
      ".sticky-table-of-contents",
      "#reading-assistant-container",
      "#issue-navigation",
      ".figure p",
      ".figure div[id^='p']",
      ".tables p",
      ".tables div[id^='p']",
      ".captions p",
      ".captions div[id^='p']",
      "#coi0001 div[id^='p']",
      "#ack0001 div[id^='p']",
      "#refdata001 div[id^='p']",
      ".Appendices div[id^='p']",
      "#bibliography p",
      "#bibliography div[id^='p']",
      "#references p",
      "#references div[id^='p']",
      "section[id^='bib'] p",
      "section[id^='bib'] div[id^='p']",
      ".bibliography p",
      ".bibliography div[id^='p']",
      "nav p", "header p", "footer p",
    ],
  },
  {
    hostPattern: /researchgate\.net/,
    selectors: [
      "main article p",
      "article p",
      "[data-testid*='publication'] p",
      "[class*='publication'] p",
      ".nova-legacy-e-text p",
    ],
    skipSelectors: [
      "[class*='reference'] p",
      "[class*='citation'] p",
      "[class*='recommend'] p",
      "[class*='comment'] p",
      "[class*='profile'] p",
      "[class*='metric'] p",
      "[class*='share'] p",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: [
      "p[id^='spara']",
      "figcaption p",
      "[class*='figure'] p",
      "[class*='caption'] p",
    ],
  },
  {
    hostPattern: /pubs\.aip\.org|aip\.scitation\.org/,
    selectors: [
      ".widget-ArticleFulltext .article-section-wrapper > .abstract p",
      ".widget-ArticleFulltext .article-section-wrapper > .abstractInFull p",
      ".widget-ArticleFulltext .article-section-wrapper > p",
      ".widget-ArticleFulltext .abstract p",
      ".hlFld-Abstract .abstractSection p",
      ".article__abstract .abstractSection p",
      ".abstractSection p",
      ".hlFld-Fulltext .NLM_p",
      ".article__body .NLM_p",
      ".article-body .NLM_p",
      ".NLM_sec .NLM_p",
      ".hlFld-Fulltext p",
      ".article__body p",
    ],
    skipSelectors: [
      ".paywall .NLM_p",
      ".paywall p",
      "figshare-widget .NLM_p",
      "figshare-widget p",
      "[class*='figshare'] .NLM_p",
      "[class*='figshare'] p",
      ".fig-modal .NLM_p",
      ".fig-modal p",
      ".article-references .NLM_p",
      ".article-references p",
      ".references .NLM_p",
      ".references p",
      ".NLM_ref-list .NLM_p",
      ".NLM_ref-list p",
      "[class*='reference'] .NLM_p",
      "[class*='reference'] p",
      "[class*='citation'] .NLM_p",
      "[class*='citation'] p",
      ".author-info .NLM_p",
      ".author-info p",
      ".related-content .NLM_p",
      ".related-content p",
      ".article-metrics .NLM_p",
      ".article-metrics p",
      "nav .NLM_p", "header .NLM_p", "footer .NLM_p",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: [
      ".widget-ArticleFulltext .fig-section .fig-caption p",
      ".widget-ArticleFulltext .fig-section .caption p",
      ".widget-ArticleFulltext figure figcaption p",
      ".hlFld-Fulltext .NLM_caption .NLM_p",
      ".hlFld-Fulltext .NLM_caption p",
      ".article__body .NLM_caption .NLM_p",
      ".article__body .NLM_caption p",
    ],
  },
  {
    hostPattern: /pubs\.rsc\.org/,
    selectors: [
      "div.abstract p",
      "p.otherpara",
    ],
    skipSelectors: [
      "p.header_text",
      "p.bold.italic",
      "table td p",
      ".references p",
      ".article-reference p",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: [
      "figcaption p",
      ".image_table p",
      ".graphic_title p",
    ],
  },
  {
    hostPattern: /journals\.plos\.org/,
    selectors: [
      "#artText .abstract-content p",
      "#artText .section p",
    ],
    skipSelectors: [
      "#artText .articleinfo p",
      "#artText .references p",
      "#references p",
      "[id^='author-meta'] p",
      "#author-list p",
      ".author-info p",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: [
      "#artText figcaption p",
      "#artText .figure p",
    ],
  },
  {
    hostPattern: /ncbi\.nlm\.nih\.gov/,
    selectors: ["#mc_main_content p", ".tsec p", "#__article_content p"],
    skipSelectors: [
      ".ref-list p", ".contrib-group p", ".table-wrap tbody p",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: [".fig .caption p", ".table-wrap .caption p"],
  },
  {
    hostPattern: /arxiv\.org/,
    selectors: [
      ".ltx_abstract p",
      ".ltx_section .ltx_para p",
      ".ltx_section p",
    ],
    skipSelectors: [
      ".ltx_bibliography p",
      "dialog p",
      ".ltx_authors p",
      "nav p", "header p", "footer p",
    ],
    skipPredicate: isArxivPermissionNotice,
    captionSelectors: [".ltx_caption p"],
  },
  {
    hostPattern: /acs\.org/,
    selectors: [".article_content p", ".NLM_p > [role='paragraph']", ".NLM_p"],
    skipSelectors: [".article_references p", "nav p", "header p", "footer p"],
    captionSelectors: [".figure__caption p"],
  },
  {
    hostPattern: /springer\.com/,
    selectors: [".c-article-body p", "article .Para"],
    skipSelectors: ["section[data-title='References'] p", "nav p", "header p", "footer p"],
    captionSelectors: ["figcaption p"],
  },
  {
    hostPattern: /ieee\.org/,
    selectors: [
      // IEEE Xplore abstract and full-text viewers. Keep these specific;
      // broad content selectors pick up recommendations and footer text.
      "xpl-document-abstract div.abstract-text-content",
      ".document-abstract div.abstract-text-content",
      ".abstract-text div.abstract-text-content",
      ".section p",
      "div.section p",
      "#article-body p",
      ".article-content p",
      ".document-main-content-container p",
    ],
    skipSelectors: [
      ".reference-container p",
      ".references p",
      "[class*='reference'] p",
      ".author-info p",
      ".document-main-right-trail-content p",
      ".document-sidebar p",
      ".stats-document-abstract-doi p",
      ".stats-document-abstract-publishedIn p",
      ".header-rel-art p",
      ".header-rel-art-pub",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: [".figcaption p", "figcaption p"],
  },
  {
    hostPattern: /science\.org/,
    selectors: [
      "#bodymatter [role='paragraph']",
      "section[property='articleBody'] [role='paragraph']",
      "#bodymatter p",
      "section[property='articleBody'] p",
    ],
    skipSelectors: [
      "#backmatter [role='paragraph']",
      "#core-collateral-info [role='paragraph']",
      "#core-collateral-metrics [role='paragraph']",
      "#core-collateral-fulltext-options [role='paragraph']",
      ".alert-signup__dropzone [role='paragraph']",
      ".references [role='paragraph']",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: [
      "#bodymatter figcaption p",
      "#bodymatter figcaption [role='paragraph']",
    ],
  },
  {
    hostPattern: /gartner\.com/,
    selectors: [
      ".cmp-globalsite-articletext .article-text .rte p",
      ".article-text .rte p",
      "section.Analysis div.para",
      "section.KeyFindings div.para",
    ],
    skipSelectors: [
      ".embedded-form p",
      ".form-heading p",
      ".privacy-policy p",
      ".privacyConsent p",
      ".consent-error-msg p",
      ".promoted-conference p",
      "form p",
      "nav p", "header p", "footer p",
    ],
    captionSelectors: [
      "section.Analysis .caption .heading",
    ],
  },
];

// ---------------------------------------------------------------------------
// Fallback: aggressive paragraph collection for any academic page
// ---------------------------------------------------------------------------

// Skip selectors shared across all profiles
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

const REFERENCE_META_RE =
  /(^|[-_\s])(references?|bibliography|ref-list|reference-list|backmatter|back-matter|literature-cited|works-cited|endnotes?|footnotes?)([-_\s]|$)|article-references|c-article-references|^bib\d/i;

const REFERENCE_HEADING_RE =
  /^(references?|bibliography|literature cited|works cited|reference list|endnotes?|footnotes?)$/i;

const NON_TRANSLATABLE_SECTION_HEADING_RE =
  /^(CRediT authorship contribution statement|author contributions?|declaration of competing interest|competing interests?|conflict of interest statement|acknowledg?ements?|funding|data availability|availability of data and materials|appendix(?:\b.*)?|supplementary materials?|ethics declarations?|author information)$/i;

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
      if (NON_TRANSLATABLE_SECTION_HEADING_RE.test(headingText)) return true;
    }

    current = current.parentElement;
    depth++;
  }
  return false;
}

function matchesOrClosest(el: Element, selector: string): boolean {
  try {
    return el.matches(selector) || el.closest(selector) !== null;
  } catch {
    return false;
  }
}

function isUniversallySkipped(el: Element): boolean {
  if (isReferenceLikeElement(el)) return true;
  if (isNonTranslatableSectionLikeElement(el)) return true;
  for (const sel of UNIVERSAL_SKIP_SELECTORS) {
    if (matchesOrClosest(el, sel)) return true;
  }
  return false;
}

const FALLBACK_PROFILE: JournalProfile = {
  hostPattern: /.*/,
  selectors: ["article p", "main p", ".content p", "[role='main'] p"],
  skipSelectors: ["nav p", "header p", "footer p", ".sidebar p", ".comments p"],
  captionSelectors: ["figcaption p"],
};

function getProfile(): JournalProfile {
  const host = window.location.hostname;
  return JOURNAL_PROFILES.find((p) => p.hostPattern.test(host)) ?? FALLBACK_PROFILE;
}

function isSkipped(el: Element, profile: JournalProfile): boolean {
  if (isUniversallySkipped(el)) return true;
  if (profile.skipPredicate?.(el)) return true;
  return profile.skipSelectors.some((sel) => {
    if (matchesOrClosest(el, sel)) return true;
    if (sel.endsWith(" p")) {
      return matchesOrClosest(el, sel.slice(0, -2));
    }
    return false;
  });
}

const PROFILE_PARAGRAPH_TERMINAL_RE =
  /(?:\s+|>\s*)(?:p|\[role\s*=\s*(?:"paragraph"|'paragraph'|paragraph)\])\s*$/i;

function isInsideProfileExclusionScope(
  element: Element,
  profile: JournalProfile,
): boolean {
  return profile.skipSelectors.some((selector) => {
    const terminal = PROFILE_PARAGRAPH_TERMINAL_RE.exec(selector);
    if (!terminal) return false;
    const scopeSelector = selector.slice(0, terminal.index).trim();
    return scopeSelector.length > 0 && matchesOrClosest(element, scopeSelector);
  });
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
  )
    score += 20;
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
  if (
    ["navigation", "banner", "contentinfo", "complementary"].includes(role)
  )
    score -= 30;
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

  // Count qualifying paragraphs per ancestor
  for (const p of qualifying) {
    let ancestor: Element | null = p.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth++) {
      pCounts.set(ancestor, (pCounts.get(ancestor) ?? 0) + 1);
      ancestor = ancestor.parentElement;
    }
  }

  // Score each ancestor
  for (const [el, count] of pCounts) {
    const s = scoreElement(el, count);
    scores.set(el, (scores.get(el) ?? 0) + s);
  }

  // Score propagation: for each qualifying paragraph, give half score
  // from parent to grandparent
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

  // Find highest-scoring container
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

interface RankedCandidateRecord {
  record: CandidateRecord;
  children: RankedCandidateRecord[];
  maxSubtreeStrength: number;
  excludedByDescendant: boolean;
  excluded: boolean;
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

function sortInDocumentOrder(elements: HTMLElement[]): HTMLElement[] {
  const order = new Map<Element, number>();
  document.querySelectorAll("*").forEach((element, index) => {
    order.set(element, index);
  });

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

function resolveNestedCandidates(records: CandidateRecord[]): HTMLElement[] {
  if (records.length === 0) return [];

  const recordsByElement = new Map(
    records.map((record) => [record.element, record] as const),
  );
  const orderedElements = sortInDocumentOrder(
    records.map((record) => record.element),
  );
  const nodes = orderedElements.map<RankedCandidateRecord>((element) => {
    const record = recordsByElement.get(element)!;
    return {
      record,
      children: [],
      maxSubtreeStrength: record.strength,
      excludedByDescendant: false,
      excluded: false,
    };
  });

  const roots: RankedCandidateRecord[] = [];
  const ancestorStack: RankedCandidateRecord[] = [];
  for (const node of nodes) {
    while (
      ancestorStack.length > 0 &&
      !ancestorStack[ancestorStack.length - 1].record.element.contains(
        node.record.element,
      )
    ) {
      ancestorStack.pop();
    }

    const parent = ancestorStack[ancestorStack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    ancestorStack.push(node);
  }

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    let maxDescendantStrength = Number.NEGATIVE_INFINITY;
    for (const child of node.children) {
      maxDescendantStrength = Math.max(
        maxDescendantStrength,
        child.maxSubtreeStrength,
      );
    }
    node.excludedByDescendant = maxDescendantStrength >= node.record.strength;
    node.maxSubtreeStrength = Math.max(
      node.record.strength,
      maxDescendantStrength,
    );
  }

  const traversal = roots
    .map((node) => ({ node, survivingAncestorStrength: null as number | null }))
    .reverse();
  while (traversal.length > 0) {
    const { node, survivingAncestorStrength } = traversal.pop()!;
    const excludedByAncestor = !node.excludedByDescendant &&
      survivingAncestorStrength !== null &&
      survivingAncestorStrength > node.record.strength;
    node.excluded = node.excludedByDescendant || excludedByAncestor;
    const nextAncestorStrength = node.excluded
      ? survivingAncestorStrength
      : node.record.strength;

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      traversal.push({
        node: node.children[index],
        survivingAncestorStrength: nextAncestorStrength,
      });
    }
  }

  return nodes
    .filter((node) => !node.excluded)
    .map((node) => node.record.element);
}

function finalizeCandidateEvidence(
  evidence: Iterable<CandidateEvidence>,
  profile: JournalProfile,
  options: CollectOptions,
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
    (record.sources.has("readability") || record.sources.has("legacy")),
  );
  const fallbackActive = !hasUsableReaderEvidence;
  const activeRecords = markerVisibleRecords.filter((record) =>
    Array.from(record.sources).some((source) =>
      source !== "fallback" || fallbackActive,
    ),
  );
  return resolveNestedCandidates(activeRecords);
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

  return finalizeCandidateEvidence(evidence, profile, options);
}

export interface Section {
  heading: string | null;
  paragraphs: HTMLElement[];
}

interface HeadingEvidence {
  element: HTMLElement;
  text: string;
  sectionScope: Element | null;
  order: number;
}

function collectDocumentOrder(): ReadonlyMap<Element, number> {
  const documentOrder = new Map<Element, number>();
  document.querySelectorAll("*").forEach((element, index) => {
    documentOrder.set(element, index);
  });
  return documentOrder;
}

function collectHeadingEvidence(
  profile: JournalProfile,
  documentOrder: ReadonlyMap<Element, number>,
): HeadingEvidence[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    "h1,h2,h3,h4,h5,h6,[role='heading']",
  )).flatMap((element) => {
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

function applicableHeading(
  paragraph: HTMLElement,
  headings: readonly HeadingEvidence[],
  documentOrder: ReadonlyMap<Element, number>,
): HeadingEvidence | null {
  const paragraphOrder = documentOrder.get(paragraph);
  if (paragraphOrder === undefined) return null;

  for (let index = headings.length - 1; index >= 0; index--) {
    const heading = headings[index];
    if (heading.order >= paragraphOrder) continue;
    if (!heading.sectionScope || heading.sectionScope.contains(paragraph)) {
      return heading;
    }
  }

  return null;
}

function groupByHeadingOccurrence(
  paragraphs: readonly HTMLElement[],
  headings: readonly HeadingEvidence[],
  documentOrder: ReadonlyMap<Element, number>,
): Section[] {
  const sections: Section[] = [];
  let previousHeading: HTMLElement | null | undefined;

  for (const paragraph of paragraphs) {
    const heading = applicableHeading(paragraph, headings, documentOrder);
    const headingElement = heading?.element ?? null;
    if (headingElement !== previousHeading) {
      sections.push({ heading: heading?.text ?? null, paragraphs: [] });
      previousHeading = headingElement;
    }
    sections[sections.length - 1].paragraphs.push(paragraph);
  }

  return sections;
}

export function collectSections(options: CollectOptions = {}): Section[] {
  const paragraphs = collectParagraphs(options);
  if (paragraphs.length === 0) return [];
  const documentOrder = collectDocumentOrder();
  const headings = collectHeadingEvidence(getProfile(), documentOrder);
  return groupByHeadingOccurrence(paragraphs, headings, documentOrder);
}
