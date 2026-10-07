import { collectParagraphs, type Section } from "./dom-parser";
import { isMagazineArticleHeader, isSourceHidden, SOURCE_UI_SELECTOR as UI_SELECTOR } from "./text-extraction";

export interface ReadingScope {
  paragraphCount: number;
  sectionCount: number;
  captionCount: number;
  tableCount: number;
  partial: boolean;
  reasons: string[];
}

export interface ReadingDocument {
  kind: "paper" | "article";
  sections: Section[];
  scope: ReadingScope;
}

export interface ReadingDocumentOptions {
  includeTranslatedParagraphs?: boolean;
}

const LANDMARK_SELECTOR = "header, footer, [role='banner'], [role='contentinfo']";
const GATE_SELECTOR = [
  "[class*='paywall']", "[id*='paywall']", ".subscription-gate", ".login-modal",
  ".purchase-access", ".signin", ".sign-in", ".subscription-access", ".access-gate",
  "#purchase-access", "#signin", "#sign-in", "#subscription-access", "#access-gate",
  "[data-access-state='restricted']",
].join(",");
const ANCILLARY_SELECTOR = [
  "#references", "#refs", "#bibliography", ".references", ".bibliography", ".ref-list",
  ".article-references", ".c-article-references", ".article-section--references", ".NLM_ref-list",
  "[role='doc-bibliography']", ".ltx_bibliography",
  ".ltx_authors", ".ltx_permission", ".reference-links",
].join(",");
const ANCILLARY_HEADING = /^(references?|bibliography|literature cited|works cited|reference list|CRediT authorship contribution statement|author contributions?|declaration of competing interest|competing interests?|conflict of interest statement|acknowledg(?:e)?ments?|funding|data availability|availability of data and materials|supplementary materials?|ethics declarations?|author information)$/i;
const CAPTION_SELECTOR = "figcaption, caption, .fig-caption, .figure-caption, .figure__caption, .figcaption, .NLM_caption, .ltx_caption, .graphic_title, .caption, .captions";
const LEAF_SELECTOR = [
  "p", "[role='paragraph']", ".NLM_p", ".Para", ".paragraph-element", ".section-paragraph",
  ".para", ".ltx_para", ".html-p", "li", "dd", "blockquote", "figcaption", "table",
  CAPTION_SELECTOR,
  ".standfirst", ".dek", ".article-lead", "[itemprop='description']",
].join(",");
const CONTENT_ROOT_SELECTOR = [
  "[itemprop='articleBody']", "#article__body", ".article__body", ".article-body",
  ".c-article-body", ".article-section__content", ".widget-ArticleFulltext", ".hlFld-Fulltext",
  "div#body", "section#body", ".Body", "#abstracts", ".Abstracts", ".abstract", ".abstractSection",
  ".hlFld-Abstract", ".Appendices", ".ltx_document", ".html-body", ".fulltext",
].join(",");
const CONTROL_TEXT = /^(share|subscribe|sign in|log in|close|menu|advertisement|download pdf|view full text|read more|previous|next)$/i;
const LOADING_SELECTOR = "[data-loaded='false'], [data-loading='true'], [aria-busy='true'], .article-loading";
const NON_TEXT_SELECTOR = "script, style, template, noscript, svg, canvas";
const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,[role='heading']";
const MAX_WALK_NODES = 100_000;
const FRONTIERS_CONTENT_SELECTOR = ".ArticleDetailsV4__main__content";

function meaningful(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length >= 2 && /[\p{L}\p{N}]/u.test(normalized) && !CONTROL_TEXT.test(normalized);
}

interface SourceFilter {
  hidden(element: Element): boolean;
  ui(element: Element): boolean;
  ancillary(element: Element): boolean;
  excluded(element: Element): boolean;
}

