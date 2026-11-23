import { matchesOrClosest } from "./journal-profiles";

export interface Section {
  heading: string | null;
  paragraphs: HTMLElement[];
}

// Unconditional UI exclusions shared by collection, reconciliation, and serialization.
// Header/footer landmarks need article ownership and are classified separately.
export const SOURCE_UI_SELECTOR = [
  "nav", "form", "button", "dialog", "menu",
  "input", "select", "option", "textarea", "fieldset", "label[for]", "progress", "meter",
  "[role='navigation']", "[role='dialog']", "[role='alertdialog']", "[role='button']",
  "[role='tablist']", "[role='tab']", "[role='menu']", "[role='menubar']", "[role='menuitem']",
  "[role='toolbar']", "[role='search']", "[role='listbox']", "[role='combobox']",
  "[role='tooltip']", "[role='progressbar']", "[role='status']", "[role='alert']",
  "[role='complementary']", "[aria-modal='true']",
  ".site-header", ".site-footer", "#site-header", "#site-footer",
  ".paperlens-translation", ".paperlens-summary", "#paperlens-token-widget", "[data-paperlens-ui]",
  ".sidebar", ".comments", ".cookie", ".modal", ".popup", ".tooltip",
  ".advertisement", ".ad-container", ".related-content", ".related-articles",
  ".recommended-articles", ".RelatedArticles", ".collateral", ".embedded-form",
  ".breadcrumb", ".breadcrumbs", "[aria-label='Breadcrumb']", "[aria-label='breadcrumb']",
  ".pagination", ".pager", ".table-of-contents", ".toc", "#toc", ".sticky-table-of-contents",
  ".article-nav", ".article-navigation", ".section-nav",
  ".share-links", ".social-share", ".article-tools", ".article-actions",
  ".citation-tools", ".download-links", ".pdf-download",
  ".author-info", ".author-group", ".AuthorGroups", ".contrib-group", ".affiliations",
  ".c-article-identifiers", "[data-test='article-identifier']",
  ".c-article-author-list-container", ".c-article-author-list", "[data-test='authors-list']",
  ".c-article-authors-listing", "[data-test='author-info']",
  ".c-article-section__figure-link", "[data-track-component='figure-link']",
  ".c-reading-companion", ".c-pdf-download", ".c-article-share-box", ".c-article-metrics-bar",
  ".c-article-subject-list", ".c-article-info-details", ".c-article-extras",
  ".c-article-recommendations", ".c-article-rights",
  "[data-test='article-metrics']", "[data-test='rights-and-permissions']", "[data-test='citation-section']",
  ".byline", ".article-meta", ".article-metadata", ".publication-meta",
  ".metrics", ".article-metrics", ".keywords", ".keyword-list", ".subject-list",
  ".copyright", ".license", ".permissions", ".reprints",
  ".article-history", ".publication-history", ".article-doi", ".citation-info", ".cite-this",
  ".correspondence", ".author-notes",
  ".fig-modal", "figshare-widget", "[class*='figshare']",
  ".figure-actions", ".figure-links",
  "#reading-assistant-container", "#issue-navigation",
  ".ltx_page_navbar", ".ltx_page_footer", ".ltx_toc", ".ltx_TOC", ".ltx_dates",
].join(",");

export const VISUALLY_HIDDEN_CLASS_SELECTOR = [
  ".sr-only",
  ".visually-hidden",
  ".u-visually-hidden",
  ".screen-reader-text",
  ".acc-hidden",
  ".cdk-visually-hidden",
  ".u-hide",
  ".u-js-hide",
].join(",");

export const GATE_SELECTOR = [
  "[class*='paywall']", "[id*='paywall']", ".subscription-gate", ".login-modal",
  ".purchase-access", ".signin", ".sign-in", ".subscription-access", ".access-gate",
  "#purchase-access", "#signin", "#sign-in", "#subscription-access", "#access-gate",
  "[data-access-state='restricted']",
].join(",");

