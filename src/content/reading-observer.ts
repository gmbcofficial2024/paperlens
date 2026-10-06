const OWN_UI = ".paperlens-translation, #paperlens-paper-summary, #paperlens-token-widget";

function insideOwnUi(node: Node): boolean {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return Boolean(element?.closest(OWN_UI));
}

export function observeReadingChanges(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined" || !document.body) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let maximumWait: ReturnType<typeof setTimeout> | undefined;
  const reconcile = (): void => {
    if (timer) clearTimeout(timer);
    if (maximumWait) clearTimeout(maximumWait);
    timer = maximumWait = undefined;
    onChange();
  };
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      if (insideOwnUi(record.target)) return false;
      if (record.type === "attributes") {
        return !record.attributeName?.startsWith("data-paperlens") &&
          !(record.target as Element).classList?.contains("paperlens-sentence");
      }
      if (record.type === "childList") {
        const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
        if (changed.length && changed.every(node => insideOwnUi(node) ||
          (node.nodeType === 1 && (node as Element).classList.contains("paperlens-sentence")))) return false;
      }
      return true;
    });
    if (!relevant) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(reconcile, 200);
    if (!maximumWait) maximumWait = setTimeout(reconcile, 500);
  });
  observer.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "id", "style", "hidden", "aria-hidden", "open"]});
  return () => {observer.disconnect(); if (timer) clearTimeout(timer); if (maximumWait) clearTimeout(maximumWait);};
}
