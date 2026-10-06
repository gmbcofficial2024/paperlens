import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";
import { collectParagraphs } from "../src/content/dom-parser";
import { collectReadingDocument } from "../src/content/reading-document";
import { extractParagraphText } from "../src/content/text-extraction";

function withDom(html: string, hostname: string, run: () => void): void {
  const parsed = parseHTML(html);
  const previous = { document: globalThis.document, window: globalThis.window, Node: globalThis.Node };
  Object.defineProperty(globalThis, "document", { value: parsed.document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: { location: { hostname } }, configurable: true });
  Object.defineProperty(globalThis, "Node", { value: parsed.window.Node, configurable: true });
  try { run(); } finally {
    for (const [key, value] of Object.entries(previous)) Object.defineProperty(globalThis, key, { value, configurable: true });
  }
}

const fixtureHtml = () => readFileSync(resolve("tests/fixtures/reading/frontiers-article-details-v4.html"), "utf8");

function assertFrontiersSource(html: string): void {
  withDom(html, "www.frontiersin.org", () => {
    const source = document.getElementById("frontiers-abstract")!;
    const before = document.documentElement.outerHTML;
    assert.ok(collectParagraphs({ includeTranslatedParagraphs: true }).includes(source));
    const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
    const anchors = reading.sections.flatMap((section) => section.paragraphs);
    assert.deepEqual(anchors.map((node) => node.id), ["frontiers-abstract"]);
    assert.strictEqual(anchors[0], source);
    assert.equal(reading.sections[0].heading, "Abstract");
    assert.equal(extractParagraphText(anchors[0]), "Independent measurements showed stable responses across the devices. A controlled pulse sequence allowed the researchers to compare the observed responses with the stated hypothesis.");
    assert.equal(document.documentElement.outerHTML, before);
    assert.equal(reading.scope.partial, true);
    assert.ok(reading.scope.reasons.includes("abstract-only"));
  });
}

test("Frontiers ArticleDetailsV4 owns its main scientific content instead of sidebar article cards", () => {
  assertFrontiersSource(fixtureHtml());
});

test("hydrated Frontiers promotional article inside main does not replace scientific source ownership", () => {
  const html = fixtureHtml().replace('<div class="ArticleDetailsV4__main__content">',
    `<article class="CardA"><h2 class="CardA__title">Expert review helps science</h2>
      <p class="CardA__text">Join our reviewer community and contribute your expertise to the scientific publication process.</p></article>
      <div class="ArticleDetailsV4__main__content">`);
  assertFrontiersSource(html);
});

test("main scientific body evidence outranks an unrelated article tag outside main on any host", () => {
  withDom(`<html><head><title>Device study</title></head><body>
    <aside><article><p id="card">Journal metrics and a promotional offer for readers.</p></article></aside>
    <main><h1>Device study</h1><div class="article-body"><h2>Results</h2>
      <p id="scientific-prose">Researchers compared switching responses across devices using the same controlled pulse sequence.</p>
    </div></main></body></html>`, "journal.example", () => {
      const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
      const anchors = reading.sections.flatMap((section) => section.paragraphs);
      assert.deepEqual(anchors.map((node) => node.id), ["scientific-prose"]);
      assert.strictEqual(anchors[0], document.getElementById("scientific-prose"));
    });
});

test("main with substantial owned prose keeps both passages around a subordinate promotional article", () => {
  withDom(`<html><head><title>Device study</title></head><body><main><h1>Device study</h1>
    <p id="first">Researchers compared switching responses across devices using the same controlled pulse sequence.</p>
    <article class="CardA"><h2>Support science</h2><p id="promotion">Join our reviewer community and contribute your expertise to scientific publishing.</p></article>
    <p id="second">The independent replication confirmed that the reported responses remained stable.</p>
    </main></body></html>`, "journal.example", () => {
      const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
      assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["first", "second"]);
      assert.equal(reading.scope.partial, false);
    });
});

test("main ownership keeps short scientific prose ahead of a longer promotional article", () => {
  withDom(`<html><head><title>Device study</title></head><body><main><h1>Device study</h1>
    <p id="short-source">No drift.</p>
    <article class="CardA"><h2>Support science</h2><p id="promotion">Join our reviewer community and contribute your expertise to scientific publishing.</p></article>
    </main></body></html>`, "journal.example", () => {
      const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
      assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["short-source"]);
      assert.equal(reading.scope.partial, false);
    });
});