export const ANCILLARY_SELECTOR = [
  "#references", "#refs", "#bibliography", ".references", ".bibliography", ".ref-list",
  ".article-references", ".c-article-references", ".article-section--references", ".NLM_ref-list",
  "[role='doc-bibliography']", ".ltx_bibliography",
  ".ltx_authors", ".ltx_permission", ".reference-links",
].join(",");

export const CAPTION_SELECTOR = [
  "figcaption", "caption", ".fig-caption", ".figure-caption", ".figure__caption",
  ".figcaption", ".NLM_caption", ".ltx_caption", ".graphic_title", ".caption", ".captions",
  ".c-article-section__figure-description", ".c-article-section__figure-caption",
  ".figure-description", ".fig-desc", ".figure-caption-text",
].join(",");

export const STANDALONE_MATH_SELECTOR = [
  "mjx-container[display='true']",
  ".MathJax_Display",
  ".katex-display",
  ".ltx_equation",
  ".ltx_equationgroup",
  ".ltx_eqn_table",
  ".display-equation",
  ".equation-block",
].join(",");

export const CODE_BLOCK_SELECTOR = "pre, .code-block, .ltx_listing, div.sourceCode";

export const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,[role='heading']";

export const ANCILLARY_HEADING_RE = new RegExp(
  "^(" +
    "references?|bibliography|literature cited|works cited|reference list|" +
    "CRediT authorship contribution statement|author(?:'s|s')? contributions?|" +
    "declaration of competing interests?|competing(?: financial)? interests?|" +
    "conflicts? of interest(?: statement)?|declaration of interests?|disclosures?(?: statement)?|" +
    "acknowledg(?:e)?ments?|" +
    "funding(?: information)?|financial support|grant support|" +
    "data availability|code availability|(?:data and code|code and data) availability|availability of data and materials|" +
    "supplementary (?:materials?|information)|supporting information|electronic supplementary material|" +
    "ethics (?:declarations?|statement)|ethical approval|consent for publication|informed consent|institutional review board statement|" +
    "author (?:information|details|biographies)|biographies|correspondence|corresponding authors?|affiliations|" +
    "(?:rights|reprints) and permissions|copyright|license|" +
    "about this article|article information|publication history|peer review(?: information)?|" +
    "cite this article|how to cite|citation|" +
    "publisher(?:'s)? note|" +
    "keywords|subject terms|subjects|index terms|" +
    "related articles|recommended articles|similar content|cited by|citing articles|article metrics|metrics" +
  ")$",
  "i",
);

export const REFERENCE_META_RE =
  /(^|[-_\s])(references?|bibliography|ref-list|reference-list|backmatter|back-matter|literature-cited|works-cited|endnotes?|footnotes?)([-_\s]|$)|article-references|c-article-references|^bib\d/i;

export const REFERENCE_HEADING_RE =
  /^(references?|bibliography|literature cited|works cited|reference list|endnotes?|footnotes?)$/i;

export const DOM_PARSER_NON_TRANSLATABLE_HEADING_RE = new RegExp(
  `^(?:${ANCILLARY_HEADING_RE.source.slice(1, -1)}|appendix(?:\\b.*)?)$`,
  "i",
);

const ASIDE_CHROME_META_RE =
  /(^|[-_\s])(sidebar|aside|rail|toc|outline|related|recommend|metric|share|social|tool|action|promo|ad|banner|citation|nav|menu|card)([-_\s]|$)/i;

const EQUATION_TAG_ONLY_RE = /^[\s()[\]{}\d.,:;+\-*/=<>~^_|\\a-zA-Z]{0,16}$/;

export function isEquationTable(table: Element): boolean {
  if (table.tagName !== "TABLE") return false;
  if (table.matches(".ltx_equation, .ltx_equationgroup, .ltx_eqn_table, .equation-table")) {
    return true;
  }
  const role = table.getAttribute("role");
  if (role === "presentation" || role === "none") return true;
  if (table.querySelector("thead, caption")) return false;

  const mathNodes = table.querySelectorAll("math, mjx-container, .MathJax, .katex, [role='math']");
  if (mathNodes.length === 0) return false;

  // Check whether every non-math cell is empty or just an equation label like "(1)".
  const cloneTextOutsideMath = (cell: Element): string => {
    const parts: string[] = [];
    const stack: Node[] = [...cell.childNodes].reverse();
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.nodeType === 3) {
        parts.push(node.textContent ?? "");
        continue;
      }
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.matches("math, mjx-container, .MathJax, .katex, [role='math'], script, style")) continue;
      for (let i = el.childNodes.length - 1; i >= 0; i -= 1) stack.push(el.childNodes[i]);
    }
    return parts.join("").replace(/\s+/g, " ").trim();
  };

  const cells = Array.from(table.querySelectorAll("td, th"));
  return cells.length > 0 && cells.every((cell) => EQUATION_TAG_ONLY_RE.test(cloneTextOutsideMath(cell)));
}

