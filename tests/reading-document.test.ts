import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { collectReadingDocument } from "../src/content/reading-document";
import { extractParagraphText } from "../src/content/text-extraction";
import { READING_FIXTURES } from "./fixtures/reading/cases";

function withDom(html: string, hostname: string, run: () => void): void {
  const parsed = parseHTML(`<html><head><title>Reading fixture</title></head><body>${html}</body></html>`);
  const previous = { document: globalThis.document, window: globalThis.window, Node: globalThis.Node };
  Object.defineProperty(globalThis, "document", { value: parsed.document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: { location: { hostname } }, configurable: true });
  Object.defineProperty(globalThis, "Node", { value: parsed.window.Node, configurable: true });
  try { run(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      Object.defineProperty(globalThis, key, { value, configurable: true });
    }
  }
}

test("reading document keeps a short standfirst, conclusion, list item and quotation in article order", () => {
  withDom(`<header><p id="site">Subscribe to our daily news</p></header>
    <article><header><h1>Cooling cities</h1><p id="lead">Shade saves lives.</p></header>
      <p id="body">Researchers measured the temperature of several city streets during the summer.</p>
      <p id="short">The effect disappeared.</p>
      <ul><li id="list">Plant more trees.</li></ul><blockquote id="quote">We need shade.</blockquote>
      <aside class="related-content"><p id="related">Read our guide to the best holiday destinations this summer.</p></aside>
    </article>`, "news.example", () => {
      assert.deepEqual(collectReadingDocument().sections.flatMap((section) => section.paragraphs.map((node) => node.id)),
        ["lead", "body", "short", "list", "quote"]);
    });
});

for (const footer of ["footer", 'div role="contentinfo"']) {
  const tag = footer.split(" ")[0];
  test(`article-owned ${footer} keeps scientific prose while page chrome stays excluded`, () => {
    withDom(`<header role="banner"><h1>Publisher</h1><p id="site-head">Browse our publication subscriptions.</p></header>
      <article><header role="banner"><h1>Device study</h1><p id="lead">The response is stable.</p></header>
        <p id="body">Repeated measurements used identical pulse sequences.</p>
        <${footer}><h2>Conclusions</h2><p id="conclusion">The effect disappeared after cooling.</p>
          <p id="note">Measurements were taken at 0.2 V.</p>
          <nav><p id="share">Share this article with your contacts.</p></nav>
          <form><p id="subscribe">Subscribe to our weekly updates.</p></form>
          <div class="copyright"><p id="rights">All rights reserved by the publisher.</p></div>
          <aside class="related-content"><p id="related">Read an unrelated story.</p></aside>
        </${tag}>
      </article><footer><p id="site-foot">Visit our corporate policies and partner publications.</p></footer>`, "www.nature.com", () => {
      const before = document.documentElement.outerHTML;
      const reading = collectReadingDocument();
      const anchors = reading.sections.flatMap((section) => section.paragraphs);
      assert.deepEqual(anchors.map((node) => node.id), ["lead", "body", "conclusion", "note"]);
      assert.equal(reading.scope.partial, false);
      assert.equal(document.documentElement.outerHTML, before);
      for (const anchor of anchors) assert.strictEqual(anchor, document.getElementById(anchor.id));
    });
  });
}

test("a publisher masthead inside main cannot replace the current article header", () => {
  withDom(`<main><header class="site-header" role="banner"><h1>Publisher</h1><p id="masthead">Explore our publication services.</p></header>
    <header class="article-header" role="banner"><h1>Device study</h1><p id="lead">The response is stable.</p></header>
    <article><p id="body">The same devices were measured after cooling.</p>
      <footer role="contentinfo"><p id="conclusion">The response returned to its original state.</p></footer></article>
    <footer role="contentinfo"><p id="site-foot">Visit our legal policies and partner publications.</p></footer></main>`, "journal.example", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "citation_title");
    meta.setAttribute("content", "Device study");
    document.head.appendChild(meta);
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["lead", "body", "conclusion"]);
    assert.equal(reading.scope.partial, false);
  });
});

