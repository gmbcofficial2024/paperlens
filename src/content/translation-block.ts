import { isHorizontalFlex, isMultiTrackGrid } from "./translation-targets";

const BLOCK_CLASS = "paperlens-translation";
const CONTAINED_CLASS = "paperlens-translation--contained";
const SKELETON_CLASS = "paperlens-skeleton";
const ERROR_CLASS = "paperlens-error";
const HIDDEN_CLASS = "paperlens-hidden";

// Elements whose HTML parent (ul, ol, dl, table, tr) forbids a sibling <div>.
const CONTAINED_ANCHOR_TAGS = new Set(["LI", "DD", "CAPTION", "TD", "TH"]);

function shouldContainBlock(anchor: HTMLElement): boolean {
  if (CONTAINED_ANCHOR_TAGS.has(anchor.tagName)) return true;

  const parent = anchor.parentElement;
  if (!parent || typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return false;
  }

  try {
    const parentStyle = window.getComputedStyle(parent);
    if (
      isHorizontalFlex(parentStyle) ||
      isMultiTrackGrid(parentStyle) ||
      parentStyle.display === "table-row"
    ) {
      return true;
    }
  } catch {
    // Detached/test DOMs may not expose a layout engine.
  }
  return false;
}

export function createTranslationBlock(paragraphEl: HTMLElement, paragraphId: string): HTMLElement {
  const contained = shouldContainBlock(paragraphEl);
  // Use a block-styled <span> when contained inside <p> to keep phrasing-content
  // HTML valid; use <div> everywhere else.
  const tagName = contained && paragraphEl.tagName === "P" ? "span" : "div";
  const block = document.createElement(tagName);
  block.className = contained
    ? `${BLOCK_CLASS} ${CONTAINED_CLASS} ${SKELETON_CLASS}`
    : `${BLOCK_CLASS} ${SKELETON_CLASS}`;
  block.setAttribute("data-paperlens-block", paragraphId);
  block.setAttribute("data-paperlens-ui", "translation");
  block.textContent = "Translating...";

  if (contained) {
    paragraphEl.appendChild(block);
  } else {
    paragraphEl.after(block);
  }
  return block;
}

export function finalizeBlock(block: HTMLElement, translation: string | Node): void {
  block.classList.remove(SKELETON_CLASS);
  if (typeof translation === "string") {
    block.textContent = translation;
  } else {
    block.replaceChildren(translation);
  }
}

export function setBlockError(block: HTMLElement, error: string, onRetry?: () => void): void {
  block.classList.remove(SKELETON_CLASS);
  block.classList.add(ERROR_CLASS);
  block.textContent = "";

  const errorSpan = document.createElement("span");
  errorSpan.textContent = `[Error: ${error}]`;
  block.appendChild(errorSpan);

  if (onRetry) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.textContent = "Retry";
    retryBtn.className = "paperlens-retry-btn";
    retryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      block.classList.remove(ERROR_CLASS);
      block.classList.add(SKELETON_CLASS);
      block.textContent = "Translating...";
      onRetry();
    });
    block.appendChild(retryBtn);
  }
}

export function findBlock(paragraphId: string): HTMLElement | null {
  return document.querySelector(`[data-paperlens-block="${paragraphId}"]`);
}

export function removeAllBlocks(): void {
  document.querySelectorAll(`.${BLOCK_CLASS}`).forEach((el) => el.remove());
}

export function toggleBlocksVisibility(visible: boolean): void {
  document.querySelectorAll<HTMLElement>(`.${BLOCK_CLASS}`).forEach((el) => {
    el.style.display = visible ? "" : "none";
    el.classList.toggle(HIDDEN_CLASS, !visible);
  });
}
