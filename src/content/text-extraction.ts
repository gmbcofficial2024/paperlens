export function extractParagraphText(el: HTMLElement): string {
  if (el.tagName === "TABLE") return extractTableText(el);
  return visibleText(el).trim();
}

// Unconditional UI exclusions are shared by collection and serialization.
// Header/footer landmarks need article ownership and are classified separately.
export const SOURCE_UI_SELECTOR = [
  "nav", "form", "button", "dialog", "[role='navigation']", "[role='dialog']", "[role='button']",
  ".site-header", ".site-footer", "#site-header", "#site-footer",
  ".paperlens-translation", ".paperlens-summary", "[data-paperlens-ui]",
  ".sidebar", ".comments", ".cookie", ".modal", ".popup", ".tooltip",
  ".advertisement", ".ad-container", ".related-content", ".related-articles",
  ".recommended-articles", ".RelatedArticles", ".collateral", ".embedded-form",
  ".author-info", ".author-group", ".AuthorGroups", ".contrib-group", ".affiliations",
  ".c-article-identifiers", "[data-test='article-identifier']",
  ".c-article-author-list-container", ".c-article-author-list", "[data-test='authors-list']",
  ".c-article-authors-listing", "[data-test='author-info']",
  ".byline", ".article-meta", ".metrics", ".article-metrics", ".keywords", ".copyright", ".license",
  ".fig-modal", "figshare-widget", "[class*='figshare']", ".sticky-table-of-contents",
  "#reading-assistant-container", "#issue-navigation",
].join(",");
const NON_SOURCE_TEXT_SELECTOR = `script, style, template, noscript, ${SOURCE_UI_SELECTOR}`;

export function isMagazineArticleHeader(element: Element): boolean {
  return element.matches("header") && [...element.querySelectorAll("h1.c-article-magazine-title")]
    .some((title) => title.closest("header") === element);
}

export function isSourceHidden(element: Element, cache = new WeakMap<Element, boolean>()): boolean {
  const chain: Element[] = [];
  let result = false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const cached = cache.get(current);
    if (cached !== undefined) { result = cached; break; }
    chain.push(current);
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true" ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(current.getAttribute("style") ?? "")) { result = true; break; }
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      try {
        const style = window.getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") { result = true; break; }
      } catch {
        // Detached/test DOMs may not expose a layout engine.
      }
    }
  }
  for (const current of chain) cache.set(current, result);
  return result;
}

function excludedText(element: Element): boolean {
  if (isSourceHidden(element)) return true;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.matches(NON_SOURCE_TEXT_SELECTOR) || isMagazineArticleHeader(current)) return true;
  }
  return false;
}

function visibleText(element: Element): string {
  if (excludedText(element)) return "";
  const stack: Node[] = [...element.childNodes].reverse();
  const parts: string[] = [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === 3) { parts.push(node.textContent ?? ""); continue; }
    if (node.nodeType !== 1 || excludedText(node as Element)) continue;
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index]);
  }
  return parts.join("");
}

function extractTableText(table: HTMLElement): string {
  const text = (element: Element) => visibleText(element).replace(/\s+/g, " ").trim();
  const rows = Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table);
  const lines: string[] = [];
  const caption = table.querySelector("caption");
  if (caption && text(caption)) lines.push(text(caption));
  const grid: Element[][] = rows.map(() => []);
  const isHeader = rows.map((row) => {
    const cells = Array.from(row.children).filter((cell) => cell.matches("th,td"));
    return row.closest("thead") !== null || (cells.length > 0 && cells.every((cell) => cell.tagName === "TH" && cell.getAttribute("scope") !== "row"));
  });
  const span = (cell: Element, name: string, fallback: number) => {
    const value = Number(cell.getAttribute(name) ?? 1);
    return value === 0 ? fallback : Math.max(1, Math.min(128, Math.floor(value) || 1));
  };
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of Array.from(row.children).filter((element) => element.matches("th,td"))) {
      while (grid[rowIndex][column]) column += 1;
      const height = Math.min(span(cell, "rowspan", rows.length - rowIndex), rows.length - rowIndex);
      const width = span(cell, "colspan", 1);
      for (let y = rowIndex; y < rowIndex + height; y += 1) {
        for (let x = column; x < column + width; x += 1) grid[y][x] = cell;
      }
      column += width;
    }
  });
  const columnCount = Math.max(0, ...grid.map((row) => row.length));
  const headers = Array.from({ length: columnCount }, (_, column) => {
    const headerCells = new Set<Element>();
    rows.forEach((element, row) => { if (isHeader[row] && !excludedText(element) && grid[row][column]) headerCells.add(grid[row][column]); });
    return [...headerCells].map(text).filter(Boolean).join(" / ");
  });
  if (headers.some(Boolean)) lines.push(headers.join(" | "));
  rows.forEach((row, rowIndex) => {
    if (isHeader[rowIndex] || excludedText(row)) return;
    const cells = new Map<Element, number[]>();
    grid[rowIndex].forEach((cell, column) => cells.set(cell, [...(cells.get(cell) ?? []), column]));
    const values = [...cells].map(([cell, columns]) => {
      const value = text(cell);
      const label = [...new Set(columns.map((column) => headers[column]).filter(Boolean))].join(" + ");
      return cell.tagName === "TH" || !label || row.closest("tfoot") ? value : `${label}: ${value}`;
    });
    if (values.some(Boolean)) lines.push(values.join(" | "));
  });
  return lines.join("\n");
}