for (const footer of ["footer", 'div role="contentinfo"']) {
  const tag = footer.split(" ")[0];
  for (const inline of [false, true]) {
    test(`owned ${footer} recovers ${inline ? "inline-wrapped" : "direct"} scientific text without a paragraph`, () => {
      const note = "Measurements were taken at 0.2 V.";
      withDom(`<article><h1>Device study</h1><p id="body">Devices were measured after cooling.</p>
        <${footer} id="note">${inline ? `<span>${note}</span>` : note}</${tag}></article>`, "journal.example", () => {
        const before = document.documentElement.outerHTML;
        const reading = collectReadingDocument();
        const anchors = reading.sections.flatMap((section) => section.paragraphs);
        assert.deepEqual(anchors.map(extractParagraphText), ["Devices were measured after cooling.", note]);
        assert.strictEqual(anchors[1], document.getElementById("note"));
        assert.equal(reading.scope.partial, false);
        assert.equal(document.documentElement.outerHTML, before);
      });
    });
  }
}

test("owned footer paragraph and table text omit inline copyright and related controls", () => {
  withDom(`<article><h1>Device study</h1><p id="body">Devices were measured after cooling.</p>
    <footer><p id="note">Measurements were taken at 0.2 V. <span class="copyright">All rights reserved.</span>
      <span class="related-content">Read a different article.</span><span class="article-meta">Published by the journal.</span></p>
      <table id="measurements"><thead><tr><th>Device</th><th>TER (%)</th></tr></thead>
        <tbody><tr><th scope="row">A</th><td>120</td></tr></tbody>
        <tfoot><tr><td colspan="2">Values measured at 0.2 V. <span class="copyright">All rights reserved.</span>
          <span class="related-articles">Read a different article.</span></td></tr></tfoot></table>
    </footer></article>`, "journal.example", () => {
    const before = document.documentElement.outerHTML;
    const reading = collectReadingDocument();
    const anchors = reading.sections.flatMap((section) => section.paragraphs);
    assert.deepEqual(anchors.map((node) => node.id), ["body", "note", "measurements"]);
    assert.equal(extractParagraphText(anchors[1]), "Measurements were taken at 0.2 V.");
    assert.equal(extractParagraphText(anchors[2]), "Device | TER (%)\nA | TER (%): 120\nValues measured at 0.2 V.");
    assert.equal(reading.scope.partial, false);
    assert.equal(document.documentElement.outerHTML, before);
  });
});

test("direct scientific footer text can be recovered beside excluded inline controls", () => {
  withDom(`<article><h1>Device study</h1><p id="body">Devices were measured after cooling.</p>
    <footer id="note">Measurements were taken at 0.2 V. <span class="copyright">All rights reserved.</span>
      <span class="related-content">Read a different article.</span></footer></article>`, "journal.example", () => {
    const before = document.documentElement.outerHTML;
    const reading = collectReadingDocument();
    const anchors = reading.sections.flatMap((section) => section.paragraphs);
    assert.deepEqual(anchors.map(extractParagraphText), ["Devices were measured after cooling.", "Measurements were taken at 0.2 V."]);
    assert.strictEqual(anchors[1], document.getElementById("note"));
    assert.equal(reading.scope.partial, false);
    assert.equal(document.documentElement.outerHTML, before);
  });
});

test("publisher body footer is owned while an unrelated footer under main is not", () => {
  withDom(`<main><header><h1>Cooling cities</h1><p id="lead">Shade saves lives.</p></header>
    <div itemprop="articleBody"><p id="body">The street temperatures were measured at noon.</p>
      <footer><h2>Conclusions</h2><p id="conclusion">Trees lowered the measured temperature.</p></footer></div>
    <footer><p id="site-foot">Explore our corporate history and subscription packages.</p></footer>
    </main>`, "news.example", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["lead", "body", "conclusion"]);
    assert.equal(reading.scope.partial, false);
  });
});

