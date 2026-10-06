interface SummarySection {
  heading: string | null;
  lines: string[];
}

const KNOWN_HEADING = /^(핵심\s*(요약|내용|포인트|주장)|연구\s*(문제|목적)|방법|핵심\s*근거와\s*결과|주요\s*(근거|결과|내용)|해석(?:\s*또는\s*메커니즘)?|메커니즘|한계|학술적[·ㆍ\s]*실용적\s*의의|의의|배경(?:과\s*맥락)?|맥락|근거와\s*주장|주장과\s*근거|주요\s*근거와\s*주장|출처와\s*관점|불확실성과\s*주의점|의미와\s*영향|주의점(?:과\s*한계)?|조건과\s*한계|시사점|summary|key\s*(takeaways|points)|research\s*(problem|question)|methods?|evidence(?:\s*and\s*(results|claims))?|results?|interpretation(?:\s*or\s*mechanism)?|limitations?|significance|context|qualifications?|implications?)$/i;
const TAKEAWAY_HEADING = /^(핵심\s*(요약|내용|포인트|주장)|summary|key\s*(takeaways|points))$/i;
const LATER_HEADING = /해석|메커니즘|한계|의의|주의점|조건과|시사점|출처와\s*관점|의미와\s*영향|interpretation|mechanism|limitation|significance|qualification|implication/i;

function sectionHeading(line: string): string | null {
  const trimmed = line.trim();
  const markdown = /^#{1,6}\s+(.+?)\s*#*$/.exec(trimmed);
  const numbered = /^\d{1,2}[.)]\s+(.+)$/.exec(trimmed);
  const candidate = (markdown?.[1] ?? numbered?.[1] ?? trimmed)
    .replace(/^\d{1,2}[.)]\s+/, "")
    .replace(/^(?:\*\*|__)(.+)(?:\*\*|__)$/, "$1")
    .replace(/[：:]$/, "")
    .trim();
  return markdown || KNOWN_HEADING.test(candidate) ? candidate : null;
}

function safeLink(href: string): string | null {
  if (!/^https?:\/\//i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return null;
  try {
    const url = new URL(href);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Model output is data: only these DOM nodes are created, never model HTML. */
function appendInline(parent: Node, text: string, doc: Document): void {
  const tokens = /`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|!?\[[^\]\n]*\]\([^\n)]*\)/g;
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index!;
    parent.appendChild(doc.createTextNode(text.slice(cursor, index)));
    const token = match[0];
    if (token.startsWith("[")) {
      const link = /^\[([^\]]*)\]\((.*)\)$/.exec(token)!;
      const href = safeLink(link[2]);
      if (href) {
        const anchor = doc.createElement("a");
        anchor.href = href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = link[1];
        parent.appendChild(anchor);
      } else {
        parent.appendChild(doc.createTextNode(link[1]));
      }
    } else if (token.startsWith("![")) {
      parent.appendChild(doc.createTextNode(token.slice(2, token.indexOf("]"))));
    } else {
      const double = token.startsWith("**") || token.startsWith("__");
      const node = doc.createElement(token.startsWith("`") ? "code" : double ? "strong" : "em");
      node.textContent = token.slice(double ? 2 : 1, double ? -2 : -1);
      parent.appendChild(node);
    }
    cursor = index + token.length;
  }
  parent.appendChild(doc.createTextNode(text.slice(cursor)));
}

function appendBlocks(parent: HTMLElement | DocumentFragment, lines: string[], doc: Document): void {
  let index = 0;
  const listItem = (line: string) => /^\s*(?:([-+*])\s+|(\d+)[.)]\s+)(.+)$/.exec(line);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (/^\s*```/.test(line)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      parent.appendChild(pre);
      continue;
    }
    const item = listItem(line);
    if (item) {
      const ordered = Boolean(item[2]);
      const list = doc.createElement(ordered ? "ol" : "ul");
      if (ordered && item[2] !== "1") list.setAttribute("start", item[2]);
      while (index < lines.length) {
        if (!lines[index].trim() && listItem(lines[index + 1] ?? "")) { index += 1; continue; }
        const current = listItem(lines[index]);
        if (!current || Boolean(current[2]) !== ordered) break;
        const li = doc.createElement("li");
        appendInline(li, current[3], doc);
        list.appendChild(li);
        index += 1;
      }
      parent.appendChild(list);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = doc.createElement("blockquote");
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quoteLines.push(lines[index++].replace(/^\s*>\s?/, ""));
      appendInline(quote, quoteLines.join(" "), doc);
      parent.appendChild(quote);
      continue;
    }
    const paragraph = doc.createElement("p");
    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !listItem(lines[index]) && !/^\s*(>|```)/.test(lines[index])) paragraphLines.push(lines[index++].trim());
    appendInline(paragraph, paragraphLines.join(" "), doc);
    parent.appendChild(paragraph);
  }
}

export function renderSafeSummary(summary: string, doc: Document = document, kind: "paper" | "article" = "paper"): DocumentFragment {
  const sections: SummarySection[] = [];
  let section: SummarySection = { heading: null, lines: [] };
  let inFence = false;
  for (const line of summary.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : sectionHeading(line);
    if (heading) {
      if (section.heading || section.lines.some((value) => value.trim())) sections.push(section);
      section = { heading, lines: [] };
    } else {
      section.lines.push(line);
    }
  }
  if (section.heading || section.lines.some((value) => value.trim())) sections.push(section);

  const fragment = doc.createDocumentFragment();
  let more: HTMLDetailsElement | null = null;
  for (const item of sections) {
    if (!item.heading) { appendBlocks(fragment, item.lines, doc); continue; }
    const sectionElement = doc.createElement("section");
    sectionElement.className = TAKEAWAY_HEADING.test(item.heading)
      ? "paperlens-summary-section paperlens-summary-takeaway"
      : "paperlens-summary-section";
    const heading = doc.createElement("h3");
    heading.textContent = item.heading;
    sectionElement.appendChild(heading);
    appendBlocks(sectionElement, item.lines, doc);
    if (LATER_HEADING.test(item.heading)) {
      if (!more) {
        more = doc.createElement("details");
        more.className = "paperlens-summary-more";
        const label = doc.createElement("summary");
        label.textContent = kind === "article" ? "관점 · 주의점 · 영향 읽기" : "해석 · 한계 · 의의 읽기";
        more.appendChild(label);
        fragment.appendChild(more);
      }
      more.appendChild(sectionElement);
    } else {
      fragment.appendChild(sectionElement);
      // Only adjacent later sections share a disclosure; preserve model order.
      more = null;
    }
  }
  return fragment;
}
