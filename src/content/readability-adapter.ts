import Readability from "../vendor/readability/Readability.js";

const SOURCE_ATTRIBUTE = "data-paperlens-source-id";
const MAX_SOURCE_ELEMENTS = 100_000;
const MAX_ELIGIBLE_CANDIDATES = 10_000;
const EXPLICIT_LEAF_SELECTOR = [
  "p",
  "[role='paragraph']",
  ".NLM_p",
  ".Para",
  ".paragraph-element",
  ".section-paragraph",
  "figcaption",
].join(",");
const STRUCTURAL_TEXT_SELECTOR = "div, li, dd, blockquote";
const STRUCTURAL_SKIP_SELECTOR =
  "nav, header, footer, form, table, [role='navigation'], [role='banner'], [role='contentinfo']";
const PARAGRAPH_TOKEN_RE = /(^|[\s_-])(p|para|paragraph)([\s_-]|$)/i;
const EXPLICIT_LEAF_TIER = 3;
const PARAGRAPH_METADATA_TIER = 2;
const STRUCTURAL_TEXT_TIER = 1;
const MIN_STRUCTURAL_TEXT_LENGTH = 80;
const DIRECT_FLOW_BOUNDARIES = new Set([
  "div",
  "p",
  "li",
  "dd",
  "blockquote",
  "figcaption",
  "section",
  "article",
  "aside",
  "table",
  "ul",
  "ol",
  "form",
  "nav",
  "header",
  "footer",
]);
const NON_FLOW_TEXT_ELEMENTS = new Set(["script", "style", "template", "noscript"]);
const PAPERLENS_UI_SELECTOR = ".paperlens-translation, .paperlens-summary";

type DiagnosticReason =
  | "preflight-limit"
  | "candidate-limit"
  | "clone-source-mismatch"
  | "null-parse"
  | "lost-marker-mapping"
  | "unexpected-error";

interface CacheEntry {
  elements: HTMLElement[];
  observer: MutationObserver;
  publisherNodes: WeakSet<Node>;
}

interface RankedCandidate {
  element: HTMLElement;
  tier: number;
  children: RankedCandidate[];
  maxSubtreeTier: number;
  excludedByDescendant: boolean;
  excluded: boolean;
}

interface CandidateTraversalFrame {
  element: Element;
  candidateParent: RankedCandidate | null;
  insideStructuralSkip: boolean;
}

const mappingCache = new WeakMap<Document, CacheEntry>();

function reportFailure(reason: DiagnosticReason): void {
  if (typeof chrome !== "undefined" && Boolean(chrome.runtime?.id)) {
    console.debug("PaperLens: Readability fallback skipped", reason);
  }
}

function nodeElement(node: Node): Element | null {
  return node.nodeType === 1 ? node as Element : node.parentElement;
}

function isInsidePaperLensUi(node: Node): boolean {
  const element = nodeElement(node);
  return Boolean(
    element?.matches(PAPERLENS_UI_SELECTOR) || element?.closest(PAPERLENS_UI_SELECTOR),
  );
}

function isPaperLensUiRoot(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).matches(PAPERLENS_UI_SELECTOR);
}

function changedNodes(record: MutationRecord): Node[] {
  return [...record.addedNodes, ...record.removedNodes];
}

function recordTouchesPaperLensUi(record: MutationRecord): boolean {
  if (isInsidePaperLensUi(record.target)) return true;
  return changedNodes(record).some((node) =>
    isPaperLensUiRoot(node) || isInsidePaperLensUi(node),
  );
}

function isDirectlyIgnoredMutation(record: MutationRecord): boolean {
  if (record.type === "attributes" && record.attributeName === "data-paperlens-id") {
    return true;
  }
  if (isInsidePaperLensUi(record.target)) return true;
  if (record.type !== "childList") return false;

  const nodes = changedNodes(record);
  if (nodes.length === 0) return true;
  return nodes.every((node) => isPaperLensUiRoot(node) || isInsidePaperLensUi(node));
}

