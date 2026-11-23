import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  unwrapSentenceSpansWithin,
  wrapSentences,
} from "../src/content/highlight";
import { collectReadingDocument } from "../src/content/reading-document";
import { createSummaryBlock, removeSummaryBlock } from "../src/content/summary-block";
import { extractParagraphText } from "../src/content/text-extraction";
import {
  createTranslationBlock,
  toggleBlocksVisibility,
} from "../src/content/translation-block";
import {
  collectTranslatableSections,
  isTranslatableProseText,
} from "../src/content/translation-targets";
import { PROFILE_CASES } from "./fixtures/academic/cases";

function withDom(
  html: string,
  hostname: string,
  run: () => void,
  computedStyle?: (element: Element) => Partial<CSSStyleDeclaration>,
): void {
  const parsed = parseHTML(
    html.includes("<html")
      ? html
      : `<!doctype html><html><head><title>PaperLens UX test</title></head><body>${html}</body></html>`,
  );
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    CSS: globalThis.CSS,
  };
  const mockWindow: Record<string, unknown> = {
    location: { hostname },
  };
  if (computedStyle) {
    mockWindow.getComputedStyle = (element: Element) => ({
      display: "block",
      visibility: "visible",
      flexDirection: "row",
      gridTemplateColumns: "none",
      gridAutoFlow: "row",
      position: "static",
      overflow: "visible",
      width: "600px",
      height: "24px",
      clip: "auto",
      clipPath: "none",
      ...computedStyle(element),
    });
  }
  Object.defineProperty(globalThis, "document", { value: parsed.document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: mockWindow, configurable: true });
  Object.defineProperty(globalThis, "Node", { value: parsed.window.Node, configurable: true });
  Object.defineProperty(globalThis, "Element", { value: parsed.window.Element, configurable: true });
  Object.defineProperty(globalThis, "HTMLElement", { value: parsed.window.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, "CSS", {
    value: { escape: (value: string) => value.replaceAll('"', '\\"') },
    configurable: true,
  });
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      Object.defineProperty(globalThis, key, { value, configurable: true });
    }
  }
}

for (const profileCase of PROFILE_CASES) {
  test(`${profileCase.name} profile leaks zero forbidden elements in reading document and inline translation`, () => {
    const html = readFileSync(
      resolve("tests/fixtures/academic/profiles", profileCase.file),
      "utf8",
    );
    withDom(html, profileCase.host, () => {
      const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
      const readingIds = reading.sections.flatMap((section) =>
        section.paragraphs.map((node) => node.id),
      );
      const translateSections = collectTranslatableSections({ includeTranslatedParagraphs: true });
      const translateIds = translateSections.flatMap((section) =>
        section.paragraphs.map((node) => node.id),
      );

      for (const forbidden of profileCase.forbiddenIds) {
        assert.equal(
          readingIds.includes(forbidden),
          false,
          `${profileCase.name} reading document leaked forbidden id: ${forbidden}`,
        );
        assert.equal(
          translateIds.includes(forbidden),
          false,
          `${profileCase.name} inline translation leaked forbidden id: ${forbidden}`,
        );
      }

      if (profileCase.name === "Nature") {
        assert.deepEqual(translateIds, ["n-abstract", "n-figcap", "n-body", "n-tablecap"]);
      }
      if (profileCase.name === "RSC") {
        assert.deepEqual(translateIds, ["rsc-abstract", "rsc-body1", "rsc-caption", "rsc-body2"]);
      }
    });
  });
}

test("inline translation filters paper metadata, UI controls, bare labels, units, and Korean text while keeping short scientific prose", () => {
  const skipped = [
    "Open Access",
    "Research Article",
    "Brief Communication",
    "Published: 02 October 2026",
    "Received: 10 January 2026",
    "First published on 18th March 2026",
    "DOI: 10.1038/s41586-020-2649-2",
    "https://doi.org/10.1038/s41586-020-2649-2",
    "Volume 612, pages 1-10 (2026)",
    "12k Accesses",
    "45 Citations",
    "128 Altmetric",
    "Download PDF",
    "Full size image",
    "Open in viewer",
    "Cite this article",
    "Reprints and permissions",
    "All rights reserved.",
    "© 2026 Springer Nature Limited.",
    "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License.",
    "Springer Nature remains neutral with regard to jurisdictional claims in published maps.",
    "Fig. 1",
    "Extended Data Fig. 2a",
    "Table 1",
    "Supplementary Table S2",
    "Eq. (1)",
    "120 mA",
    "0.2 V",
    "p < 0.001",
    "n = 24",
    "(1)",
    "이미 한국어로 작성된 학술 문장입니다.",
  ];
  for (const sample of skipped) {
    assert.equal(
      isTranslatableProseText(sample),
      false,
      `Expected non-prose sample to be skipped: ${sample}`,
    );
  }

  const kept = [
    "No drift.",
    "Shade saves lives.",
    "The effect disappeared.",
    "Pulse width: 10 ns.",
    "Figure 1. Measured leakage current across annealed HZO devices.",
    "Table 1. Device switching endurance comparison across annealing conditions.",
    "Measurements were taken at 0.2 V.",
    "Act now.",
  ];
  for (const sample of kept) {
    assert.equal(
      isTranslatableProseText(sample),
      true,
      `Expected scientific prose sample to be kept: ${sample}`,
    );
  }
});

