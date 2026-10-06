const BLOCK_CLASS = "paperlens-translation";
const SKELETON_CLASS = "paperlens-skeleton";
const ERROR_CLASS = "paperlens-error";

export function createTranslationBlock(paragraphEl: HTMLElement, paragraphId: string): HTMLElement {
  const block = document.createElement("div");
  block.className = `${BLOCK_CLASS} ${SKELETON_CLASS}`;
  block.setAttribute("data-paperlens-block", paragraphId);
  block.textContent = "Translating...";
  paragraphEl.after(block);
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
  });
}