function collectPublisherNodes(source: Document): WeakSet<Node> {
  const publisherNodes = new WeakSet<Node>();
  const stack = Array.from(source.childNodes);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isPaperLensUiRoot(node)) continue;
    publisherNodes.add(node);
    for (const child of node.childNodes) stack.push(child);
  }
  return publisherNodes;
}

function hasMeaningfulMutation(
  source: Document,
  entry: CacheEntry,
  records: MutationRecord[],
): boolean {
  const pending = records.filter((record) => !isDirectlyIgnoredMutation(record));
  if (pending.length === 0) return false;

  const hasPaperLensUiActivity = records.some(recordTouchesPaperLensUi);
  const detachedTextBalance = new Map<Node, number>();
  for (const record of pending) {
    if (entry.publisherNodes.has(record.target)) return true;
    if (record.type !== "childList") return true;

    for (const node of record.addedNodes) {
      if (isPaperLensUiRoot(node) || isInsidePaperLensUi(node)) continue;
      if (entry.publisherNodes.has(node)) return true;
      if (source.contains(node) || node.nodeType === 1) return true;
      detachedTextBalance.set(node, (detachedTextBalance.get(node) ?? 0) + 1);
    }
    for (const node of record.removedNodes) {
      if (isPaperLensUiRoot(node) || isInsidePaperLensUi(node)) continue;
      if (entry.publisherNodes.has(node)) return true;
      if (source.contains(node) || node.nodeType === 1) return true;
      detachedTextBalance.set(node, (detachedTextBalance.get(node) ?? 0) - 1);
    }
  }

  return !hasPaperLensUiActivity ||
    [...detachedTextBalance.values()].some((balance) => balance !== 0);
}

function discardCache(source: Document, entry: CacheEntry): void {
  entry.observer.disconnect();
  if (mappingCache.get(source) === entry) mappingCache.delete(source);
}

function cachedElements(source: Document): HTMLElement[] | null {
  const entry = mappingCache.get(source);
  if (!entry) return null;

  if (hasMeaningfulMutation(source, entry, entry.observer.takeRecords())) {
    discardCache(source, entry);
    return null;
  }
  const allConnected = entry.elements.every((element) =>
    element.ownerDocument === source && element.isConnected && source.contains(element),
  );
  if (!allConnected) {
    discardCache(source, entry);
    return null;
  }
  return [...entry.elements];
}

function cacheElements(source: Document, elements: HTMLElement[]): void {
  const MutationObserverConstructor = source.defaultView?.MutationObserver;
  if (!MutationObserverConstructor || elements.length === 0) return;

  const previous = mappingCache.get(source);
  if (previous) discardCache(source, previous);

  let entry: CacheEntry;
  const observer = new MutationObserverConstructor((records) => {
    if (hasMeaningfulMutation(source, entry, records)) discardCache(source, entry);
  });
  entry = {
    elements: [...elements],
    observer,
    publisherNodes: collectPublisherNodes(source),
  };
  observer.observe(source, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  mappingCache.set(source, entry);
}

function directFlowTextLength(element: HTMLElement): number {
  const text: string[] = [];
  const stack = Array.from(element.childNodes).reverse();

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === 3) {
      text.push(node.textContent ?? "");
      continue;
    }
    if (node.nodeType !== 1) continue;

    const child = node as HTMLElement;
    const tagName = child.tagName.toLowerCase();
    if (DIRECT_FLOW_BOUNDARIES.has(tagName) || NON_FLOW_TEXT_ELEMENTS.has(tagName)) continue;
    for (let index = child.childNodes.length - 1; index >= 0; index -= 1) {
      stack.push(child.childNodes[index]);
    }
  }

  return text.join("").replace(/\s+/g, " ").trim().length;
}

