import type { SentenceAlignment } from "../shared/types";
import { isSourceHidden } from "./text-extraction";

const SENTENCE_CLASS = "paperlens-sentence";
const HIGHLIGHT_CLASS = "paperlens-highlight";
const PINNED_CLASS = "paperlens-highlight-pinned";
const GAP_CLASS = "paperlens-sentence-gap"; // unmatched text, no cross-highlight

const SKIP_WRAP_SUBTREE_SELECTOR = [
  ".paperlens-translation",
  ".paperlens-summary",
  "[data-paperlens-ui]",
  "script", "style", "template", "noscript", "svg", "canvas",
  "button", "input", "select", "textarea",
].join(",");

// Math elements remain part of sentence text for alignment offsets,
// but their internal DOM nodes are never mutated or wrapped.
const ATOMIC_UNWRAPPABLE_SELECTOR =
  "math, mjx-container, .MathJax, .katex, [role='math']";

// ---------------------------------------------------------------------------
// Safe text-node collection (skips PaperLens UI, hidden nodes, controls, math)
// ---------------------------------------------------------------------------

interface IndexedTextNode {
  node: Text;
  start: number;
  end: number;
}

function collectHighlightableTextNodes(root: HTMLElement): {
  nodes: IndexedTextNode[];
  fullText: string;
} {
  const hiddenCache = new WeakMap<Element, boolean>();
  const nodes: IndexedTextNode[] = [];
  const parts: string[] = [];
  let offset = 0;

  const stack: Array<{ node: Node; atomic: boolean }> = [...root.childNodes]
    .reverse()
    .map((node) => ({ node, atomic: false }));

  while (stack.length > 0) {
    const { node: current, atomic } = stack.pop()!;
    if (current.nodeType === 3) {
      const textNode = current as Text;
      const value = textNode.data;
      if (value.length > 0) {
        if (!atomic) {
          nodes.push({ node: textNode, start: offset, end: offset + value.length });
        }
        parts.push(value);
        offset += value.length;
      }
      continue;
    }
    if (current.nodeType !== 1) continue;
    const element = current as Element;
    if (element.matches(SKIP_WRAP_SUBTREE_SELECTOR) || isSourceHidden(element, hiddenCache)) {
      continue;
    }
    const childAtomic = atomic || element.matches(ATOMIC_UNWRAPPABLE_SELECTOR);
    for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
      stack.push({ node: element.childNodes[index], atomic: childAtomic });
    }
  }

  return { nodes, fullText: parts.join("") };
}

interface TextSliceOp {
  node: Text;
  localStart: number;
  localEnd: number;
  idx: number;
  className: string;
}

// Wrap text-node slices in-place without detaching or splitting surrounding
// publisher elements (<a>, <sup>, <em>, interactive widgets, math formulas).
function applyTextSliceWraps(
  indexedNodes: readonly IndexedTextNode[],
  spans: ReadonlyArray<{ idx: number; start: number; end: number; className: string }>,
): void {
  const opsByNode = new Map<Text, TextSliceOp[]>();

  for (const span of spans) {
    for (const entry of indexedNodes) {
      if (entry.end <= span.start) continue;
      if (entry.start >= span.end) break;

      const localStart = Math.max(0, span.start - entry.start);
      const localEnd = Math.min(entry.node.data.length, span.end - entry.start);
      if (localEnd <= localStart) continue;

      let ops = opsByNode.get(entry.node);
      if (!ops) {
        ops = [];
        opsByNode.set(entry.node, ops);
      }
      ops.push({
        node: entry.node,
        localStart,
        localEnd,
        idx: span.idx,
        className: span.className,
      });
    }
  }

  for (const [textNode, ops] of opsByNode) {
    const parent = textNode.parentNode;
    if (!parent) continue;

    ops.sort((a, b) => a.localStart - b.localStart);
    const data = textNode.data;
    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const op of ops) {
      if (op.localStart < cursor) continue;
      if (op.localStart > cursor) {
        fragment.appendChild(document.createTextNode(data.slice(cursor, op.localStart)));
      }
      const wrapper = document.createElement("span");
      wrapper.className = op.className;
      wrapper.setAttribute("data-sentence-idx", String(op.idx));
      wrapper.textContent = data.slice(op.localStart, op.localEnd);
      fragment.appendChild(wrapper);
      cursor = op.localEnd;
    }

    if (cursor < data.length) {
      fragment.appendChild(document.createTextNode(data.slice(cursor)));
    }

    parent.replaceChild(fragment, textNode);
  }
}

// ---------------------------------------------------------------------------
// Fuzzy text matching
// ---------------------------------------------------------------------------