function sourceFilter(ownership?: ArticleOwnership): SourceFilter {
  const hiddenCache = new WeakMap<Element, boolean>();
  const uiCache = new WeakMap<Element, boolean>();
  const ancillaryCache = new WeakMap<Element, boolean>();
  const excludedCache = new WeakMap<Element, boolean>();
  const directHeadings = new WeakMap<Element, Element | null>();
  const precedingHeadings = new WeakMap<Element, Element | null>();
  const articleLandmark = (element: Element): boolean => {
    if (ownership && !isOwned(element, ownership)) return false;
    // Keep the magazine title available during discovery, but omit its full
    // reported header (including the teaser) from the accepted provider source.
    if (ownership && isMagazineArticleHeader(element)) return false;
    const article = element.closest("article");
    if (article && (!ownership || isOwned(article, ownership))) return true;
    const body = element.closest(`${CONTENT_ROOT_SELECTOR},${FRONTIERS_CONTENT_SELECTOR}`);
    if (body && (!ownership || isOwned(body, ownership))) return true;
    if (ownership) {
      // A narrow selected story/body root can own its landmarks; a broad main
      // also contains unrelated site chrome, so only its current title header
      // is evidence of ownership.
      if (ownership.roots.some((root) => !root.matches("main, [role='main']") && root.contains(element))) return true;
      return Boolean(element.matches("header, [role='banner']") && ownership.title && element.contains(ownership.title));
    }
    // Root discovery cannot depend on ownership that has not been selected
    // yet. Admit title-bearing main headers, using the declared article title
    // when available, and classify them again with a fresh bounded filter.
    if (!element.matches("header, [role='banner']") || !element.closest("main, [role='main']")) return false;
    const title = normalizeTitle(document.querySelector("meta[name='citation_title']")?.getAttribute("content") ?? "");
    return [...element.querySelectorAll("h1")].some((heading) => !title || normalizeTitle(heading.textContent ?? "") === title);
  };
  const precedingHeading = (element: Element): Element | null => {
    const skipped = [element];
    let heading: Element | null = null;
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.matches(HEADING_SELECTOR)) { heading = sibling; break; }
      if (precedingHeadings.has(sibling)) { heading = precedingHeadings.get(sibling)!; break; }
      skipped.push(sibling);
    }
    skipped.forEach((current) => precedingHeadings.set(current, heading));
    return heading;
  };
  const classifyAncillary = (element: Element): boolean => {
    if (element.closest(ANCILLARY_SELECTOR)) return true;
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (current.matches(HEADING_SELECTOR)) return ANCILLARY_HEADING.test(current.textContent?.trim() ?? "");
      if (current.matches("section, div, aside")) {
        if (!directHeadings.has(current)) directHeadings.set(current, current.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6"));
        const heading = directHeadings.get(current);
        if (heading) return ANCILLARY_HEADING.test(heading.textContent?.trim() ?? "");
      }
      // A later appendix heading ends a flat references/metadata section.
      const heading = precedingHeading(current);
      if (heading) return ANCILLARY_HEADING.test(heading.textContent?.trim() ?? "");
    }
    return false;
  };
  const filter: SourceFilter = {
    hidden: (element) => isSourceHidden(element, hiddenCache),
    ui: (element) => {
      if (!uiCache.has(element)) {
        let excluded = Boolean(element.closest(UI_SELECTOR));
        for (let current = element.closest(LANDMARK_SELECTOR); current && !excluded; current = current.parentElement?.closest(LANDMARK_SELECTOR) ?? null) {
          excluded = !articleLandmark(current);
        }
        uiCache.set(element, excluded);
      }
      return uiCache.get(element)!;
    },
    ancillary: (element) => {
      if (!ancillaryCache.has(element)) ancillaryCache.set(element, classifyAncillary(element));
      return ancillaryCache.get(element)!;
    },
    excluded: (element) => {
      if (!excludedCache.has(element)) excludedCache.set(element, filter.hidden(element) ||
        filter.ui(element) || Boolean(element.closest(`${GATE_SELECTOR},${LOADING_SELECTOR},${NON_TEXT_SELECTOR}`)) || filter.ancillary(element));
      return excludedCache.get(element)!;
    },
  };
  return filter;
}

function normalizeTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function firstHeading(scope: Element, filter: SourceFilter): Element | undefined {
  return [...scope.querySelectorAll("h1")].find((element) => !filter.excluded(element));
}

