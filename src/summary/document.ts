export const SUMMARY_DOCUMENT_END_MARKER = "[PaperLens full document ends here]";

export interface SummaryDocumentSection {
  heading: string | null;
  paragraphs: readonly string[];
}

export function collectBrowserPlainTextSummarySection(
  sourceDocument: Document,
): SummaryDocumentSection | null {
  const body = sourceDocument.body;
  if (!body) return null;

  const children = Array.from(body.children).filter(element =>
    !element.matches(".paperlens-summary, .paperlens-translation, #paperlens-token-widget"));
  const solePre =
    children.length === 1 && children[0]?.tagName.toLowerCase() === "pre"
      ? children[0]
      : null;
  const isPlainTextMime =
    sourceDocument.contentType?.split(";", 1)[0]?.trim().toLowerCase() ===
    "text/plain";

  if (!isPlainTextMime && !solePre) return null;

  const text = (solePre ?? body).textContent ?? "";
  if (!text.trim()) return null;
  return {
    heading: null,
    paragraphs: [text],
  };
}

export function serializeSummaryDocument(
  sections: readonly SummaryDocumentSection[],
): string {
  const blocks: string[] = [];

  for (const section of sections) {
    // Extraction deduplicates original node identities. Equal text can be a
    // distinct observation in another section and must remain in the source.
    const uniqueParagraphs = section.paragraphs.filter(paragraph => paragraph.trim());

    if (uniqueParagraphs.length > 0) {
      const lines =
        section.heading === null
          ? uniqueParagraphs
          : [`## ${section.heading}`, ...uniqueParagraphs];
      blocks.push(lines.join("\n\n"));
    }
  }

  if (blocks.length === 0) return "";
  return [...blocks, SUMMARY_DOCUMENT_END_MARKER].join("\n\n");
}