function candidateTier(
  element: HTMLElement,
  insideStructuralSkip: boolean,
): number | null {
  if (element.matches(EXPLICIT_LEAF_SELECTOR)) return EXPLICIT_LEAF_TIER;
  if (!element.matches(STRUCTURAL_TEXT_SELECTOR)) return null;
  if (insideStructuralSkip) return null;

  const metadata = `${element.id} ${element.getAttribute("class") ?? ""}`;
  if (PARAGRAPH_TOKEN_RE.test(metadata)) return PARAGRAPH_METADATA_TIER;
  return directFlowTextLength(element) >= MIN_STRUCTURAL_TEXT_LENGTH
    ? STRUCTURAL_TEXT_TIER
    : null;
}

function resolveRankedCandidates(
  candidates: RankedCandidate[],
  roots: RankedCandidate[],
): HTMLElement[] {
  const postOrder: Array<{ candidate: RankedCandidate; visited: boolean }> = roots
    .map((candidate) => ({ candidate, visited: false }))
    .reverse();

  while (postOrder.length > 0) {
    const { candidate, visited } = postOrder.pop()!;
    if (!visited) {
      postOrder.push({ candidate, visited: true });
      for (let index = candidate.children.length - 1; index >= 0; index -= 1) {
        postOrder.push({ candidate: candidate.children[index], visited: false });
      }
      continue;
    }

    let maxDescendantTier = Number.NEGATIVE_INFINITY;
    for (const child of candidate.children) {
      maxDescendantTier = Math.max(maxDescendantTier, child.maxSubtreeTier);
    }
    candidate.excludedByDescendant = maxDescendantTier >= candidate.tier;
    candidate.maxSubtreeTier = Math.max(candidate.tier, maxDescendantTier);
  }

  const preOrder: Array<{
    candidate: RankedCandidate;
    survivingAncestorTier: number | null;
  }> = roots
    .map((candidate) => ({ candidate, survivingAncestorTier: null }))
    .reverse();

  while (preOrder.length > 0) {
    const { candidate, survivingAncestorTier } = preOrder.pop()!;
    const excludedByAncestor = !candidate.excludedByDescendant &&
      survivingAncestorTier !== null &&
      survivingAncestorTier > candidate.tier;
    candidate.excluded = candidate.excludedByDescendant || excludedByAncestor;
    const nextAncestorTier = candidate.excluded
      ? survivingAncestorTier
      : candidate.tier;

    for (let index = candidate.children.length - 1; index >= 0; index -= 1) {
      preOrder.push({
        candidate: candidate.children[index],
        survivingAncestorTier: nextAncestorTier,
      });
    }
  }

  return candidates
    .filter((candidate) => !candidate.excluded)
    .map((candidate) => candidate.element);
}

function eligibleElements(
  source: ParentNode,
  maxCandidates = Number.POSITIVE_INFINITY,
): HTMLElement[] | null {
  const sourceElement = (source as Node).nodeType === 1
    ? source as HTMLElement
    : null;
  if (sourceElement?.closest(PAPERLENS_UI_SELECTOR)) return [];

  const candidates: RankedCandidate[] = [];
  const roots: RankedCandidate[] = [];
  const initialStructuralSkip = Boolean(sourceElement?.closest(STRUCTURAL_SKIP_SELECTOR));
  const traversal: CandidateTraversalFrame[] = Array.from(source.children)
    .map((element) => ({
      element,
      candidateParent: null,
      insideStructuralSkip: initialStructuralSkip,
    }))
    .reverse();

  while (traversal.length > 0) {
    const frame = traversal.pop()!;
    const element = frame.element as HTMLElement;
    if (element.matches(PAPERLENS_UI_SELECTOR)) continue;

    const insideStructuralSkip = frame.insideStructuralSkip ||
      element.matches(STRUCTURAL_SKIP_SELECTOR);
    const tier = candidateTier(element, insideStructuralSkip);
    let candidateParent = frame.candidateParent;

    if (tier !== null) {
      const candidate: RankedCandidate = {
        element,
        tier,
        children: [],
        maxSubtreeTier: tier,
        excludedByDescendant: false,
        excluded: false,
      };
      candidates.push(candidate);
      if (candidateParent) candidateParent.children.push(candidate);
      else roots.push(candidate);
      candidateParent = candidate;
      if (candidates.length > maxCandidates) return null;
    }

    const children = Array.from(element.children);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      traversal.push({
        element: children[index],
        candidateParent,
        insideStructuralSkip,
      });
    }
  }

  return resolveRankedCandidates(candidates, roots);
}