test("inline translation skips equation tables, display math, code blocks, figure chrome, visually-hidden labels, and nav/tab lists", () => {
  withDom(`
    <article>
      <header>
        <h1>Ferroelectric switching under cyclic stress</h1>
        <div id="badge">Open Access</div>
        <div id="date">Published: 02 October 2026</div>
        <div id="doi">DOI: 10.1038/s41586-026-00001-1</div>
        <div id="metrics">14.2k Accesses</div>
        <ul id="tabs" class="section-tabs">
          <li id="tab-1"><a href="#sec1">Introduction</a></li>
          <li id="tab-2"><a href="#sec2">Methods</a></li>
          <li id="tab-3"><a href="#sec3">Results</a></li>
        </ul>
      </header>
      <span class="sr-only" id="sr-label">Skip to main article content</span>
      <span class="u-visually-hidden" id="uv-label">Open author affiliation drawer</span>
      <section id="sec1">
        <h2>Results</h2>
        <p id="prose-1">Independent measurements confirmed stable switching behavior after thermal annealing.</p>
        <div id="loose-number">120 mA</div>
        <table class="ltx_equation ltx_eqn_table" id="eqn-table">
          <tbody><tr><td><math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math></td><td>(1)</td></tr></tbody>
        </table>
        <mjx-container display="true" id="mjx-block">y = ax + b</mjx-container>
        <pre id="code-block"><code>def evaluate_switching(voltage): return voltage * 2</code></pre>
        <figure>
          <img alt="Switching curve" />
          <div class="c-article-section__figure-description"><p id="nature-fig-desc">Figure 1. Polarization hysteresis loops recorded at room temperature.</p></div>
          <a class="c-article-section__figure-link" id="fig-link" href="/img/full">Full size image</a>
          <div id="panel-badge">Panel a</div>
        </figure>
        <ul id="body-list">
          <li id="list-prose">Repeated voltage pulses preserved the high-resistance state.</li>
        </ul>
        <table id="data-table">
          <caption id="table-caption">Table 1. Comparison of tunneling electroresistance across film thicknesses.</caption>
          <thead><tr><th>Sample</th><th>TER (%)</th></tr></thead>
          <tbody><tr><th scope="row">HZO-A</th><td>120</td></tr></tbody>
        </table>
        <table id="bare-label-table">
          <caption id="bare-caption">Table 2</caption>
          <thead><tr><th>Sample</th><th>Value</th></tr></thead>
          <tbody><tr><td>A</td><td>42</td></tr></tbody>
        </table>
      </section>
      <section>
        <h2>Code availability</h2>
        <p id="code-avail">Analysis scripts are deposited in the public repository.</p>
      </section>
      <section>
        <h2>Rights and permissions</h2>
        <p id="rights-text">Open Access This article is licensed under a Creative Commons Attribution 4.0 International License.</p>
      </section>
      <section>
        <h2>Cite this article</h2>
        <p id="cite-text">Author, A. et al. Nature 612, 1-10 (2026).</p>
      </section>
    </article>
  `, "www.nature.com", () => {
    const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
    const readingIds = reading.sections.flatMap((section) => section.paragraphs.map((el) => el.id));
    // Summary reading document preserves full data tables and loose numeric text
    assert.ok(readingIds.includes("data-table"), "summary source retains data tables");
    assert.ok(readingIds.includes("loose-number"), "summary source retains loose numeric text");
    assert.equal(readingIds.includes("eqn-table"), false, "equation tables stay out of reading document");
    assert.equal(readingIds.includes("sr-label"), false, "sr-only text stays out of reading document");
    assert.equal(readingIds.includes("code-avail"), false, "Code availability stays ancillary");
    assert.equal(readingIds.includes("rights-text"), false, "Rights and permissions stays ancillary");
    assert.equal(readingIds.includes("cite-text"), false, "Cite this article stays ancillary");

    // Inline translation targets keep only readable prose, figure descriptions, vertical list items, and descriptive table captions
    const targets = collectTranslatableSections({ includeTranslatedParagraphs: true })
      .flatMap((section) => section.paragraphs.map((el) => el.id));
    assert.deepEqual(targets, [
      "prose-1",
      "nature-fig-desc",
      "list-prose",
      "table-caption",
    ]);
  });
});