test("later article header and footer remain outside the current reading scope", () => {
  withDom(`<main><article><header><h1>Current story</h1><p id="lead">Rain increased.</p></header>
    <p id="body">The readings were compared across three years.</p><footer><p id="note">Only summer measurements were compared.</p></footer></article>
    <article><header><h1>Next story</h1><p id="next-lead">An unrelated story begins.</p></header>
      <p id="next-body">Unrelated financial news.</p><footer><p id="next-note">Notes for the unrelated story.</p></footer></article></main>`, "news.example", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["lead", "body", "note"]);
    assert.equal(reading.scope.partial, false);
  });
});

for (const heading of ["Footnotes", "Endnotes"]) {
  test(`${heading} can contain scientific conditions without admitting references or funding`, () => {
    withDom(`<article><h1>Device study</h1><p id="body">The current was measured after each pulse.</p>
      <footer><section role="doc-endnotes"><h2>${heading}</h2><p id="condition">Reported currents were normalized to device area.</p></section>
        <section><h2>Funding</h2><p id="funding">The study was supported by the research council.</p></section>
        <section role="doc-bibliography"><h2>References</h2><p id="reference">A cited publication and its bibliographic details.</p></section>
      </footer></article>`, "pubs.acs.org", () => {
      const reading = collectReadingDocument();
      assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["body", "condition"]);
      assert.equal(reading.scope.partial, false);
      assert.ok(reading.scope.reasons.includes("ancillary-content-excluded"));
    });
  });
}

test("a table inside the article footer keeps column headers and scientific tfoot conditions once", () => {
  withDom(`<article><h1>Device study</h1><p id="body">Devices were compared at the same read voltage.</p>
    <footer><table id="measurements"><caption>Measurements</caption><thead><tr><th>Device</th><th>TER (%)</th></tr></thead>
      <tbody><tr><th scope="row">A</th><td>120<button>Copy</button></td></tr><tr hidden><th>A-copy</th><td>999</td></tr></tbody>
      <tfoot><tr><td colspan="2">Values measured at 0.2 V.</td></tr></tfoot></table></footer></article>`, "journal.example", () => {
    const reading = collectReadingDocument();
    const anchors = reading.sections.flatMap((section) => section.paragraphs);
    assert.deepEqual(anchors.map((node) => node.id), ["body", "measurements"]);
    assert.equal(reading.scope.tableCount, 1);
    assert.equal(reading.scope.captionCount, 1);
    assert.equal(reading.scope.partial, false);
    assert.equal(extractParagraphText(anchors[1]), "Measurements\nDevice | TER (%)\nA | TER (%): 120\nValues measured at 0.2 V.");
  });
});

test("reading document captures ScienceDirect figures and scientific appendices", () => {
  withDom(`<article><div id="body"><section id="sec1"><h2>Results</h2>
      <div id="p1">The switching experiment used the same pulse sequence on every available device.</div>
      <figure class="figure"><figcaption id="caption">Figure 1. No drift.</figcaption></figure>
    </section></div><div class="Appendices"><section><h2>Appendix A. Methods</h2>
      <div id="p2">Pulse width: 10 ns.</div></section></div>
    <section id="references"><h2>References</h2><p id="reference">A cited work and its bibliographic publication details appear here.</p></section>
    </article>`, "www.sciencedirect.com", () => {
      assert.deepEqual(collectReadingDocument().sections.flatMap((section) => section.paragraphs.map((node) => node.id)),
        ["p1", "caption", "p2"]);
    });
});