function hasOwnedMainProse(main: Element, filter: SourceFilter): boolean {
  const title = firstHeading(main, filter);
  if (!title || title.closest("article")) return false;
  return [...main.querySelectorAll("p, [role='paragraph']")].some((element) =>
    !element.closest("article, header, aside") && !filter.excluded(element) && meaningful(element.textContent ?? ""));
}

function mainForArticle(publisherRoots: readonly Element[], filter: SourceFilter): Element | undefined {
  const mains = [...document.querySelectorAll("main, [role='main']")].filter((element) => !filter.excluded(element));
  const title = normalizeTitle(document.querySelector("meta[name='citation_title']")?.getAttribute("content") ?? "");
  // A declared paper title and a known body are stronger ownership evidence
  // than element order or an unrelated promotional <article> tag.
  return (title ? mains.find((main) => [...main.querySelectorAll("h1")].some((heading) =>
    !filter.excluded(heading) && normalizeTitle(heading.textContent ?? "") === title)) : undefined) ??
    mains.find((main) => publisherRoots.some((root) => main.contains(root)) || main.querySelector(FRONTIERS_CONTENT_SELECTOR)) ??
    mains.find((main) => hasOwnedMainProse(main, filter)) ?? mains[0];
}

function rootsForArticle(seeds: readonly HTMLElement[], filter: SourceFilter): Element[] {
  const { excluded } = filter;
  const articles = Array.from(document.querySelectorAll("article")).filter((element) => !excluded(element) && meaningful(element.textContent ?? ""));
  const publisherRoots = Array.from(document.querySelectorAll(CONTENT_ROOT_SELECTOR)).filter((element) => !excluded(element));
  const main = mainForArticle(publisherRoots, filter);
  if (/(^|\.)frontiersin\.org$/i.test(window.location.hostname) && main) {
    const content = [...main.querySelectorAll(FRONTIERS_CONTENT_SELECTOR)].filter((element) => !excluded(element));
    if (content.length > 0) return content;
  }
  const mainTitleArticle = main && firstHeading(main, filter)?.closest("article");
  const citationTitle = normalizeTitle(document.querySelector("meta[name='citation_title']")?.getAttribute("content") ?? "");
  const primary = main
    ? (mainTitleArticle && articles.includes(mainTitleArticle) ? mainTitleArticle : undefined) ??
      (!hasOwnedMainProse(main, filter) ? articles.find((element) => main.contains(element)) : undefined)
    : (citationTitle ? articles.find((element) => [...element.querySelectorAll("h1")].some((heading) =>
      !excluded(heading) && normalizeTitle(heading.textContent ?? "") === citationTitle)) : undefined) ??
      articles.find((element) => !element.closest("aside") && firstHeading(element, filter)) ?? articles[0];
  if (primary) {
    if (primary.matches(".article-text") && !primary.querySelector("h1")) {
      return articles.filter((element) => element.matches(".article-text") && !element.querySelector("h1") && element.closest("main, [role='main']") === primary.closest("main, [role='main']"));
    }
    const order = new Map<Element, number>();
    document.querySelectorAll("*").forEach((element, index) => order.set(element, index));
    const next = articles.find((element) => element !== primary && !primary.contains(element) && (order.get(element) ?? 0) > (order.get(primary) ?? 0));
    const boundary = next ? order.get(next)! : Infinity;
    const externalRoots = publisherRoots.filter((element) => (order.get(element) ?? 0) < boundary && !primary.contains(element) && !element.closest("article") &&
      (main?.contains(primary) ? main.contains(element) : element.parentElement === primary.parentElement));
    const header = main?.contains(primary) && !primary.querySelector("h1")
      ? Array.from(main.querySelectorAll("header")).find((element) => !element.closest("article") && !excluded(element) && element.querySelector("h1") &&
        (order.get(element) ?? Infinity) < (order.get(primary) ?? 0))
      : null;
    return [primary, ...externalRoots, ...(header ? [header] : [])];
  }
  if (main && !excluded(main)) {
    const titles = Array.from(main.querySelectorAll("h1")).filter((element) => !excluded(element));
    if (titles.length > 1) {
      const story = titles[0].closest("section, div");
      if (story && main.contains(story) && !story.contains(titles[1])) return [story];
    }
    return [main];
  }
  if (publisherRoots.length > 0) return publisherRoots.filter((element) => !publisherRoots.some((other) => other !== element && other.contains(element)));
  const parents = seeds.map((element) => element.closest("section, div") ?? element);
  return [...new Set(parents)];
}