test("horizontal flex and multi-column grid lists are excluded from inline translation", () => {
  withDom(`
    <article>
      <ul id="flex-bar"><li id="chip-1">Condensed matter physics</li><li id="chip-2">Ferroelectric memory</li></ul>
      <ul id="grid-bar"><li id="grid-1">Open peer review report</li><li id="grid-2">Author response letter</li></ul>
      <p id="real-prose">The measured current remained stable over ten thousand switching cycles.</p>
    </article>
  `, "journal.example", () => {
    const targets = collectTranslatableSections({ includeTranslatedParagraphs: true })
      .flatMap((section) => section.paragraphs.map((el) => el.id));
    assert.deepEqual(targets, ["real-prose"]);
  }, (element) => {
    if (element.id === "flex-bar") return { display: "flex", flexDirection: "row" };
    if (element.id === "grid-bar") return { display: "grid", gridTemplateColumns: "1fr 1fr" };
    return { display: element.tagName === "LI" ? "list-item" : "block" };
  });
});

test("computed visually-hidden CSS excludes offscreen accessibility spans from source and translation", () => {
  withDom(`
    <article>
      <div id="offscreen" class="custom-a11y">Hidden screen reader navigation hint.</div>
      <p id="visible">Measured devices exhibited reproducible switching thresholds.</p>
    </article>
  `, "journal.example", () => {
    const reading = collectReadingDocument();
    const targets = collectTranslatableSections().flatMap((s) => s.paragraphs.map((el) => el.id));
    assert.deepEqual(reading.sections.flatMap((s) => s.paragraphs.map((el) => el.id)), ["visible"]);
    assert.deepEqual(targets, ["visible"]);
  }, (element) => {
    if (element.id === "offscreen") {
      return { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0px, 0px, 0px, 0px)" };
    }
    return { display: "block" };
  });
});

test("createTranslationBlock keeps valid HTML and protects flex/grid parents via contained placement", () => {
  withDom(`
    <article>
      <p id="normal-p">Normal block paragraph for adjacent sibling placement.</p>
      <ul id="list"><li id="list-item">List item requiring contained translation block.</li></ul>
      <dl id="deflist"><dd id="def-item">Definition description requiring contained translation block.</dd></dl>
      <table id="tbl"><caption id="tbl-cap">Table 1. Caption requiring contained translation block.</caption><tbody><tr><td>1</td></tr></tbody></table>
      <div id="grid-parent"><p id="grid-p">Grid cell paragraph requiring contained translation block.</p></div>
    </article>
  `, "journal.example", () => {
    const normalP = document.getElementById("normal-p")!;
    const normalBlock = createTranslationBlock(normalP, "p-1");
    assert.strictEqual(normalP.nextElementSibling, normalBlock);
    assert.equal(normalBlock.classList.contains("paperlens-translation--contained"), false);

    const list = document.getElementById("list")!;
    const listItem = document.getElementById("list-item")!;
    const listBlock = createTranslationBlock(listItem, "li-1");
    assert.strictEqual(listBlock.parentElement, listItem, "<li> translation must stay inside <li>");
    assert.equal(list.children.length, 1, "<ul> must never receive a stray <div> child");
    assert.equal(listBlock.classList.contains("paperlens-translation--contained"), true);
    assert.equal(extractParagraphText(listItem), "List item requiring contained translation block.");

    const defItem = document.getElementById("def-item")!;
    const defBlock = createTranslationBlock(defItem, "dd-1");
    assert.strictEqual(defBlock.parentElement, defItem);

    const tbl = document.getElementById("tbl")!;
    const tblCap = document.getElementById("tbl-cap")!;
    const capBlock = createTranslationBlock(tblCap, "cap-1");
    assert.strictEqual(capBlock.parentElement, tblCap, "<caption> translation must stay inside <caption>");
    assert.equal(tbl.querySelectorAll(":scope > .paperlens-translation").length, 0);

    const gridParent = document.getElementById("grid-parent")!;
    const gridP = document.getElementById("grid-p")!;
    const gridBlock = createTranslationBlock(gridP, "grid-1");
    assert.strictEqual(gridBlock.parentElement, gridP, "grid child translation must not add a new grid track item");
    assert.equal(gridBlock.tagName, "SPAN", "contained block inside <p> uses block-styled <span> for valid HTML");
    assert.equal(gridParent.children.length, 1);

    toggleBlocksVisibility(false);
    assert.equal(normalBlock.style.display, "none");
    assert.equal(normalBlock.classList.contains("paperlens-hidden"), true);
    toggleBlocksVisibility(true);
    assert.equal(normalBlock.style.display, "");
    assert.equal(normalBlock.classList.contains("paperlens-hidden"), false);
  }, (element) => {
    if (element.id === "grid-parent") {
      return { display: "grid", gridTemplateColumns: "240px 1fr" };
    }
    return { display: "block" };
  });
});