test("table extraction preserves caption, column headers, row label and numeric relationships", () => {
  withDom(`<article><table id="measurements"><caption>Table 1. Device comparison</caption>
    <thead><tr><th>Sample</th><th>TER (%)</th><th>Voltage (V)</th></tr></thead>
    <tbody><tr><th scope="row">HZO-A</th><td>120</td><td>0.2</td></tr>
    <tr><th scope="row">HZO-B</th><td>95</td><td>0.3</td></tr></tbody>
    </table></article>`, "journal.example", () => {
      assert.equal(extractParagraphText(document.getElementById("measurements")!),
        "Table 1. Device comparison\nSample | TER (%) | Voltage (V)\nHZO-A | TER (%): 120 | Voltage (V): 0.2\nHZO-B | TER (%): 95 | Voltage (V): 0.3");
    });
});

test("reading scope reports restricted access without treating the gate as article prose", () => {
  withDom(`<article><h1>Measurements</h1><section><h2>Abstract</h2><p id="abstract">We measured the devices.</p></section>
    <div class="paywall"><p>Subscribe to read the full article.</p></div></article>`, "www.nature.com", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["abstract"]);
    assert.equal(reading.scope.partial, true);
    assert.ok(reading.scope.reasons.includes("access-restricted"));
    assert.equal(reading.scope.paragraphCount, 1);
  });
});

test("independent reconciliation recovers meaningful text with no paragraph selector", () => {
  withDom(`<article><h1>Cooling cities</h1><div class="story-copy"><span id="inside">Shade matters.</span></div>
    <p id="body">Teams sampled city temperatures using the same measurement protocol.</p></article>`, "news.example", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map(extractParagraphText)),
      ["Shade matters.", "Teams sampled city temperatures using the same measurement protocol."]);
    assert.equal(reading.scope.partial, false);
  });
});

test("independent reconciliation flags mixed unrepresented text without duplicating its nested paragraph", () => {
  withDom(`<article><h1>Cooling cities</h1><div>Unlabelled introduction.
    <p id="body">Teams sampled city temperatures using the same measurement protocol.</p></div></article>`, "news.example", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["body"]);
    assert.equal(reading.scope.partial, true);
    assert.ok(reading.scope.reasons.includes("unrepresented-article-text"));
  });
});

test("reading document includes distributed article blocks and their own header lead", () => {
  withDom(`<main><header><h1>Weather changes</h1><p id="lead">Expect more rain.</p></header>
    <div itemprop="articleBody"><p id="intro">Meteorologists observed a change across several weather stations in the region.</p></div>
    <form><p id="form">Enter your email for the latest weather warnings and exclusive daily coverage.</p></form>
    <div itemprop="articleBody"><p id="ending">Prepare now.</p></div></main>`, "news.example", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["lead", "intro", "ending"]);
    assert.equal(reading.scope.partial, false);
  });
});

test("source-node dedup keeps identical passages at different positions and collapses nested wrappers", () => {
  withDom(`<article><h1>Repeated measurements</h1>
    <div class="paragraph-element" id="wrapper"><p id="first">No drift.</p></div>
    <p id="second">No drift.</p><div hidden><p id="hidden-copy">No drift.</p></div>
    <section id="references"><h2>References</h2><p id="ref">References excluded.</p></section></article>`, "onlinelibrary.wiley.com", () => {
    const before = document.documentElement.outerHTML;
    const reading = collectReadingDocument();
    const anchors = reading.sections.flatMap((section) => section.paragraphs);
    assert.deepEqual(anchors.map((node) => node.id), ["first", "second"]);
    assert.strictEqual(anchors[0], document.getElementById("first"));
    assert.strictEqual(anchors[1], document.getElementById("second"));
    assert.equal(document.documentElement.outerHTML, before);
  });
});

test("later infinite-scroll articles do not become part of the current article", () => {
  withDom(`<main><article><h1>Current news</h1><p id="current">Current events.</p></article>
    <article><h1>Next article</h1><p id="next">The next article contains a much longer and entirely unrelated report about sports results.</p></article></main>`, "news.example", () => {
    assert.deepEqual(collectReadingDocument().sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["current"]);
  });
});

