import type { SentenceAlignment } from "../shared/types";

const SENTENCE_CLASS = "paperlens-sentence";
const HIGHLIGHT_CLASS = "paperlens-highlight";
const GAP_CLASS = "paperlens-sentence-gap"; // unmatched text, no cross-highlight

// ---------------------------------------------------------------------------
// TreeWalker-based text position mapping
// ---------------------------------------------------------------------------

function getTextNodes(el: Node): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  return nodes;
}

// Build a Range covering textContent[start..end) across arbitrary inline elements.
function createRangeForSlice(el: HTMLElement, start: number, end: number): Range | null {
  const textNodes = getTextNodes(el);
  const range = document.createRange();
  let offset = 0;
  let startSet = false;
  let totalLen = 0;
  for (const node of textNodes) totalLen += node.length;
  const clampedEnd = Math.min(end, totalLen);

  for (const node of textNodes) {
    const len = node.length;
    if (!startSet && offset + len > start) {
      range.setStart(node, start - offset);
      startSet = true;
    }
    if (startSet && offset + len >= clampedEnd) {
      range.setEnd(node, clampedEnd - offset);
      return range;
    }
    offset += len;
  }
  // If start was set but end exceeds all text, clamp to last node
  if (startSet && textNodes.length > 0) {
    const lastNode = textNodes[textNodes.length - 1];
    range.setEnd(lastNode, lastNode.length);
    return range;
  }
  return null;
}

function wrapRangeWithSpan(range: Range, idx: number, className: string = SENTENCE_CLASS): void {
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("data-sentence-idx", String(idx));
  try {
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  } catch {
    // skip if wrapping fails
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
// Wrap original paragraph sentences using Range API
// ---------------------------------------------------------------------------

function wrapOriginalSentences(
  el: HTMLElement,
  alignment: SentenceAlignment[],
): { matchedCount: number; gapIndices: number[] } {
  const fullText = el.textContent ?? "";
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

  // Gap before first match
  if (positions[0].start > 0) {
    const gapText = fullText.slice(0, positions[0].start).trim();
    if (gapText.length > 20) {
      gaps.push({ start: 0, end: positions[0].start });
    }
  }
  // Gaps between matches
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
  // Gap after last match
  const lastEnd = positions[positions.length - 1].end;
  if (lastEnd < fullText.length) {
    const gapText = fullText.slice(lastEnd).trim();
    if (gapText.length > 20) {
      gaps.push({ start: lastEnd, end: fullText.length });
    }
  }

  // Phase 3: split gaps into sentences and assign indices
  let nextIdx = alignment.length; // gap sentences get indices after alignment
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

  // Phase 4: merge and wrap everything in reverse order
  const allPositions = [...positions, ...gapPositions].sort((a, b) => a.start - b.start);
  const textLen = fullText.length;

  for (let p = allPositions.length - 1; p >= 0; p--) {
    const { idx, start, end } = allPositions[p];
    const range = createRangeForSlice(el, start, Math.min(end, textLen));
    if (range) {
      const isGap = gapIndices.includes(idx);
      wrapRangeWithSpan(range, idx, isGap ? `${SENTENCE_CLASS} ${GAP_CLASS}` : SENTENCE_CLASS);
    }
  }

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

  // If there are gap sentences in the original, try to extract remaining translation text.
  // The full translation may contain text beyond what alignment covers.
  if (gapIndices.length > 0 && fullTranslation) {
    // Compute what alignment already covers
    const alignedText = alignment.map((a) => normalizeWS(a.translated ?? "")).join(" ");
    const fullNorm = normalizeWS(fullTranslation);

    // Find unmatched tail in translation
    let remainingTranslation = "";
    if (fullNorm.length > alignedText.length) {
      // Try to find where aligned text ends in full translation
      const lastAligned = alignment[alignment.length - 1]?.translated?.trim();
      if (lastAligned) {
        const lastIdx = fullTranslation.lastIndexOf(lastAligned);
        if (lastIdx !== -1) {
          remainingTranslation = fullTranslation.slice(lastIdx + lastAligned.length).trim();
        }
      }
    }

    if (remainingTranslation) {
      // Split remaining into sentences and assign to gap indices
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

  // Pair ID for scope lookup
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
}

// Use .closest() instead of a fixed-depth walk — handles any nesting depth
function getSentenceSpan(e: Event): HTMLElement | null {
  const el = e.target as HTMLElement;
  if (!el?.closest) return null;
  return el.closest(`.${SENTENCE_CLASS}`) as HTMLElement | null;
}

// Track currently highlighted pair+idx to avoid redundant DOM queries
let activePairId: string | null = null;
let activeIdx: string | null = null;

function onMouseOver(e: Event): void {
  const span = getSentenceSpan(e);
  if (!span) return;

  const idx = span.getAttribute("data-sentence-idx");
  if (idx === null) return;

  const pairEl = span.closest("[data-paperlens-pair]");
  if (!pairEl) return;
  const pairId = pairEl.getAttribute("data-paperlens-pair")!;

  // Already highlighting this exact pair — skip redundant query
  if (activePairId === pairId && activeIdx === idx) return;

  // Clear previous highlight if switching to different sentence
  if (activePairId !== null) {
    clearActive();
  }

  activePairId = pairId;
  activeIdx = idx;

  const matched = document.querySelectorAll(
    `[data-paperlens-pair="${CSS.escape(pairId)}"] [data-sentence-idx="${CSS.escape(idx)}"]`,
  );
  matched.forEach((el) => el.classList.add(HIGHLIGHT_CLASS));
}

function onMouseOut(e: Event): void {
  const span = getSentenceSpan(e);
  if (!span) return;

  // Check relatedTarget: if we're moving to another element within the same
  // sentence span, don't remove the highlight (prevents flicker with nested
  // inline elements like <sup>, <a>, <i>, <sub>).
  const me = e as MouseEvent;
  const related = me.relatedTarget as Node | null;
  if (related && span.contains(related)) return;

  // Also check if relatedTarget is in the paired sentence span (same idx, same pair)
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

function clearActive(): void {
  if (activePairId === null || activeIdx === null) return;

  const matched = document.querySelectorAll(
    `[data-paperlens-pair="${CSS.escape(activePairId)}"] [data-sentence-idx="${CSS.escape(activeIdx)}"]`,
  );
  matched.forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));

  activePairId = null;
  activeIdx = null;
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
  elementsWithin(root, `.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS);
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