interface ArticleOwnership {
  roots: Element[];
  order: ReadonlyMap<Node, number>;
  end: number;
  context: Element | null;
  ignoredArticles: ReadonlySet<Element>;
  title: Element | null;
}

function articleOwnership(roots: Element[], filter: SourceFilter): ArticleOwnership {
  const { excluded } = filter;
  const order = new Map<Node, number>();
  const stack: Node[] = [...document.childNodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    order.set(node, order.size);
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index]);
  }
  const first = roots[0];
  const ignoredArticles = new Set<Element>();
  for (const root of roots) {
    if (!root.matches("main, [role='main']") || !hasOwnedMainProse(root, filter)) continue;
    for (const article of root.querySelectorAll("article")) {
      // These are observed auxiliary card templates, not evidence that an
      // unknown headingless article is unrelated to the scientific source.
      if (article.matches(".CardA, .CardJournal") && !article.querySelector(CONTENT_ROOT_SELECTOR)) ignoredArticles.add(article);
    }
  }
  const context = first?.closest("main, [role='main']") ?? first?.parentElement ?? null;
  const titles = context ? [...context.querySelectorAll("h1")].filter((element) => !excluded(element)) : [];
  const ownTitle = titles.find((element) => roots.some((root) => root.contains(element)));
  const nextTitle = ownTitle && titles.find((element) => (order.get(element) ?? 0) > (order.get(ownTitle) ?? 0) &&
    (!roots.some((root) => root.contains(element)) || first?.matches("main, [role='main']")));
  const nextArticle = context && [...context.querySelectorAll("article")].find((element) => !excluded(element) &&
    !roots.some((root) => root === element || root.contains(element)) && (order.get(element) ?? 0) > (order.get(first) ?? 0));
  return { roots, order, context, ignoredArticles, title: ownTitle ?? null,
    end: Math.min(nextTitle ? order.get(nextTitle)! : Infinity, nextArticle ? order.get(nextArticle)! : Infinity) };
}

function coveredBy(node: Node, accepted: ReadonlySet<Element>): boolean {
  for (let element = node.parentElement; element; element = element.parentElement) {
    if (accepted.has(element)) return true;
  }
  return false;
}

// This walk does not reuse the paragraph selectors. Every owned text node must
// be represented, explicitly excluded, safely recovered, or reported as partial.
function reconcileText(ownership: ArticleOwnership, initial: HTMLElement[], reasons: Set<string>, filter: SourceFilter): HTMLElement[] {
  const { excluded } = filter;
  const { roots } = ownership;
  const accepted = new Set<Element>(initial);
  const acceptedAncestors = new Set<Element>();
  const rememberAncestors = (element: Element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) acceptedAncestors.add(parent);
  };
  initial.forEach(rememberAncestors);
  const stack: Node[] = roots.flatMap((root) => [...root.childNodes]).reverse();
  const seen = new Set<Node>();
  let walked = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if ((ownership.order.get(node) ?? Infinity) >= ownership.end) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (++walked > MAX_WALK_NODES) { reasons.add("extraction-limit"); break; }
    if (node.nodeType === 1) {
      if (!isOwned(node as Element, ownership) || excluded(node as Element)) continue;
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index]);
      continue;
    }
    if (node.nodeType !== 3 || !meaningful(node.textContent ?? "") || coveredBy(node, accepted)) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const heading = parent.closest(HEADING_SELECTOR);
    if (heading) {
      const headingScope = heading.closest("section") ?? roots.find((root) => root.contains(heading));
      if (headingScope && (acceptedAncestors.has(headingScope) || accepted.has(headingScope))) continue;
      reasons.add("unrepresented-article-text");
      continue;
    }
    const anchor = parent.closest("div, li, dd, blockquote, figcaption, section, article, main, header, footer") ?? parent;
    const hasAcceptedDescendant = acceptedAncestors.has(anchor);
    // Known UI is also stripped by the serializer, so it cannot contaminate
    // recovered prose. Gates and ancillary exclusions still block recovery.
    const hasExcludedText = !hasAcceptedDescendant && Array.from(anchor.querySelectorAll("*")).some((element) =>
      excluded(element) && !element.closest(UI_SELECTOR) && meaningful(element.textContent ?? ""));
    if (isOwned(anchor, ownership) && !hasAcceptedDescendant && !hasExcludedText && !anchor.querySelector(HEADING_SELECTOR)) {
      accepted.add(anchor);
      rememberAncestors(anchor);
    } else {
      reasons.add("unrepresented-article-text");
    }
  }
  return [...accepted] as HTMLElement[];
}