test("wrapSentences preserves inline elements, MathML formulas, and skips contained translation blocks", () => {
  withDom(`
    <article>
      <ul>
        <li id="source-li" data-paperlens-id="pl-0-0">
          The measured response satisfies <math id="inline-math"><mi>y</mi><mo>=</mo><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo></math> in <em id="inline-em">annealed</em> films<a id="cite-link" href="#ref1"><sup>1</sup></a>.<button id="copy-btn">Copy</button>
          Second sentence confirms repeatability.
        </li>
      </ul>
    </article>
  `, "arxiv.org", () => {
    const li = document.getElementById("source-li")!;
    const mathEl = document.getElementById("inline-math")!;
    const emEl = document.getElementById("inline-em")!;
    const citeLink = document.getElementById("cite-link")!;
    const copyBtn = document.getElementById("copy-btn")!;
    const block = createTranslationBlock(li, "pl-0-0");

    const s1 = "The measured response satisfies y=f(x) in annealed films1.";
    const s2 = "Second sentence confirms repeatability.";
    wrapSentences(
      li,
      block,
      [
        { original: s1, translated: "측정된 응답은 열처리된 박막에서 y=f(x)를 만족한다." },
        { original: s2, translated: "두 번째 문장은 재현성을 확인한다." },
      ],
      "측정된 응답은 열처리된 박막에서 y=f(x)를 만족한다. 두 번째 문장은 재현성을 확인한다.",
    );

    // Original inline DOM nodes stay attached by exact object identity
    assert.strictEqual(document.getElementById("inline-math"), mathEl);
    assert.strictEqual(document.getElementById("inline-em"), emEl);
    assert.strictEqual(document.getElementById("cite-link"), citeLink);
    assert.strictEqual(document.getElementById("copy-btn"), copyBtn);

    // MathML internals and controls were never wrapped
    assert.equal(mathEl.querySelectorAll(".paperlens-sentence").length, 0);
    assert.equal(copyBtn.querySelectorAll(".paperlens-sentence").length, 0);

    // Both sentences matched and wrapped across original and translation
    assert.ok(li.querySelectorAll('[data-sentence-idx="0"]').length >= 2);
    assert.ok(li.querySelectorAll('[data-sentence-idx="1"]').length >= 1);
    assert.equal(block.querySelectorAll(".paperlens-sentence").length, 2);

    // Unwrapping cleanly restores original text
    unwrapSentenceSpansWithin(li);
    assert.equal(li.querySelectorAll(".paperlens-sentence").length, 0);
    assert.strictEqual(document.getElementById("inline-math"), mathEl);
    assert.strictEqual(document.getElementById("inline-em"), emEl);
  });
});

test("summary block ascends out of header, list, and figure anchors instead of breaking layout", () => {
  withDom(`
    <main>
      <article>
        <header id="art-header"><h1>Study title</h1><p id="header-lead">Short standfirst inside header.</p></header>
        <ul id="art-list"><li id="first-li">First bullet point.</li></ul>
        <figure id="art-fig"><figcaption id="first-cap">Figure 1. Measured curve.</figcaption></figure>
      </article>
    </main>
  `, "journal.example", () => {
    const header = document.getElementById("art-header")!;
    const block1 = createSummaryBlock({ insertionAnchor: document.getElementById("header-lead")! });
    assert.strictEqual(header.nextElementSibling, block1, "summary should sit right after <header>, not inside it");
    removeSummaryBlock();

    const list = document.getElementById("art-list")!;
    const block2 = createSummaryBlock({ insertionAnchor: document.getElementById("first-li")! });
    assert.strictEqual(block2.nextElementSibling, list, "summary should sit before <ul>, not inside it");
    removeSummaryBlock();

    const fig = document.getElementById("art-fig")!;
    const block3 = createSummaryBlock({ insertionAnchor: document.getElementById("first-cap")! });
    assert.strictEqual(block3.nextElementSibling, fig, "summary should sit before <figure>, not inside it");
    removeSummaryBlock();
  });
});
