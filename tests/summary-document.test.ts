import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  collectBrowserPlainTextSummarySection,
  SUMMARY_DOCUMENT_END_MARKER,
  serializeSummaryDocument,
} from "../src/summary/document";

test("serializes ordered sections without losing repeated source observations", () => {
  const serialized = serializeSummaryDocument([
    {
      heading: "Abstract",
      paragraphs: [
        "The device retained its polarization after cycling.",
        "Shared observation.",
      ],
    },
    {
      heading: "Methods",
      paragraphs: [
        "Shared observation.",
        "Shared observation. ",
        "The samples were annealed at 400 C.",
      ],
    },
  ]);

  assert.equal(
    serialized,
    [
      "## Abstract",
      "",
      "The device retained its polarization after cycling.",
      "",
      "Shared observation.",
      "",
      "## Methods",
      "",
      "Shared observation.",
      "",
      "Shared observation. ",
      "",
      "The samples were annealed at 400 C.",
      "",
      SUMMARY_DOCUMENT_END_MARKER,
    ].join("\n"),
  );
});

test("preserves the document end marker after more than 80,000 characters", () => {
  const serialized = serializeSummaryDocument([
    {
      heading: "Results",
      paragraphs: ["R".repeat(80_001)],
    },
  ]);

  assert.equal(serialized.endsWith(SUMMARY_DOCUMENT_END_MARKER), true);
  assert.equal(serialized.includes("R".repeat(80_001)), true);
});

test("empty sections serialize to empty text instead of a marker-only request", () => {
  assert.equal(serializeSummaryDocument([]), "");
  assert.equal(
    serializeSummaryDocument([{ heading: "Empty", paragraphs: [] }]),
    "",
  );
});

test("collects the complete browser-rendered text/plain body from its sole pre element", () => {
  const fullText = `Plain paper start\n${"P".repeat(80_001)}\nPLAIN_TEXT_END`;
  const { document } = parseHTML(
    `<html><body><pre>${fullText}</pre></body></html>`,
  );
  Object.defineProperty(document, "contentType", {
    value: "text/plain",
    configurable: true,
  });

  const section = collectBrowserPlainTextSummarySection(
    document as unknown as Document,
  );

  assert.deepEqual(section, {
    heading: null,
    paragraphs: [fullText],
  });
  const serialized = serializeSummaryDocument(section ? [section] : []);
  assert.equal(serialized.includes("P".repeat(80_001)), true);
  assert.equal(serialized.includes("PLAIN_TEXT_END"), true);
});

test("does not treat an arbitrary pre inside an HTML page as a plain-text paper", () => {
  const { document } = parseHTML(
    "<html><body><article><pre>code sample only</pre></article></body></html>",
  );

  assert.equal(
    collectBrowserPlainTextSummarySection(document as unknown as Document),
    null,
  );
});

test("a repeated plain-text summary excludes previously inserted reading UI", () => {
  const {document} = parseHTML('<html><body><section class="paperlens-summary">Old summary</section><pre>Entire original paper.</pre><div id="paperlens-token-widget">Usage</div></body></html>');
  Object.defineProperty(document, "contentType", {value: "text/plain"});
  assert.deepEqual(collectBrowserPlainTextSummarySection(document as unknown as Document), {heading: null, paragraphs: ["Entire original paper."]});
});