function isOwned(element: Element, ownership: ArticleOwnership): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (ownership.ignoredArticles.has(current)) return false;
  }
  return (ownership.order.get(element) ?? Infinity) < ownership.end && ownership.roots.some((root) => root === element || root.contains(element));
}

function isFrontiersAbstractOnly(roots: readonly Element[], filter: SourceFilter): boolean {
  if (!/(^|\.)frontiersin\.org$/i.test(window.location.hostname)) return false;
  return roots.some((root) => {
    if (!root.matches(FRONTIERS_CONTENT_SELECTOR)) return false;
    const headings = [...root.querySelectorAll(HEADING_SELECTOR)].filter((element) => !filter.excluded(element));
    if (headings.length === 0 || !headings.every((element) => /^abstract$/i.test(element.textContent?.trim() ?? ""))) return false;
    const main = root.closest("main, [role='main']");
    return Boolean(main && [...main.querySelectorAll(".NotifyMeBanner .Alert__message")].some((element) =>
      !filter.hidden(element) && /\bfinal,?\s*formatted\s+version\b[\s\S]{0,160}\b(?:published|available)\s+soon\b/i.test(element.textContent ?? "")));
  });
}

function groupSections(paragraphs: HTMLElement[], ownership: ArticleOwnership, filter: SourceFilter): Section[] {
  const { excluded } = filter;
  const order = new Map<Element, number>();
  document.querySelectorAll("*").forEach((element, index) => order.set(element, index));
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,[role='heading']"))
    .filter((element) => isOwned(element, ownership) && !excluded(element) && meaningful(element.textContent ?? ""));
  const sections: Section[] = [];
  let previous: HTMLElement | null | undefined;
  for (const paragraph of paragraphs) {
    const heading = [...headings].reverse().find((element) => {
      const section = element.closest("section");
      return (order.get(element) ?? Infinity) < (order.get(paragraph) ?? -1) && (!section || section.contains(paragraph));
    }) ?? null;
    if (heading !== previous) {
      sections.push({ heading: heading?.textContent?.trim() ?? null, paragraphs: [] });
      previous = heading;
    }
    sections[sections.length - 1].paragraphs.push(paragraph);
  }
  return sections;
}