function normalizeWS(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Build mapping from normalized-char-index to original-char-index for a string.
// Handles non-breaking spaces (\u00A0) and other Unicode whitespace that
// normalizeWS collapses into regular ASCII space.
function buildNormMap(str: string): { norm: string; toOrig: number[] } {
  const norm = normalizeWS(str);
  const toOrig: number[] = [];
  let oi = 0;
  for (let ni = 0; ni < norm.length; ni++) {
    const nc = norm[ni];
    while (oi < str.length) {
      const oc = str[oi];
      if (oc === nc || (nc === " " && /\s/.test(oc))) break;
      oi++;
    }
    toOrig[ni] = oi;
    oi++;
  }
  toOrig[norm.length] = oi;
  return { norm, toOrig };
}

const ABBREV_RE = /\b(?:Fig|Figs|Eq|Eqs|Ref|Refs|et al|e\.g|i\.e|vs|Dr|Prof|No|Vol|pp|approx)\./gi;

// Find `needle` within `haystack` starting from `searchFrom`, tolerating whitespace.
// Returns [startIndex, endIndex] in the ORIGINAL haystack, or null.
function findSentenceInText(
  haystack: string,
  needle: string,
  searchFrom: number,
): [number, number] | null {
  const normNeedle = normalizeWS(needle);
  if (!normNeedle) return null;

  const slice = haystack.slice(searchFrom);
  const { norm: normSlice, toOrig } = buildNormMap(slice);

  let normIdx = normSlice.indexOf(normNeedle);
  if (normIdx === -1) {
    normIdx = normSlice.toLowerCase().indexOf(normNeedle.toLowerCase());
  }
  if (normIdx === -1) {
    // Try matching just the first 40 chars (LLM may have slightly truncated the sentence)
    const shortNeedle = normNeedle.slice(0, 40);
    if (shortNeedle.length >= 20) {
      normIdx = normSlice.indexOf(shortNeedle);
      if (normIdx === -1) {
        normIdx = normSlice.toLowerCase().indexOf(shortNeedle.toLowerCase());
      }
      if (normIdx !== -1) {
        // Find where this sentence likely ends: next sentence boundary after the start
        const endSearch = normSlice.slice(normIdx + shortNeedle.length);
        // Protect abbreviations so "Fig." doesn't look like a sentence boundary
        const safeEnd = endSearch.replace(ABBREV_RE, (m) => m.replace(/\./g, "\u0000"));
        const boundaryMatch = safeEnd.match(/[.!?](?:\s|$)/);
        const boundaryOffset = boundaryMatch
          ? normIdx + shortNeedle.length + boundaryMatch.index! + 1
          : Math.min(normIdx + normNeedle.length, normSlice.length);
        const clampedEnd = Math.min(boundaryOffset, normSlice.length);
        return [
          searchFrom + toOrig[normIdx],
          searchFrom + (toOrig[clampedEnd] !== undefined ? toOrig[clampedEnd] : slice.length),
        ];
      }
    }
    return null;
  }

  const endIdx = Math.min(normIdx + normNeedle.length, normSlice.length);
  return [searchFrom + toOrig[normIdx], searchFrom + toOrig[endIdx]];
}

// ---------------------------------------------------------------------------
// Fallback sentence splitter for gap regions
// ---------------------------------------------------------------------------

function splitGapIntoSentences(text: string): string[] {
  if (!text.trim()) return [];
  // Protect abbreviations
  const safe = text.replace(ABBREV_RE, (m) => m.replace(/\./g, "\u0000"));
  const parts = safe.split(/(?<=[.!?])\s+/);
  return parts
    .map((p) => p.replace(/\u0000/g, ".").trim())
    .filter((p) => p.length > 0);
}

// ---------------------------------------------------------------------------
// Wrap original paragraph sentences in-place on safe text nodes
// ---------------------------------------------------------------------------

function wrapOriginalSentences(
  el: HTMLElement,
  alignment: SentenceAlignment[],
): { matchedCount: number; gapIndices: number[] } {
  const { nodes: indexedNodes, fullText } = collectHighlightableTextNodes(el);
  if (!fullText.trim()) return { matchedCount: 0, gapIndices: [] };

  // Phase 1: find positions for all alignment sentences
  const positions: Array<{ idx: number; start: number; end: number }> = [];
  let cursor = 0;

  for (let i = 0; i < alignment.length; i++) {
    const sentence = alignment[i].original;
    if (!sentence?.trim()) continue;

    const found = findSentenceInText(fullText, sentence, cursor);
    if (found) {
      positions.push({ idx: i, start: found[0], end: found[1] });
      cursor = found[1];
    }
  }

  if (positions.length === 0) return { matchedCount: 0, gapIndices: [] };

  // Phase 2: find gap regions (uncovered text between/after matched sentences)
  const gaps: Array<{ start: number; end: number }> = [];

  if (positions[0].start > 0) {
    const gapText = fullText.slice(0, positions[0].start).trim();
    if (gapText.length > 20) {
      gaps.push({ start: 0, end: positions[0].start });
    }
  }
  for (let i = 0; i < positions.length - 1; i++) {
    const gapStart = positions[i].end;
    const gapEnd = positions[i + 1].start;
    if (gapEnd > gapStart) {
      const gapText = fullText.slice(gapStart, gapEnd).trim();
      if (gapText.length > 20) {
        gaps.push({ start: gapStart, end: gapEnd });
      }
    }
  }
  const lastEnd = positions[positions.length - 1].end;
  if (lastEnd < fullText.length) {
    const gapText = fullText.slice(lastEnd).trim();
    if (gapText.length > 20) {
      gaps.push({ start: lastEnd, end: fullText.length });
    }
  }

  // Phase 3: split gaps into sentences and assign indices
  let nextIdx = alignment.length;
  const gapPositions: Array<{ idx: number; start: number; end: number }> = [];
  const gapIndices: number[] = [];

  for (const gap of gaps) {
    const gapText = fullText.slice(gap.start, gap.end);
    const sentences = splitGapIntoSentences(gapText);
    let gapCursor = gap.start;

    for (const sent of sentences) {
      const found = findSentenceInText(fullText, sent, gapCursor);
      if (found) {
        gapPositions.push({ idx: nextIdx, start: found[0], end: found[1] });
        gapIndices.push(nextIdx);
        nextIdx++;
        gapCursor = found[1];
      }
    }
  }

  // Phase 4: wrap text slices in-place without mutating surrounding elements
  const gapSet = new Set(gapIndices);
  const allSpans = [...positions, ...gapPositions]
    .sort((a, b) => a.start - b.start)
    .map((item) => ({
      ...item,
      className: gapSet.has(item.idx) ? `${SENTENCE_CLASS} ${GAP_CLASS}` : SENTENCE_CLASS,
    }));

  applyTextSliceWraps(indexedNodes, allSpans);

  return { matchedCount: positions.length, gapIndices };
}

// ---------------------------------------------------------------------------
// Wrap translation block sentences
// ---------------------------------------------------------------------------

function wrapTranslationSentences(
  el: HTMLElement,
  alignment: SentenceAlignment[],
  fullTranslation: string,
  gapIndices: number[],
): void {
  const fragment = document.createDocumentFragment();
  let hasContent = false;

  for (let i = 0; i < alignment.length; i++) {
    const translated = alignment[i].translated?.trim();
    if (!translated) continue;
    appendSentenceSpan(fragment, translated, i, SENTENCE_CLASS);
    hasContent = true;
  }

  if (gapIndices.length > 0 && fullTranslation) {
    const alignedText = alignment.map((a) => normalizeWS(a.translated ?? "")).join(" ");
    const fullNorm = normalizeWS(fullTranslation);

    let remainingTranslation = "";
    if (fullNorm.length > alignedText.length) {
      const lastAligned = alignment[alignment.length - 1]?.translated?.trim();
      if (lastAligned) {
        const lastIdx = fullTranslation.lastIndexOf(lastAligned);
        if (lastIdx !== -1) {
          remainingTranslation = fullTranslation.slice(lastIdx + lastAligned.length).trim();
        }
      }
    }

    if (remainingTranslation) {
      const remSentences = splitGapIntoSentences(remainingTranslation);
      for (let g = 0; g < gapIndices.length && g < remSentences.length; g++) {
        appendSentenceSpan(fragment, remSentences[g], gapIndices[g], `${SENTENCE_CLASS} ${GAP_CLASS}`);
        hasContent = true;
      }
    }
  }

  if (hasContent) {
    el.replaceChildren(fragment);
  }
}

function appendSentenceSpan(
  fragment: DocumentFragment,
  text: string,
  idx: number,
  className: string,
): void {
  if (fragment.childNodes.length > 0) {
    fragment.append(document.createTextNode(" "));
  }
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("data-sentence-idx", String(idx));
  span.textContent = text;
  fragment.append(span);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function wrapSentences(
  originalEl: HTMLElement,
  translationEl: HTMLElement,
  alignment: SentenceAlignment[],
  fullTranslation?: string,
): void {
  if (!alignment.length) return;

  const pairId =
    originalEl.getAttribute("data-paperlens-id") ??
    `pair-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  originalEl.setAttribute("data-paperlens-pair", pairId);
  translationEl.setAttribute("data-paperlens-pair", pairId);

  const { matchedCount, gapIndices } = wrapOriginalSentences(originalEl, alignment);
  if (matchedCount > 0) {
    wrapTranslationSentences(
      translationEl,
      alignment,
      fullTranslation ?? translationEl.textContent ?? "",
      gapIndices,
    );
  }
}

// ---------------------------------------------------------------------------
// Document-level cross-highlight delegation (installed once)
// ---------------------------------------------------------------------------

let delegationInstalled = false;

export function enableCrossHighlight(): void {
  if (delegationInstalled) return;
  delegationInstalled = true;

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}

function getSentenceSpan(e: Event): HTMLElement | null {
  const el = e.target as HTMLElement;
  if (!el?.closest) return null;
  return el.closest(`.${SENTENCE_CLASS}`) as HTMLElement | null;
}

let activePairId: string | null = null;
let activeIdx: string | null = null;
let pinnedPairId: string | null = null;
let pinnedIdx: string | null = null;

function querySentencePair(pairId: string, idx: string): NodeListOf<Element> {
  return document.querySelectorAll(
    `[data-paperlens-pair="${CSS.escape(pairId)}"] [data-sentence-idx="${CSS.escape(idx)}"]`,
  );
}

function onMouseOver(e: Event): void {
  const span = getSentenceSpan(e);
  if (!span) return;

  const idx = span.getAttribute("data-sentence-idx");
  if (idx === null) return;

  const pairEl = span.closest("[data-paperlens-pair]");
  if (!pairEl) return;
  const pairId = pairEl.getAttribute("data-paperlens-pair")!;

  if (activePairId === pairId && activeIdx === idx) return;

  if (activePairId !== null) {
    clearActive();
  }

  activePairId = pairId;
  activeIdx = idx;

  querySentencePair(pairId, idx).forEach((el) => el.classList.add(HIGHLIGHT_CLASS));
}

function onMouseOut(e: Event): void {
  const span = getSentenceSpan(e);
  if (!span) return;

  const me = e as MouseEvent;
  const related = me.relatedTarget as Node | null;
  if (related && span.contains(related)) return;

  if (related) {
    const relatedSpan = (related as HTMLElement).closest?.(`.${SENTENCE_CLASS}`);
    if (relatedSpan) {
      const relIdx = relatedSpan.getAttribute("data-sentence-idx");
      const relPair = relatedSpan.closest("[data-paperlens-pair]")?.getAttribute("data-paperlens-pair");
      if (relIdx === activeIdx && relPair === activePairId) return;
    }
  }

  clearActive();
}

function onDocumentClick(e: Event): void {
  const target = e.target as HTMLElement | null;
  if (!target?.closest) return;

  // Never intercept interactive publisher controls like citation links or buttons.
  if (target.closest("a, button, input, select, textarea")) return;

  // Keep current pin intact while the user clicks a text selection rather than toggling.
  const selectionText = typeof window !== "undefined" ? window.getSelection?.()?.toString()?.trim() : "";
  if (selectionText) return;

  const span = getSentenceSpan(e);
  if (!span) {
    clearPinned();
    return;
  }

  const idx = span.getAttribute("data-sentence-idx");
  const pairId = span.closest("[data-paperlens-pair]")?.getAttribute("data-paperlens-pair");
  if (idx === null || !pairId) return;

  if (pinnedPairId === pairId && pinnedIdx === idx) {
    clearPinned();
    return;
  }

  clearPinned();
  pinnedPairId = pairId;
  pinnedIdx = idx;
  querySentencePair(pairId, idx).forEach((el) => el.classList.add(PINNED_CLASS));
}

function onKeyDown(e: Event): void {
  const ke = e as KeyboardEvent;
  if (ke.key === "Escape" && pinnedPairId !== null) {
    clearPinned();
  }
}

function clearActive(): void {
  if (activePairId === null || activeIdx === null) return;

  querySentencePair(activePairId, activeIdx).forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));

  activePairId = null;
  activeIdx = null;
}

function clearPinned(): void {
  if (pinnedPairId === null || pinnedIdx === null) return;

  querySentencePair(pinnedPairId, pinnedIdx).forEach((el) => el.classList.remove(PINNED_CLASS));

  pinnedPairId = null;
  pinnedIdx = null;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function clearAllHighlights(): void {
  clearHighlightsWithin(document);
}

function elementsWithin(root: ParentNode, selector: string): Element[] {
  const elements = Array.from(root.querySelectorAll(selector));
  if (root instanceof Element && root.matches(selector)) {
    elements.unshift(root);
  }
  return elements;
}

function clearHighlightsWithin(root: ParentNode): void {
  clearActive();
  clearPinned();
  elementsWithin(root, `.${HIGHLIGHT_CLASS}, .${PINNED_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS, PINNED_CLASS);
  });
}

export function unwrapSentenceSpansWithin(root: ParentNode): void {
  clearHighlightsWithin(root);
  elementsWithin(root, `.${SENTENCE_CLASS}`).forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  });
  elementsWithin(root, "[data-paperlens-pair]").forEach((el) => {
    el.removeAttribute("data-paperlens-pair");
  });
}

export function unwrapSentenceSpans(): void {
  unwrapSentenceSpansWithin(document);
}