function sortOriginals(
  elements: HTMLElement[],
  sourceOrder: ReadonlyMap<HTMLElement, number>,
): HTMLElement[] {
  return elements.sort((a, b) => {
    const aIndex = sourceOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = sourceOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

export function collectReadabilitySourceElements(source: Document): HTMLElement[] {
  try {
    const cached = cachedElements(source);
    if (cached) return cached;

    const sourceElementCount = source.getElementsByTagName("*").length;
    if (sourceElementCount > MAX_SOURCE_ELEMENTS) {
      reportFailure("preflight-limit");
      return [];
    }

    const originals = eligibleElements(source, MAX_ELIGIBLE_CANDIDATES);
    if (!originals) {
      reportFailure("candidate-limit");
      return [];
    }
    if (originals.length === 0) return [];

    const clone = source.cloneNode(true) as Document;
    clone
      .querySelectorAll<HTMLElement>(`[${SOURCE_ATTRIBUTE}]`)
      .forEach((element) => element.removeAttribute(SOURCE_ATTRIBUTE));
    const cloneElements = eligibleElements(clone);
    if (!cloneElements || cloneElements.length !== originals.length) {
      reportFailure("clone-source-mismatch");
      return [];
    }

    const sourceById = new Map<string, HTMLElement>();
    const sourceOrder = new Map<HTMLElement, number>();
    let markerCarrierCount = 0;
    cloneElements.forEach((element, index) => {
      const id = String(index);
      element.setAttribute(SOURCE_ATTRIBUTE, id);
      if (element.tagName.toLowerCase() !== "p") {
        const markerCarrier = clone.createElement("span");
        markerCarrier.setAttribute(SOURCE_ATTRIBUTE, id);
        element.appendChild(markerCarrier);
        markerCarrierCount += 1;
      }
      sourceById.set(id, originals[index]);
      sourceOrder.set(originals[index], index);
    });
    clone.querySelectorAll(PAPERLENS_UI_SELECTOR).forEach((element) => element.remove());

    const parsed = new Readability<HTMLElement>(clone, {
      maxElemsToParse: sourceElementCount + markerCarrierCount,
      charThreshold: 200,
      serializer: (element) => element as HTMLElement,
    }).parse();
    if (!parsed?.content) {
      reportFailure("null-parse");
      return [];
    }

    const marked = [
      ...(parsed.content.hasAttribute(SOURCE_ATTRIBUTE) ? [parsed.content] : []),
      ...parsed.content.querySelectorAll<HTMLElement>(`[${SOURCE_ATTRIBUTE}]`),
    ];
    const mapped: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    for (const cloneElement of marked) {
      const original = sourceById.get(cloneElement.getAttribute(SOURCE_ATTRIBUTE) ?? "");
      if (!original || seen.has(original)) continue;
      if (original.ownerDocument !== source || !source.contains(original)) continue;
      seen.add(original);
      mapped.push(original);
    }
    if (mapped.length === 0) {
      reportFailure("lost-marker-mapping");
      return [];
    }
    const result = sortOriginals(mapped, sourceOrder);
    cacheElements(source, result);
    return [...result];
  } catch {
    reportFailure("unexpected-error");
    return [];
  }
}