for (const lead of ["Outside introduction to the scientific measurements and their implications.", "No drift."]) {
  test(`main ownership retains a genuine headingless article after an outside lead (${lead.length} chars)`, () => {
    withDom(`<html><head><title>Study</title></head><body><main><h1>Study</h1><p id="lead">${lead}</p>
      <article><p id="body">Actual scientific body and the experimental measurements.</p></article>
      </main></body></html>`, "journal.example", () => {
        const reading = collectReadingDocument();
        assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["lead", "body"]);
        assert.equal(reading.scope.partial, false);
      });
  });
}

test("PaperLens summary loading inside accepted article content is not a source loading signal", () => {
  withDom(`<html><head><title>Study</title></head><body><article><h1>Study</h1><p id="body">No drift.</p>
    <div class="paperlens-summary" aria-busy="true"><button>Generating summary</button><p>Preparing analysis.</p>
      <div class="paywall">Generated example access state.</div></div></article></body></html>`, "journal.example", () => {
      const reading = collectReadingDocument();
      assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["body"]);
      assert.equal(reading.scope.partial, false);
      assert.equal(reading.scope.reasons.includes("content-not-loaded"), false);
      assert.equal(reading.scope.reasons.includes("access-restricted"), false);
    });
});

test("Frontiers recapture ignores the busy summary inserted next to its scientific paragraph", () => {
  const html = fixtureHtml().replace('<p id="frontiers-abstract">',
    '<div class="paperlens-summary" aria-busy="true"><button>Generating summary</button></div><p id="frontiers-abstract">');
  withDom(html, "www.frontiersin.org", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["frontiers-abstract"]);
    assert.deepEqual(reading.scope.reasons, ["abstract-only"]);
  });
});

test("main matching citation title wins over an earlier unrelated dashboard main", () => {
  withDom(`<html><head><title>Device study</title><meta name="citation_title" content="Device study"></head><body>
    <main><h1>Dashboard</h1><p id="dashboard">Your saved items and notification preferences are available in this account dashboard.</p></main>
    <main><h1>Device study</h1><div class="article-body"><p id="scientific-prose">Researchers compared switching responses across devices using the same controlled pulse sequence.</p></div></main>
    </body></html>`, "journal.example", () => {
      const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
      assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["scientific-prose"]);
      assert.equal(reading.scope.partial, false);
    });
});

test("a genuine title and prose article without main remains supported", () => {
  withDom(`<html><head><title>Device study</title><meta name="citation_title" content="Device study"></head><body>
    <aside><article><p id="card">A promotional journal card and its reader offer.</p></article></aside>
    <article><h1>Device study</h1><p id="scientific-prose">Researchers compared switching responses across devices using the same controlled pulse sequence.</p></article>
    </body></html>`, "journal.example", () => {
      const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
      assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["scientific-prose"]);
    });
});

test("a genuine title-bearing scientific article inside main retains its article boundary", () => {
  withDom(`<html><head><title>Device study</title><meta name="citation_title" content="Device study"></head><body><main>
    <article><h1>Device study</h1><p id="scientific-prose">Researchers compared switching responses across devices using the same controlled pulse sequence.</p></article>
    <p id="outside">Account actions and promotional reading offers are displayed outside the actual article.</p>
    <article><h1>Next study</h1><p id="next">A second unrelated article appears after the current article.</p></article>
    </main></body></html>`, "journal.example", () => {
      assert.deepEqual(collectReadingDocument().sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["scientific-prose"]);
    });
});

test("an arbitrary Frontiers abstract section alone does not imply unavailable formatted content", () => {
  const html = fixtureHtml().replace('class="NotifyMeBanner"', 'class="NotifyMeBanner" hidden');
  withDom(html, "www.frontiersin.org", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["frontiers-abstract"]);
    assert.equal(reading.scope.reasons.includes("abstract-only"), false);
    assert.equal(reading.scope.partial, false);
  });
});

test("Frontiers loaded scientific sections are not labelled abstract-only because of publication metadata", () => {
  const html = fixtureHtml().replace('</div></div>\n        <div class="Summary">',
    `<h2>Results</h2><p id="frontiers-results">Controlled measurements confirmed stable responses.</p></div></div>
        <div class="Summary">`);
  withDom(html, "www.frontiersin.org", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["frontiers-abstract", "frontiers-results"]);
    assert.equal(reading.scope.reasons.includes("abstract-only"), false);
  });
});