export function collectReadingDocument(options: ReadingDocumentOptions = {}): ReadingDocument {
  if (document.getElementsByTagName("*").length > MAX_WALK_NODES) {
    return { kind: readingKind(), sections: [], scope: { paragraphCount: 0, sectionCount: 0, captionCount: 0,
      tableCount: 0, partial: true, reasons: ["extraction-limit"] } };
  }
  const discoveryFilter = sourceFilter();
  const seeds = collectParagraphs({ includeTranslatedParagraphs: true });
  const roots = rootsForArticle(seeds, discoveryFilter);
  const ownership = articleOwnership(roots, discoveryFilter);
  const filter = sourceFilter(ownership);
  const { hidden, ancillary, excluded } = filter;
  const reasons = new Set<string>();
  if (isFrontiersAbstractOnly(roots, filter)) reasons.add("abstract-only");
  const visibleSourceSignal = (element: Element) => isOwned(element, ownership) && !hidden(element) && !filter.ui(element);
  const allOwned = (selector: string) => roots.some((root) => (root.matches(selector) && visibleSourceSignal(root)) ||
    [...root.querySelectorAll(selector)].some(visibleSourceSignal));
  const contextSignal = (selector: string) => Boolean(ownership.context && [...ownership.context.querySelectorAll(selector)].some((element) => {
    const article = element.closest("article");
    return !hidden(element) && !filter.ui(element) && (ownership.order.get(element) ?? Infinity) < ownership.end &&
      (!article || isOwned(article, ownership));
  }));
  if (allOwned(GATE_SELECTOR) || contextSignal(GATE_SELECTOR) || (roots.length === 0 && [...document.querySelectorAll(GATE_SELECTOR)].some((element) => !hidden(element)))) reasons.add("access-restricted");
  if (allOwned(LOADING_SELECTOR) || contextSignal(LOADING_SELECTOR)) reasons.add("content-not-loaded");
  const declaredOwnership = roots.some((root) => root.matches(`article, main, [role='main'], ${CONTENT_ROOT_SELECTOR}`)) ||
    (/(^|\.)frontiersin\.org$/i.test(window.location.hostname) && roots.some((root) => root.matches(FRONTIERS_CONTENT_SELECTOR))) ||
    Boolean(ownership.context?.matches("main, [role='main']") && roots[0]?.querySelector("h1"));
  if (roots.length > 0 && !declaredOwnership) reasons.add("article-boundary-uncertain");
  const candidates = new Set<HTMLElement>(seeds.filter((element) => isOwned(element, ownership)));
  for (const root of roots) {
    if (root.matches(LEAF_SELECTOR)) candidates.add(root as HTMLElement);
    root.querySelectorAll<HTMLElement>(LEAF_SELECTOR).forEach((element) => candidates.add(element));
    root.querySelectorAll<HTMLElement>("div[id^='p']").forEach((element) => candidates.add(element));
  }
  const eligible = [...candidates].filter((element) => isOwned(element, ownership) && !excluded(element) && meaningful(element.textContent ?? ""));
  const eligibleSet = new Set<Element>(eligible);
  const nestedAncestors = new Set<Element>();
  for (const element of eligible) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (eligibleSet.has(parent)) nestedAncestors.add(parent);
    }
  }
  const selected = eligible.filter((element) => {
    if (element.closest("table") && element.tagName !== "TABLE") return false;
    if (element.tagName === "TABLE") return true;
    return !nestedAncestors.has(element);
  });
  const complete = reconcileText(ownership, selected, reasons, filter);
  if (complete.length === 0) reasons.add("no-readable-content");
  const paragraphs = complete.filter((element) => options.includeTranslatedParagraphs === true || !element.closest("[data-paperlens-id]"));
  const order = new Map<Element, number>();
  document.querySelectorAll("*").forEach((element, index) => order.set(element, index));
  paragraphs.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const sections = groupSections(paragraphs, ownership, filter);
  const captions = new Set<Element>();
  for (const paragraph of paragraphs) {
    const caption = paragraph.closest(CAPTION_SELECTOR);
    if (caption) captions.add(caption);
    if (paragraph.tagName === "TABLE") paragraph.querySelectorAll("caption").forEach((element) => captions.add(element));
  }
  const partial = reasons.size > 0;
  if (roots.some((root) => [...root.querySelectorAll(`section, div, aside, ${HEADING_SELECTOR}`)].some(ancillary))) reasons.add("ancillary-content-excluded");
  return {
    kind: readingKind(), sections,
    scope: { paragraphCount: paragraphs.length, sectionCount: sections.length, captionCount: captions.size,
      tableCount: paragraphs.filter((element) => element.tagName === "TABLE").length, partial, reasons: [...reasons] },
  };
}

function readingKind(): ReadingDocument["kind"] {
  const isNews = Boolean(document.querySelector("[itemtype*='NewsArticle'], [itemtype*='BlogPosting'], meta[property='og:type'][content='news']"));
  const isPaper = !isNews && (Boolean(document.querySelector("meta[name='citation_title'], meta[name='citation_doi'], [itemtype*='ScholarlyArticle']")) ||
    /(?:sciencedirect|nature|springer|wiley|pubs\.acs|pubs\.rsc|pubs\.aip|scitation|ieeexplore|science|plos|ncbi|arxiv|cell|tandfonline|sagepub|academic\.oup|cambridge|mdpi|frontiersin)\./i.test(window.location.hostname));
  return isPaper ? "paper" : "article";
}