export function isNonDataWrapperTable(table: Element): boolean {
  if (table.tagName !== "TABLE") return false;
  if (isEquationTable(table)) return true;
  if (table.matches(".image_table")) return true;
  return false;
}

export function isStandaloneMathElement(element: Element): boolean {
  if (matchesOrClosest(element, STANDALONE_MATH_SELECTOR)) return true;
  if (element.matches("math, mjx-container, .MathJax, .katex, [role='math']")) return true;
  if (element.tagName === "TABLE" && isEquationTable(element)) return true;
  return false;
}

export function isCodeBlockElement(element: Element): boolean {
  return matchesOrClosest(element, CODE_BLOCK_SELECTOR);
}

const FIGURE_CHROME_SELECTOR = [
  ".figure-actions", ".figure-links", ".figure-controls", ".figure-toolbar",
  ".figure-download", ".figure-zoom", ".figure-credit",
  ".c-article-section__figure-link", "[data-track-component='figure-link']",
].join(",");

export function isFigureChromeElement(element: Element): boolean {
  const figure = element.closest("figure");
  if (!figure) return false;
  if (element.matches(CAPTION_SELECTOR) || element.closest(CAPTION_SELECTOR)) return false;
  if (element.tagName === "TABLE" || element.closest("table")) return false;
  if (matchesOrClosest(element, FIGURE_CHROME_SELECTOR)) return true;
  if (element.tagName === "A") return true;

  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return false;
  if (text.length < 140 && computeElementLinkDensity(element) >= 0.85) return true;
  // Short non-paragraph fragments inside <figure> outside captions are panel labels or controls.
  if (element.tagName !== "P" && text.length < 40) return true;
  return false;
}

export function computeElementLinkDensity(element: Element): number {
  const totalText = (element.textContent ?? "").replace(/\s+/g, " ").trim().length;
  if (totalText === 0) return 0;
  let linkText = 0;
  if (element.tagName === "A") return 1;
  for (const anchor of element.querySelectorAll("a")) {
    linkText += (anchor.textContent ?? "").replace(/\s+/g, " ").trim().length;
  }
  return Math.min(1, linkText / totalText);
}

export function isChromeAside(element: Element): boolean {
  const aside = element.closest("aside");
  if (!aside) return false;
  if (aside.getAttribute("role") === "complementary") return true;
  const meta = [
    aside.id,
    typeof aside.className === "string" ? aside.className : "",
    aside.getAttribute("aria-label") ?? "",
  ].join(" ");
  if (ASIDE_CHROME_META_RE.test(meta)) {
    // Preserve explicit figure/supplement fixtures that do not represent UI chrome.
    if (aside.querySelector("figcaption") && !aside.matches(".related-content, .related-articles, .sidebar")) {
      return false;
    }
    return true;
  }
  const textLen = (aside.textContent ?? "").replace(/\s+/g, " ").trim().length;
  return textLen > 0 && computeElementLinkDensity(aside) >= 0.7;
}

export function isVisuallyHiddenStyle(style: CSSStyleDeclaration): boolean {
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
    return true;
  }
  const clip = style.clip?.replace(/\s+/g, "") ?? "";
  if (clip === "rect(0px,0px,0px,0px)" || clip === "rect(0,0,0,0)" || clip === "rect(1px,1px,1px,1px)") {
    return true;
  }
  const clipPath = style.clipPath?.replace(/\s+/g, "") ?? "";
  if (clipPath.startsWith("inset(50%") || clipPath.startsWith("inset(100%")) {
    return true;
  }
  const width = parseFloat(style.width ?? "");
  const height = parseFloat(style.height ?? "");
  if (
    style.position === "absolute" &&
    style.overflow === "hidden" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width <= 1 &&
    height <= 1
  ) {
    return true;
  }
  return false;
}