test("loading placeholders produce partial scope without claiming unloaded sections", () => {
  withDom(`<article><h1>Measurements</h1><p id="abstract">We measured the devices.</p>
    <section data-loaded="false" aria-busy="true"><h2>Results</h2><div>Loading article content...</div></section></article>`, "pubs.acs.org", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["abstract"]);
    assert.equal(reading.scope.partial, true);
    assert.ok(reading.scope.reasons.includes("content-not-loaded"));
  });
});

test("translated originals remain identical when scope is refreshed and output UI is excluded", () => {
  withDom(`<article><h1>Measurements</h1><p id="first" data-paperlens-id="existing">No drift.</p>
    <div class="paperlens-translation"><p>번역 결과</p></div><p id="second">New evidence.</p>
    <div class="paperlens-summary"><p>Summary output with much longer text must never enter the source.</p></div></article>`, "journal.example", () => {
    const untranslated = collectReadingDocument();
    assert.deepEqual(untranslated.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["second"]);
    const all = collectReadingDocument({ includeTranslatedParagraphs: true });
    assert.deepEqual(all.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["first", "second"]);
    assert.strictEqual(all.sections[0].paragraphs[0], document.getElementById("first"));
    assert.equal(all.scope.partial, false);
  });
});

test("scientific headings with no captured content are partial, while loose numeric text is recovered", () => {
  withDom(`<article><h1>Measurements</h1><p id="body">Observed current.</p>
    <div id="number">120 mA</div><section><h4>A previously omitted derivation</h4></section></article>`, "arxiv.org", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["body", "number"]);
    assert.equal(reading.scope.partial, true);
    assert.ok(reading.scope.reasons.includes("unrepresented-article-text"));
  });
});

test("distributed publisher components with separate article tags remain one owned article", () => {
  withDom(`<main><div class="globalsite cmp-globalsite-articletext"><article class="article-text"><p id="intro">Start here.</p></article></div>
    <form><p>Enter your work email to receive the full report.</p></form>
    <div class="globalsite cmp-globalsite-articletext"><article class="article-text"><p id="ending">Act now.</p></article></div></main>`, "www.gartner.com", () => {
    assert.deepEqual(collectReadingDocument().sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["intro", "ending"]);
  });
});

test("external abstract stays ordered before the primary article body", () => {
  withDom(`<main><div class="abstract"><h2>Abstract</h2><p id="abstract">Stable switching.</p></div>
    <article><h1>Device study</h1><section><h2>Results</h2><p id="body">No drift.</p></section></article></main>`, "pubs.aip.org", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["abstract", "body"]);
    assert.equal(reading.scope.partial, false);
  });
});

test("ancillary references are explicitly described as excluded without making the loaded article partial", () => {
  withDom(`<article><h1>Device study</h1><p id="body">No drift.</p>
    <section><h2>Acknowledgments</h2><p id="thanks">We thank the research team.</p></section>
    <section id="references"><h2>References</h2><p>A cited work appears here.</p></section></article>`, "www.nature.com", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["body"]);
    assert.equal(reading.scope.partial, false);
    assert.ok(reading.scope.reasons.includes("ancillary-content-excluded"));
  });
});

test("news metadata overrides a scientific publisher hostname", () => {
  withDom(`<article itemtype="https://schema.org/NewsArticle"><h1>Research funding news</h1><p>Funding fell.</p></article>`, "www.nature.com", () => {
    assert.equal(collectReadingDocument().kind, "article");
  });
});

test("merged table headers and rowspan labels retain their numeric associations", () => {
  withDom(`<article><table id="merged"><caption>Table 2. Switching</caption><thead>
    <tr><th rowspan="2">Device</th><th colspan="2">Readout</th></tr>
    <tr><th>TER (%)</th><th>Current (mA)</th></tr></thead><tbody>
    <tr><th rowspan="2" scope="row">A</th><td>120</td><td>0.2</td></tr>
    <tr><td>95</td><td>0.3</td></tr></tbody></table></article>`, "journal.example", () => {
    const text = extractParagraphText(document.getElementById("merged")!);
    assert.equal(text, "Table 2. Switching\nDevice | Readout / TER (%) | Readout / Current (mA)\nA | Readout / TER (%): 120 | Readout / Current (mA): 0.2\nA | Readout / TER (%): 95 | Readout / Current (mA): 0.3");
  });
});

test("article prose excludes dialogs and nested interactive UI from its serialized text", () => {
  withDom(`<article><h1>Device study</h1><p id="body">No drift.<button>Share</button><span hidden>Duplicate prose.</span></p>
    <dialog open><p id="dialog-copy">Duplicate prose from an unrelated full-screen dialog.</p></dialog></article>`, "arxiv.org", () => {
    const reading = collectReadingDocument();
    const anchors = reading.sections.flatMap((section) => section.paragraphs);
    assert.deepEqual(anchors.map((node) => node.id), ["body"]);
    assert.equal(extractParagraphText(anchors[0]), "No drift.");
  });
});

test("flat ancillary headings exclude references and acknowledgments but keep the following appendix", () => {
  withDom(`<article><h1>Device study</h1><h2>Results</h2><p id="body">No drift.</p>
    <h2>References</h2><p id="reference">A cited work and its bibliographic details.</p>
    <h2>Acknowledgments</h2><p id="thanks">We thank our research team.</p>
    <h2>Appendix A. Methods</h2><p id="appendix">Use short pulses.</p></article>`, "journal.example", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["body", "appendix"]);
    assert.equal(reading.scope.partial, false);
    assert.ok(reading.scope.reasons.includes("ancillary-content-excluded"));
  });
});

test("hidden access widgets do not label a fully loaded article restricted", () => {
  withDom(`<article><h1>Device study</h1><p id="body">No drift.</p>
    <div hidden class="paywall"><p>The obsolete gate is hidden after login.</p></div></article>`, "www.nature.com", () => {
    const reading = collectReadingDocument();
    assert.equal(reading.scope.partial, false);
    assert.equal(reading.scope.reasons.includes("access-restricted"), false);
  });
});

test("table serialization excludes hidden duplicate rows and preserves visible footnotes", () => {
  withDom(`<article><table id="filtered"><caption>Measurements</caption><thead><tr><th>Device</th><th>TER (%)</th></tr></thead>
    <tbody><tr><th scope="row">A</th><td>120<button>Copy</button></td></tr>
      <tr hidden><th scope="row">A-copy</th><td>999</td></tr></tbody>
    <tfoot><tr><td colspan="2">Values measured at 0.2 V.</td></tr></tfoot></table></article>`, "journal.example", () => {
    assert.equal(extractParagraphText(document.getElementById("filtered")!),
      "Measurements\nDevice | TER (%)\nA | TER (%): 120\nValues measured at 0.2 V.");
  });
});

test("current article lead outside the body article remains owned while a later article is excluded", () => {
  withDom(`<main><header><h1>Current story</h1><p id="lead">A changed climate.</p></header>
    <article><p id="body">Rainfall increased across the region after three years of low precipitation.</p></article>
    <article><h1>Next story</h1><p id="next">An unrelated story.</p></article></main>`, "news.example", () => {
    assert.deepEqual(collectReadingDocument().sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["lead", "body"]);
  });
});

test("unrecognised article ownership remains visible in the scope", () => {
  withDom(`<div class="unrecognised-layout"><p id="body">Available text is readable but the article boundary is not declared in this document.</p></div>`, "journal.example", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["body"]);
    assert.equal(reading.scope.partial, true);
    assert.ok(reading.scope.reasons.includes("article-boundary-uncertain"));
  });
});