export function buildDocumentOrder(root: Document = document): ReadonlyMap<Node, number> {
  const order = new Map<Node, number>();
  const stack: Node[] = [...root.childNodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    order.set(node, order.size);
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      stack.push(node.childNodes[index]);
    }
  }
  return order;
}

export interface RankedHierarchyNode<T> {
  item: T;
  tier: number;
  children: RankedHierarchyNode<T>[];
  maxSubtreeTier: number;
  excludedByDescendant: boolean;
  excluded: boolean;
}

/**
 * Resolves a forest of nested candidate items by tier:
 * - Any ancestor with a descendant of equal or higher tier is excluded (prefer finer semantic leaves).
 * - Any descendant with a surviving strictly stronger ancestor is excluded (e.g. a paragraph suppresses nested fragments).
 */
export function resolveRankedHierarchy<T>(
  nodes: RankedHierarchyNode<T>[],
  roots: RankedHierarchyNode<T>[],
): T[] {
  const postOrder: Array<{ node: RankedHierarchyNode<T>; visited: boolean }> = roots
    .map((node) => ({ node, visited: false }))
    .reverse();

  while (postOrder.length > 0) {
    const { node, visited } = postOrder.pop()!;
    if (!visited) {
      postOrder.push({ node, visited: true });
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        postOrder.push({ node: node.children[index], visited: false });
      }
      continue;
    }

    let maxDescendantTier = Number.NEGATIVE_INFINITY;
    for (const child of node.children) {
      maxDescendantTier = Math.max(maxDescendantTier, child.maxSubtreeTier);
    }
    node.excludedByDescendant = maxDescendantTier >= node.tier;
    node.maxSubtreeTier = Math.max(node.tier, maxDescendantTier);
  }

  const preOrder: Array<{
    node: RankedHierarchyNode<T>;
    survivingAncestorTier: number | null;
  }> = roots
    .map((node) => ({ node, survivingAncestorTier: null }))
    .reverse();

  while (preOrder.length > 0) {
    const { node, survivingAncestorTier } = preOrder.pop()!;
    const excludedByAncestor =
      !node.excludedByDescendant &&
      survivingAncestorTier !== null &&
      survivingAncestorTier > node.tier;
    node.excluded = node.excludedByDescendant || excludedByAncestor;
    const nextAncestorTier = node.excluded ? survivingAncestorTier : node.tier;

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      preOrder.push({
        node: node.children[index],
        survivingAncestorTier: nextAncestorTier,
      });
    }
  }

  return nodes
    .filter((node) => !node.excluded)
    .map((node) => node.item);
}

export interface HeadingAnchor {
  element: HTMLElement;
  text: string;
  sectionScope: Element | null;
  order: number;
}

export function groupAnchorsByHeading(
  paragraphs: readonly HTMLElement[],
  headings: readonly HeadingAnchor[],
  documentOrder: ReadonlyMap<Node, number>,
): Section[] {
  const sections: Section[] = [];
  let previousHeading: HTMLElement | null | undefined;

  for (const paragraph of paragraphs) {
    const paragraphOrder = documentOrder.get(paragraph);
    let matched: HeadingAnchor | null = null;
    if (paragraphOrder !== undefined) {
      for (let index = headings.length - 1; index >= 0; index -= 1) {
        const heading = headings[index];
        if (heading.order >= paragraphOrder) continue;
        if (!heading.sectionScope || heading.sectionScope.contains(paragraph)) {
          matched = heading;
          break;
        }
      }
    }

    const headingElement = matched?.element ?? null;
    if (headingElement !== previousHeading) {
      sections.push({ heading: matched?.text ?? null, paragraphs: [] });
      previousHeading = headingElement;
    }
    sections[sections.length - 1].paragraphs.push(paragraph);
  }

  return sections;
}