test("computed publisher CSS excludes a hidden duplicate representation", () => {
  withDom(`<style>.desktop-hidden { display: none; }</style><article><h1>Study</h1><p id="real">No drift.</p>
    <div class="desktop-hidden"><p id="css-copy">No drift.</p></div></article>`, "journal.example", () => {
    // LinkeDOM has no layout engine. This is the browser's computed-style
    // boundary for the literal rule above, not a parser implementation mock.
    Object.defineProperty(window, "getComputedStyle", { configurable: true, value: (element: Element) =>
      ({ display: element.matches(".desktop-hidden") ? "none" : "block", visibility: "visible" }) });
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["real"]);
    assert.equal(reading.scope.partial, false);
  });
});

test("flat main story containers stop at the next article title", () => {
  withDom(`<main><div class="story"><h1>Current story</h1><p id="current">Rain increased.</p></div>
    <div class="story"><h1>Next story</h1><p id="next">An unrelated sports story.</p></div></main>`, "news.example", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["current"]);
    assert.equal(reading.scope.partial, false);
  });
});

test("a nearby gate after the current article marks its accessible abstract partial", () => {
  withDom(`<main><article><h1>Study</h1><p id="abstract">The abstract is available.</p></article>
    <div class="paywall"><p>Subscribe for the full article.</p></div></main>`, "www.nature.com", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["abstract"]);
    assert.equal(reading.scope.partial, true);
    assert.ok(reading.scope.reasons.includes("access-restricted"));
  });
});

test("a gate belonging to a later article does not restrict the current article", () => {
  withDom(`<main><article><h1>Current</h1><p id="body">The result is available.</p></article>
    <article><h1>Next</h1><div class="paywall"><p>Subscribe for the next article.</p></div></article></main>`, "www.nature.com", () => {
    assert.equal(collectReadingDocument().scope.reasons.includes("access-restricted"), false);
  });
});

test("an oversized source document stops before parsing and reports the extraction budget", () => {
  withDom(`<article><h1>Study</h1><p id="body">No drift.</p></article>`, "journal.example", () => {
    const original = document.getElementsByTagName.bind(document);
    Object.defineProperty(document, "getElementsByTagName", { configurable: true, value: (name: string) =>
      name === "*" ? { length: 100_001 } : original(name) });
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), []);
    assert.equal(reading.scope.partial, true);
    assert.ok(reading.scope.reasons.includes("extraction-limit"));
  });
});

test("publisher caption classes contribute to source caption counts", () => {
  withDom(`<article><h1>Study</h1><p id="body">No drift.</p>
    <div class="figure__caption"><p id="acs-caption">Figure 1. Current.</p></div>
    <div class="ltx_caption" id="arxiv-caption">Figure 2. Switching.</div></article>`, "pubs.acs.org", () => {
    const reading = collectReadingDocument();
    assert.deepEqual(reading.sections.flatMap((section) => section.paragraphs.map((node) => node.id)), ["body", "acs-caption", "arxiv-caption"]);
    assert.equal(reading.scope.captionCount, 2);
  });
});

for (const fixture of READING_FIXTURES) {
  test(`${fixture.sourceLayout}: annotated source nodes only, in order`, () => {
    withDom(fixture.html, fixture.host, () => {
      const before = document.documentElement.outerHTML;
      const reading = collectReadingDocument({ includeTranslatedParagraphs: true });
      const anchors = reading.sections.flatMap((section) => section.paragraphs);
      assert.deepEqual(anchors.map((node) => node.id), fixture.expectedIds);
      for (const anchor of anchors) assert.strictEqual(anchor, document.getElementById(anchor.id));
      assert.equal(document.documentElement.outerHTML, before);
      assert.equal(reading.scope.partial, fixture.accessState === "restricted");
      assert.equal(reading.scope.paragraphCount, fixture.expectedIds.length);
      if (fixture.accessState === "loaded") {
        assert.equal(reading.scope.captionCount, 2);
        assert.equal(reading.scope.tableCount, 1);
        assert.ok(extractParagraphText(document.getElementById("table")!).includes("A | TER (%): 120"));
      } else {
        assert.ok(reading.scope.reasons.includes("access-restricted"));
      }
    });
  });
}
