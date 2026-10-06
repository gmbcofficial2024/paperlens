import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";
import Readability from "../src/vendor/readability/Readability.js";
import { collectParagraphs, collectSections } from "../src/content/dom-parser";
import { collectReadabilitySourceElements } from "../src/content/readability-adapter";
import { createTranslationBlock } from "../src/content/translation-block";
import { PROFILE_CASES } from "./fixtures/academic/cases";

function installDom(html: string, hostname: string): () => void {
  const parsed = parseHTML(html);
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    Node: globalThis.Node,
  };
  Object.defineProperty(globalThis, "document", { value: parsed.document, configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: { location: { hostname } },
    configurable: true,
  });
  Object.defineProperty(globalThis, "Node", { value: parsed.window.Node, configurable: true });
  return () => {
    Object.defineProperty(globalThis, "document", { value: previous.document, configurable: true });
    Object.defineProperty(globalThis, "window", { value: previous.window, configurable: true });
    Object.defineProperty(globalThis, "Node", { value: previous.Node, configurable: true });
  };
}

const long = (label: string) =>
  `${label} contains enough scientific prose to exceed the PaperLens minimum text threshold safely.`;

const articleParagraph = (label: string) =>
  `${label} reports a controlled scientific investigation with reproducible methods, quantitative observations, and carefully bounded conclusions. The discussion connects each observation to the stated research question so that readers can evaluate the evidence independently.`;

function runFixture(filename: string, hostname: string): string[] {
  const html = readFileSync(resolve("tests/fixtures/academic/fallback", filename), "utf8");
  const restore = installDom(html, hostname);
  try {
    return collectParagraphs().map((node) => node.id);
  } finally {
    restore();
  }
}

test("profile candidates are returned in source DOM order", () => {
  const restore = installDom(`
    <article><div class="c-article-body main-content">
      <p id="body-1">${long("body-1")}</p>
      <figure><figcaption><p id="caption">${long("caption")}</p></figcaption></figure>
      <p id="body-2">${long("body-2")}</p>
    </div></article>
  `, "www.nature.com");
  try {
    assert.deepEqual(collectParagraphs().map((node) => node.id), ["body-1", "caption", "body-2"]);
  } finally {
    restore();
  }
});

test("verified structural passage suppresses a lower-confidence nested math fragment", () => {
  const restore = installDom(`
    <html><head><title>IEEE candidate arbitration article</title></head><body>
      <article>
        <xpl-document-abstract>
          <div id="ieee-abstract" class="abstract-text-content">
            <span>${articleParagraph("IEEE abstract")}</span>
            <div id="ieee-math-fragment" class="display-equation">
              ${articleParagraph("Nested mathematical derivation")}
            </div>
          </div>
        </xpl-document-abstract>
        <section class="section">
          <p id="ieee-body">${articleParagraph("IEEE body")}</p>
        </section>
      </article>
    </body></html>
  `, "ieeexplore.ieee.org");
  try {
    const abstract = document.querySelector<HTMLElement>("#ieee-abstract")!;
    const body = document.querySelector<HTMLElement>("#ieee-body")!;
    const nestedMath = document.querySelector<HTMLElement>("#ieee-math-fragment")!;

    const actual = collectParagraphs();

    assert.deepEqual(actual.map((node) => node.id), ["ieee-abstract", "ieee-body"]);
    assert.strictEqual(actual[0], abstract);
    assert.strictEqual(actual[1], body);
    actual.forEach((node) => {
      assert.equal(node.ownerDocument, document);
      assert.equal(document.contains(node), true);
    });
    assert.equal(actual.includes(nestedMath), false);
  } finally {
    restore();
  }
});

test("Gartner profile collects distributed article text without embedded lead forms", () => {
  const restore = installDom(`
    <main>
      <div class="globalsite cmp-globalsite-articletext">
        <article class="article-text grid-norm"><span class="rte">
          <p id="gartner-intro">${articleParagraph("Gartner introduction")}</p>
        </span></article>
      </div>
      <section class="embedded-form">
        <p id="gartner-form">See the major CIO challenges reported by Gartner clients and provide your work email to continue.</p>
        <div class="privacy-policy"><p id="gartner-privacy">By clicking Continue, you agree to the Gartner Terms of Use and Privacy Policy.</p></div>
      </section>
      <div class="globalsite cmp-globalsite-articletext">
        <article class="article-text grid-norm"><span class="rte">
          <p id="gartner-body">${articleParagraph("Gartner body")}</p>
        </span></article>
      </div>
    </main>
    <section class="promoted-conference">
      <p id="gartner-promo">Experience Gartner conferences with exclusive insights, curated sessions, and peer networking.</p>
    </section>
  `, "www.gartner.com");
  try {
    assert.deepEqual(collectParagraphs().map((node) => node.id), [
      "gartner-intro",
      "gartner-body",
    ]);
  } finally {
    restore();
  }
});

test("Gartner document reader collects div-based sections and captions", () => {
  const restore = installDom(`
    <section class="Analysis">
      <h2>Analysis</h2>
      <div id="gartner-analysis" class="para"><span>${articleParagraph("Gartner analysis")}</span></div>
      <div id="gartner-empty" class="para"><span></span></div>
      <div class="para">
        <div class="caption"><span id="gartner-caption" class="heading" role="heading">
          Figure 1: Key Trends in Enterprise Network Services in the Era of AI
        </span></div>
      </div>
      <ul class="bullets-yes"><li>
        <div id="gartner-bullet" class="para"><span>${articleParagraph("Gartner bullet")}</span></div>
      </li></ul>
      <blockquote class="bq">
        <div id="gartner-quote" class="para"><span>${articleParagraph("Gartner quotation")}</span></div>
      </blockquote>
    </section>
    <section class="KeyFindings">
      <h3>Key Findings</h3>
      <ul class="bullets-yes"><li>
        <div id="gartner-key-finding" class="para"><span>${articleParagraph("Gartner key finding")}</span></div>
      </li></ul>
    </section>
  `, "www.gartner.com");
  try {
    assert.deepEqual(collectParagraphs().map((node) => node.id), [
      "gartner-analysis",
      "gartner-caption",
      "gartner-bullet",
      "gartner-quote",
      "gartner-key-finding",
    ]);
  } finally {
    restore();
  }
});

test("Readability adapter returns original live elements without mutating the source document", () => {
  const restore = installDom(`
    <html><head><title>Unknown-host research article</title></head><body>
      <article>
        <p id="first">${articleParagraph("first")}</p>
        <p id="second">${articleParagraph("second")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    const before = document.documentElement.outerHTML;
    const originals = [
      document.querySelector<HTMLElement>("#first")!,
      document.querySelector<HTMLElement>("#second")!,
    ];

    const actual = collectReadabilitySourceElements(document);

    assert.deepEqual(actual.map((node) => node.id), ["first", "second"]);
    assert.strictEqual(actual[0], originals[0]);
    assert.strictEqual(actual[1], originals[1]);
    assert.equal(actual[0].ownerDocument, document);
    assert.equal(document.contains(actual[0]), true);
    assert.equal(document.documentElement.outerHTML, before);
    assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
  } finally {
    restore();
  }
});

test("Readability adapter preserves distinct original elements with repeated text", () => {
  const repeated = articleParagraph("The repeated paragraph");
  const restore = installDom(`
    <html><head><title>Repeated-text research article</title></head><body>
      <article>
        <p id="first">${repeated}</p>
        <p id="second">${repeated}</p>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    const originals = [
      document.querySelector<HTMLElement>("#first")!,
      document.querySelector<HTMLElement>("#second")!,
    ];

    const actual = collectReadabilitySourceElements(document);

    assert.deepEqual(actual.map((node) => node.id), ["first", "second"]);
    assert.strictEqual(actual[0], originals[0]);
    assert.strictEqual(actual[1], originals[1]);
    assert.notStrictEqual(actual[0], actual[1]);
  } finally {
    restore();
  }
});

test("Readability adapter ignores page-owned source marker collisions", () => {
  const restore = installDom(`
    <html><head><title>Marker collision research article</title></head><body>
      <article>
        <p id="first">
          ${articleParagraph("first")}
          <span id="page-marker" data-paperlens-source-id="1">Publisher-owned marker metadata.</span>
        </p>
        <aside class="sidebar">
          <p id="removed">${articleParagraph("sidebar")}</p>
        </aside>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    const before = document.documentElement.outerHTML;
    const first = document.querySelector<HTMLElement>("#first")!;
    const removed = document.querySelector<HTMLElement>("#removed")!;
    const pageMarker = document.querySelector<HTMLElement>("#page-marker")!;

    const actual = collectReadabilitySourceElements(document);

    assert.deepEqual(actual.map((node) => node.id), ["first"]);
    assert.strictEqual(actual[0], first);
    assert.equal(actual.includes(removed), false);
    assert.equal(pageMarker.getAttribute("data-paperlens-source-id"), "1");
    assert.equal(document.documentElement.outerHTML, before);
  } finally {
    restore();
  }
});

test("Readability adapter keeps innermost eligible leaves and source DOM order", () => {
  const restore = installDom(`
    <html><head><title>Mixed academic markup article</title></head><body>
      <article>
        <div class="NLM_p" id="nlm">${articleParagraph("NLM paragraph")}</div>
        <figure>
          <figcaption id="caption">
            <p id="caption-paragraph">${articleParagraph("figure caption")}</p>
          </figcaption>
        </figure>
        <div class="Para" id="para">${articleParagraph("Para paragraph")}</div>
        <div class="paragraph-element" id="nested-wrapper">
          <p id="nested-paragraph">${articleParagraph("nested paragraph")}</p>
        </div>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    const beforeHtml = document.documentElement.outerHTML;
    const beforeText = document.documentElement.textContent;
    const expected = [
      document.querySelector<HTMLElement>("#nlm")!,
      document.querySelector<HTMLElement>("#caption-paragraph")!,
      document.querySelector<HTMLElement>("#para")!,
      document.querySelector<HTMLElement>("#nested-paragraph")!,
    ];

    const actual = collectReadabilitySourceElements(document);

    assert.deepEqual(actual.map((node) => node.id), [
      "nlm",
      "caption-paragraph",
      "para",
      "nested-paragraph",
    ]);
    actual.forEach((node, index) => assert.strictEqual(node, expected[index]));
    assert.equal(actual.includes(document.querySelector<HTMLElement>("#caption")!), false);
    assert.equal(actual.includes(document.querySelector<HTMLElement>("#nested-wrapper")!), false);
    assert.equal(document.documentElement.outerHTML, beforeHtml);
    assert.equal(document.documentElement.textContent, beforeText);
    assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
  } finally {
    restore();
  }
});

test("Readability adapter keeps independent lower-tier siblings when their wrapper loses", () => {
  const restore = installDom(`
    <html><head><title>Mixed nested candidate article</title></head><body>
      <article>
        <div class="paragraph-wrapper" id="ranked-wrapper">
          <blockquote id="independent-quote">${articleParagraph("independent quotation")}</blockquote>
          <div class="html-p" id="ranked-paragraph">${articleParagraph("ranked paragraph")}</div>
        </div>
        <p id="stable">${articleParagraph("stable article body")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    assert.deepEqual(
      collectReadabilitySourceElements(document).map((node) => node.id),
      ["independent-quote", "ranked-paragraph", "stable"],
    );
  } finally {
    restore();
  }
});

test("Readability adapter resolves deeply nested candidates with linear ancestor reads", () => {
  const depth = 300;
  const nested = Array.from(
    { length: depth },
    (_, index) => `<div class="html-p" id="nested-${index}">`,
  ).join("");
  const restore = installDom(`
    <html><head><title>Deep candidate article</title></head><body>
      <article>${nested}${articleParagraph("deepest paragraph")}${"</div>".repeat(depth)}</article>
    </body></html>
  `, "unknown.example");

  let descriptorOwner: object | null = document.documentElement;
  let descriptor: PropertyDescriptor | undefined;
  while (descriptorOwner && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(descriptorOwner, "parentElement");
    if (!descriptor) descriptorOwner = Object.getPrototypeOf(descriptorOwner);
  }
  assert.ok(descriptorOwner);
  assert.ok(descriptor?.get);

  let parentElementReads = 0;
  Object.defineProperty(descriptorOwner, "parentElement", {
    ...descriptor,
    get(this: Element) {
      parentElementReads += 1;
      return descriptor!.get!.call(this);
    },
  });

  try {
    assert.deepEqual(
      collectReadabilitySourceElements(document).map((node) => node.id),
      [`nested-${depth - 1}`],
    );
    assert.ok(
      parentElementReads < depth * 10,
      `expected linear ancestor reads, received ${parentElementReads}`,
    );
  } finally {
    Object.defineProperty(descriptorOwner, "parentElement", descriptor);
    restore();
  }
});

test("Readability adapter does not fabricate spaces between fragmented inline text nodes", () => {
  const fragments = Array.from({ length: 41 }, () => "<span>x</span>").join("");
  const restore = installDom(`
    <html><head><title>Fragmented inline text article</title></head><body>
      <article>
        <div id="fragmented-inline">${fragments}</div>
        <p id="body">${articleParagraph("stable article body")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    assert.deepEqual(
      collectReadabilitySourceElements(document).map((node) => node.id),
      ["body"],
    );
  } finally {
    restore();
  }
});

test("Readability adapter applies the structural text boundary at 80 characters", () => {
  const restore = installDom(`
    <html><head><title>Structural text boundary article</title></head><body>
      <article>
        <div id="below-boundary">${"a".repeat(79)}</div>
        <div id="at-boundary">${"b".repeat(80)}</div>
        <p id="body">${articleParagraph("stable article body")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    assert.deepEqual(
      collectReadabilitySourceElements(document).map((node) => node.id),
      ["at-boundary", "body"],
    );
  } finally {
    restore();
  }
});

test("Readability adapter excludes non-flow element text from structural measurement", () => {
  const nonFlowText = "x".repeat(100);
  const restore = installDom(`
    <html><head><title>Non-flow text article</title></head><body>
      <article>
        <div id="non-flow-only">
          <script>${nonFlowText}</script>
          <style>${nonFlowText}</style>
          <template>${nonFlowText}</template>
          <noscript>${nonFlowText}</noscript>
          <span>visible</span>
        </div>
        <p id="body">${articleParagraph("stable article body")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    assert.deepEqual(
      collectReadabilitySourceElements(document).map((node) => node.id),
      ["body"],
    );
  } finally {
    restore();
  }
});

test("Readability adapter preserves explicit paragraph leaves inside structural skip ancestors", () => {
  const restore = installDom(`
    <html><head><title>Table paragraph article</title></head><body>
      <article>
        <p id="before">${articleParagraph("body before table")}</p>
        <table><tbody><tr><td>
          <p id="table-paragraph">${articleParagraph("paragraph inside data table")}</p>
        </td></tr></tbody></table>
        <p id="after">${articleParagraph("body after table")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  try {
    assert.deepEqual(
      collectReadabilitySourceElements(document).map((node) => node.id),
      ["before", "table-paragraph", "after"],
    );
  } finally {
    restore();
  }
});

test("Readability adapter preflights the source element limit before cloning", () => {
  const secret = "PRE-FLIGHT-ARTICLE-SECRET";
  const restore = installDom(`
    <html><head><title>Bounded research article</title></head><body>
      <article><p id="first">${articleParagraph(secret)}</p></article>
    </body></html>
  `, "unknown.example");
  const originalGetElementsByTagName = document.getElementsByTagName;
  const originalCloneNode = document.cloneNode;
  const originalDebug = console.debug;
  const hadChrome = Object.prototype.hasOwnProperty.call(globalThis, "chrome");
  const originalChrome = globalThis.chrome;
  const diagnostics: unknown[][] = [];
  let cloneCalls = 0;

  try {
    Object.defineProperty(document, "getElementsByTagName", {
      configurable: true,
      writable: true,
      value: (tagName: string) => tagName === "*"
        ? { length: 100_001 }
        : originalGetElementsByTagName.call(document, tagName),
    });
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: () => {
        cloneCalls += 1;
        throw new Error(secret);
      },
    });
    console.debug = (...args: unknown[]) => diagnostics.push(args);
    Reflect.deleteProperty(globalThis, "chrome");

    assert.deepEqual(collectReadabilitySourceElements(document), []);
    assert.equal(cloneCalls, 0);
    assert.deepEqual(diagnostics, []);

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { runtime: { id: "paperlens-test-extension" } },
    });
    assert.deepEqual(collectReadabilitySourceElements(document), []);
    assert.equal(cloneCalls, 0);
    assert.deepEqual(diagnostics, [[
      "PaperLens: Readability fallback skipped",
      "preflight-limit",
    ]]);
    assert.equal(JSON.stringify(diagnostics).includes(secret), false);
  } finally {
    Object.defineProperty(document, "getElementsByTagName", {
      configurable: true,
      writable: true,
      value: originalGetElementsByTagName,
    });
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    console.debug = originalDebug;
    if (hadChrome) {
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: originalChrome,
      });
    } else {
      Reflect.deleteProperty(globalThis, "chrome");
    }
    restore();
  }
});

test("Readability adapter caps eligible source candidates before cloning", () => {
  const secret = "CANDIDATE-LIMIT-ARTICLE-SECRET";
  const paragraphs = Array.from(
    { length: 10_001 },
    (_, index) => `<p id="candidate-${index}">${index === 0 ? secret : "short"}</p>`,
  ).join("");
  const restore = installDom(`<html><body><article>${paragraphs}</article></body></html>`, "unknown.example");
  const originalCloneNode = document.cloneNode;
  const originalDebug = console.debug;
  const hadChrome = Object.prototype.hasOwnProperty.call(globalThis, "chrome");
  const originalChrome = globalThis.chrome;
  const diagnostics: unknown[][] = [];
  let cloneCalls = 0;

  try {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: () => {
        cloneCalls += 1;
        throw new Error(secret);
      },
    });
    console.debug = (...args: unknown[]) => diagnostics.push(args);
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { runtime: { id: "paperlens-test-extension" } },
    });

    assert.deepEqual(collectReadabilitySourceElements(document), []);
    assert.equal(cloneCalls, 0);
    assert.deepEqual(diagnostics, [[
      "PaperLens: Readability fallback skipped",
      "candidate-limit",
    ]]);
    assert.equal(JSON.stringify(diagnostics).includes(secret), false);
  } finally {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    console.debug = originalDebug;
    if (hadChrome) {
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: originalChrome,
      });
    } else {
      Reflect.deleteProperty(globalThis, "chrome");
    }
    restore();
  }
});

test("Readability adapter keeps stable paragraphs carrier-free at the source budget", () => {
  const restore = installDom(`
    <html><head><title>Carrier budget research article</title></head><body>
      <article>
        <p id="stable">${articleParagraph("stable paragraph")}</p>
        <div class="NLM_p" id="unstable">${articleParagraph("unstable NLM paragraph")}</div>
      </article>
    </body></html>
  `, "unknown.example");
  const originalGetElementsByTagName = document.getElementsByTagName;
  const originalCloneNode = document.cloneNode;
  const originalParse = Readability.prototype.parse;
  let stableCarrierCount = -1;
  let unstableCarrierCount = -1;

  try {
    Object.defineProperty(document, "getElementsByTagName", {
      configurable: true,
      writable: true,
      value: (tagName: string) => tagName === "*"
        ? { length: 100_000 }
        : originalGetElementsByTagName.call(document, tagName),
    });
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: () => {
        const clone = originalCloneNode.call(document, true) as Document;
        const cloneGetElementsByTagName = clone.getElementsByTagName;
        Object.defineProperty(clone, "getElementsByTagName", {
          configurable: true,
          writable: true,
          value: (tagName: string) => tagName === "*"
            ? { length: 100_001 }
            : cloneGetElementsByTagName.call(clone, tagName),
        });
        return clone;
      },
    });
    Object.defineProperty(Readability.prototype, "parse", {
      configurable: true,
      writable: true,
      value: function (this: Readability<unknown>) {
        const clone = (this as unknown as { _doc: Document })._doc;
        stableCarrierCount = clone.querySelectorAll(
          "#stable > span[data-paperlens-source-id]",
        ).length;
        unstableCarrierCount = clone.querySelectorAll(
          "#unstable > span[data-paperlens-source-id]",
        ).length;
        return originalParse.call(this);
      },
    });

    const actual = collectReadabilitySourceElements(document);

    assert.equal(stableCarrierCount, 0);
    assert.equal(unstableCarrierCount, 1);
    assert.deepEqual(actual.map((node) => node.id), ["stable", "unstable"]);
    actual.forEach((node) => {
      assert.equal(node.ownerDocument, document);
      assert.equal(document.contains(node), true);
    });
  } finally {
    Object.defineProperty(document, "getElementsByTagName", {
      configurable: true,
      writable: true,
      value: originalGetElementsByTagName,
    });
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    Object.defineProperty(Readability.prototype, "parse", {
      configurable: true,
      writable: true,
      value: originalParse,
    });
    restore();
  }
});

test("Readability adapter reuses a successful unchanged mapping", () => {
  const restore = installDom(`
    <html><head><title>Cached research article</title></head><body>
      <article>
        <p id="first">${articleParagraph("first cached paragraph")}</p>
        <p id="second">${articleParagraph("second cached paragraph")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  const originalCloneNode = document.cloneNode;
  let cloneCalls = 0;

  try {
    const before = document.documentElement.outerHTML;
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: (deep?: boolean) => {
        cloneCalls += 1;
        return originalCloneNode.call(document, deep);
      },
    });

    const first = collectReadabilitySourceElements(document);
    const second = collectReadabilitySourceElements(document);

    assert.equal(cloneCalls, 1);
    assert.notStrictEqual(first, second);
    assert.deepEqual(first.map((node) => node.id), ["first", "second"]);
    assert.deepEqual(second, first);
    second.forEach((node, index) => {
      assert.strictEqual(node, first[index]);
      assert.equal(node.ownerDocument, document);
      assert.equal(document.contains(node), true);
    });
    assert.equal(document.documentElement.outerHTML, before);
  } finally {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    restore();
  }
});

test("Readability adapter ignores PaperLens mutations and invalidates publisher mutations", () => {
  const restore = installDom(`
    <html><head><title>Mutation-aware cached research article</title></head><body>
      <article>
        <p id="first">${articleParagraph("first mutation-aware paragraph")}</p>
        <p id="second">${articleParagraph("second mutation-aware paragraph")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  const originalCloneNode = document.cloneNode;
  let cloneCalls = 0;

  try {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: (deep?: boolean) => {
        cloneCalls += 1;
        return originalCloneNode.call(document, deep);
      },
    });
    const article = document.querySelector<HTMLElement>("article")!;
    const firstParagraph = document.querySelector<HTMLElement>("#first")!;

    const initial = collectReadabilitySourceElements(document);
    firstParagraph.setAttribute("data-paperlens-id", "paragraph-1");
    const translation = createTranslationBlock(firstParagraph, "paragraph-1");
    translation.textContent = "Translated PaperLens interface text.";
    const summary = document.createElement("aside");
    summary.className = "paperlens-summary";
    summary.textContent = "PaperLens summary interface text.";
    article.appendChild(summary);
    summary.textContent = "Updated PaperLens summary interface text.";

    const afterPaperLensMutations = collectReadabilitySourceElements(document);

    assert.equal(cloneCalls, 1);
    assert.deepEqual(afterPaperLensMutations, initial);
    afterPaperLensMutations.forEach((node, index) => assert.strictEqual(node, initial[index]));

    const publisherParagraph = document.createElement("p");
    publisherParagraph.id = "publisher-added";
    publisherParagraph.textContent = articleParagraph("publisher-added paragraph");
    article.appendChild(publisherParagraph);

    const afterPublisherMutation = collectReadabilitySourceElements(document);

    assert.equal(cloneCalls, 2);
    assert.deepEqual(afterPublisherMutation.map((node) => node.id), [
      "first",
      "second",
      "publisher-added",
    ]);
    assert.strictEqual(afterPublisherMutation[2], publisherParagraph);
    afterPublisherMutation.forEach((node) => {
      assert.equal(node.ownerDocument, document);
      assert.equal(document.contains(node), true);
    });
    assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
  } finally {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    restore();
  }
});

test("public collection reparses when an eligible non-paragraph is reparented into the article", async () => {
  const restore = installDom(`
    <html><head><title>Reparented research article</title></head><body>
      <article id="article"><p id="main">${articleParagraph("main reparenting paragraph")}</p><aside class="related-content"><div role="paragraph" id="moved">${articleParagraph("moved reparenting paragraph")}</div></aside></article>
    </body></html>
  `, "unknown.example");
  const originalCloneNode = document.cloneNode;
  let cloneCalls = 0;

  try {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: (deep?: boolean) => {
        cloneCalls += 1;
        return originalCloneNode.call(document, deep);
      },
    });
    const article = document.querySelector<HTMLElement>("#article")!;
    const moved = document.querySelector<HTMLElement>("#moved")!;

    assert.deepEqual(collectParagraphs().map((node) => node.id), ["main"]);
    assert.equal(cloneCalls, 1);

    article.appendChild(moved);
    await Promise.resolve();

    const afterMove = collectParagraphs();

    assert.equal(cloneCalls, 2);
    assert.deepEqual(afterMove.map((node) => node.id), ["main", "moved"]);
    assert.strictEqual(afterMove[1], moved);
    afterMove.forEach((node) => {
      assert.equal(node.ownerDocument, document);
      assert.equal(document.contains(node), true);
    });
    assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
  } finally {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    restore();
  }
});

test("Readability cache invalidates publisher text moved beside PaperLens mutation noise", async () => {
  const restore = installDom(`
    <html><head><title>Publisher text mutation article</title></head><body>
      <article>
        <p id="first">${articleParagraph("first publisher text paragraph")}</p>
        <p id="second">${articleParagraph("second publisher text paragraph")}</p>
      </article>
    </body></html>
  `, "unknown.example");
  const originalCloneNode = document.cloneNode;
  let cloneCalls = 0;

  try {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: (deep?: boolean) => {
        cloneCalls += 1;
        return originalCloneNode.call(document, deep);
      },
    });
    const article = document.querySelector<HTMLElement>("article")!;
    const first = document.querySelector<HTMLElement>("#first")!;

    assert.equal(collectReadabilitySourceElements(document).length, 2);
    assert.equal(cloneCalls, 1);

    const summary = document.createElement("aside");
    summary.className = "paperlens-summary";
    summary.textContent = "Detached PaperLens mutation noise.";
    article.appendChild(summary);
    const detachedPublisherContainer = document.createElement("div");
    detachedPublisherContainer.appendChild(first.firstChild!);
    await Promise.resolve();

    collectReadabilitySourceElements(document);

    assert.equal(cloneCalls, 2);
  } finally {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    restore();
  }
});

test("Readability adapter keeps Node quiet but reports clone failures in extension runtime", () => {
  const secret = "CLONE-FAILURE-ARTICLE-SECRET";
  const restore = installDom(`
    <html><head><title>Clone failure research article</title></head><body>
      <article><p id="first">${articleParagraph(secret)}</p></article>
    </body></html>
  `, "unknown.example");
  const originalCloneNode = document.cloneNode;
  const originalDebug = console.debug;
  const hadChrome = Object.prototype.hasOwnProperty.call(globalThis, "chrome");
  const originalChrome = globalThis.chrome;
  const diagnostics: unknown[][] = [];

  try {
    const before = document.documentElement.outerHTML;
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error(secret);
      },
    });
    console.debug = (...args: unknown[]) => diagnostics.push(args);

    const actual = collectReadabilitySourceElements(document);

    assert.deepEqual(actual, []);
    assert.equal(document.documentElement.outerHTML, before);
    assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
    assert.deepEqual(diagnostics, []);

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { runtime: { id: "paperlens-test-extension" } },
    });
    assert.deepEqual(collectReadabilitySourceElements(document), []);
    assert.deepEqual(diagnostics, [[
      "PaperLens: Readability fallback skipped",
      "unexpected-error",
    ]]);
    assert.equal(JSON.stringify(diagnostics).includes(secret), false);
    assert.equal(document.documentElement.outerHTML, before);
    assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
  } finally {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    console.debug = originalDebug;
    if (hadChrome) {
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: originalChrome,
      });
    } else {
      Reflect.deleteProperty(globalThis, "chrome");
    }
    restore();
  }
});

test("Readability adapter reports bounded mapping faults without article content", () => {
  const originalDebug = console.debug;
  const hadChrome = Object.prototype.hasOwnProperty.call(globalThis, "chrome");
  const originalChrome = globalThis.chrome;
  const faultCases: Array<{
    reason: "clone-source-mismatch" | "null-parse" | "lost-marker-mapping";
    installFault: () => () => void;
  }> = [
    {
      reason: "clone-source-mismatch",
      installFault: () => {
        const originalCloneNode = document.cloneNode;
        Object.defineProperty(document, "cloneNode", {
          configurable: true,
          writable: true,
          value: (deep?: boolean) => {
            const clone = originalCloneNode.call(document, deep) as Document;
            clone.querySelector("#second")?.remove();
            return clone;
          },
        });
        return () => Object.defineProperty(document, "cloneNode", {
          configurable: true,
          writable: true,
          value: originalCloneNode,
        });
      },
    },
    {
      reason: "null-parse",
      installFault: () => {
        const originalParse = Readability.prototype.parse;
        Object.defineProperty(Readability.prototype, "parse", {
          configurable: true,
          writable: true,
          value: () => null,
        });
        return () => Object.defineProperty(Readability.prototype, "parse", {
          configurable: true,
          writable: true,
          value: originalParse,
        });
      },
    },
    {
      reason: "lost-marker-mapping",
      installFault: () => {
        const originalParse = Readability.prototype.parse;
        Object.defineProperty(Readability.prototype, "parse", {
          configurable: true,
          writable: true,
          value: () => {
            const content = document.createElement("article");
            content.textContent = "LOST-MARKER-PARSED-CONTENT-SECRET";
            return { content };
          },
        });
        return () => Object.defineProperty(Readability.prototype, "parse", {
          configurable: true,
          writable: true,
          value: originalParse,
        });
      },
    },
  ];

  try {
    for (const faultCase of faultCases) {
      const secret = `${faultCase.reason.toUpperCase()}-ARTICLE-CONTENT-SECRET`;
      const restoreDom = installDom(`
        <html><head><title>Fault diagnostics research article</title></head><body>
          <article>
            <p id="first">${articleParagraph(secret)}</p>
            <p id="second">${articleParagraph("second fault paragraph")}</p>
          </article>
        </body></html>
      `, "unknown.example");
      const restoreFault = faultCase.installFault();
      const diagnostics: unknown[][] = [];
      console.debug = (...args: unknown[]) => diagnostics.push(args);

      try {
        Reflect.deleteProperty(globalThis, "chrome");
        assert.deepEqual(collectReadabilitySourceElements(document), [], faultCase.reason);
        assert.deepEqual(diagnostics, [], `${faultCase.reason}: Node must stay quiet`);

        Object.defineProperty(globalThis, "chrome", {
          configurable: true,
          value: { runtime: { id: "paperlens-test-extension" } },
        });
        assert.deepEqual(collectReadabilitySourceElements(document), [], faultCase.reason);
        assert.deepEqual(diagnostics, [[
          "PaperLens: Readability fallback skipped",
          faultCase.reason,
        ]]);
        assert.equal(JSON.stringify(diagnostics).includes(secret), false);
        assert.equal(
          JSON.stringify(diagnostics).includes("LOST-MARKER-PARSED-CONTENT-SECRET"),
          false,
        );
      } finally {
        restoreFault();
        restoreDom();
      }
    }
  } finally {
    console.debug = originalDebug;
    if (hadChrome) {
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: originalChrome,
      });
    } else {
      Reflect.deleteProperty(globalThis, "chrome");
    }
  }
});

test("unknown academic hosts return semantic article leaves only", () => {
  assert.deepEqual(runFixture("unknown-semantic.html", "journal.example.edu"), [
    "unknown-abstract",
    "unknown-body-1",
    "unknown-caption",
    "unknown-body-2",
  ]);
});

test("generic live DOM collection keeps MDPI-style div paragraphs as original body nodes", () => {
  const restore = installDom(`
    <html><head><title>Journal example article</title></head><body>
      <article class="html-article-content">
        <div class="html-body">
          <section id="mdpi-introduction-section">
            <h2>Introduction</h2>
            <div class="html-p" id="mdpi-introduction">
              <span>${articleParagraph("The introduction")}</span>
              <a href="#citation-1">prior work</a><sup>1</sup>
            </div>
          </section>
          <section id="mdpi-results-section">
            <h2>Results</h2>
            <div class="html-p-wrapper" id="mdpi-paragraph-wrapper">
              <div class="html-p" id="mdpi-results">
                <span>${articleParagraph("The results")}</span>
                <a href="#citation-2">supporting evidence</a><sup>2</sup>
                <div class="html-equation" id="mdpi-equation">E = mc<sup>2</sup></div>
              </div>
            </div>
          </section>
        </div>
        <aside class="related-content" id="mdpi-related-content">
          <div class="html-p" id="mdpi-related">${articleParagraph("Related content")}</div>
        </aside>
        <section id="html-references_list">
          <div class="html-p" id="mdpi-reference">${articleParagraph("Reference content")}</div>
        </section>
      </article>
    </body></html>
  `, "journal.example");
  let block: HTMLElement | null = null;

  try {
    const before = document.documentElement.outerHTML;
    const expectedIds = ["mdpi-introduction", "mdpi-results"];
    const expected = expectedIds.map((id) => document.getElementById(id) as HTMLElement);
    const wrapper = document.getElementById("mdpi-paragraph-wrapper") as HTMLElement;
    const related = document.getElementById("mdpi-related") as HTMLElement;
    const reference = document.getElementById("mdpi-reference") as HTMLElement;

    const actual = collectParagraphs();

    assert.deepEqual(actual.map((node) => node.id), expectedIds);
    actual.forEach((node, index) => {
      assert.strictEqual(node, expected[index]);
      assert.equal(node.ownerDocument, document);
      assert.equal(document.contains(node), true);
    });
    assert.equal(actual.includes(wrapper), false);
    assert.equal(actual.includes(related), false);
    assert.equal(actual.includes(reference), false);
    assert.equal(document.documentElement.outerHTML, before);
    assert.equal(document.querySelector("[data-paperlens-source-id]"), null);

    const source = actual[1];
    const paperlensId = "mdpi-results-paperlens";
    assert.equal(source.matches("div.html-p"), true);
    block = createTranslationBlock(source, paperlensId);
    assert.strictEqual(source.nextElementSibling, block);
    assert.equal(block.getAttribute("data-paperlens-block"), paperlensId);
    block.remove();
    block = null;
    assert.equal(document.documentElement.outerHTML, before);
  } finally {
    block?.remove();
    restore();
  }
});

test("committed Nature profile merges its abstract with generic layout recovery", () => {
  assert.deepEqual(runFixture("known-partial-layout.html", "journal.example.edu"), [
    "partial-body-1",
    "partial-caption",
    "partial-body-2",
  ]);
  assert.deepEqual(runFixture("known-partial-layout.html", "www.nature.com"), [
    "partial-abstract",
    "partial-body-1",
    "partial-caption",
    "partial-body-2",
  ]);
});

test("paywall-only pages expose no translatable article leaves", () => {
  assert.deepEqual(runFixture("paywall-only.html", "journal.example.edu"), []);
});

test("article terminology containing subscription or login remains translatable", () => {
  assert.deepEqual(runFixture("legitimate-auth-terminology.html", "journal.example.edu"), [
    "legitimate-subscription-class",
    "legitimate-subscription-id",
    "legitimate-login-class",
  ]);
});

test("unknown academic hosts exclude related cards and access gates inside the article", () => {
  const html = readFileSync(
    resolve("tests/fixtures/academic/fallback", "unknown-related-access.html"),
    "utf8",
  );
  const restore = installDom(html, "journal.example.edu");
  try {
    const expectedIds = [
      "access-body",
      "legitimate-subscription-content",
      "legitimate-login-analysis",
      "legitimate-signin-analysis",
      "legitimate-open-access",
    ];
    const forbiddenIds = [
      "related-article-card",
      "purchase-access-prompt",
      "signin-prompt",
      "sign-in-prompt",
      "subscription-access-prompt",
      "access-gate-prompt",
      "purchase-access-id-prompt",
      "signin-id-prompt",
      "sign-in-id-prompt",
      "subscription-access-id-prompt",
      "access-gate-id-prompt",
    ];
    const expected = expectedIds.map((id) => document.getElementById(id) as HTMLElement);
    forbiddenIds.forEach((id) => assert.ok(document.getElementById(id)));
    const before = document.documentElement.outerHTML;

    const actual = collectParagraphs();

    assert.deepEqual(actual.map((node) => node.id), expectedIds);
    assert.deepEqual(actual, expected);
    assert.equal(actual.some((node) => forbiddenIds.includes(node.id)), false);
    assert.equal(document.documentElement.outerHTML, before);
  } finally {
    restore();
  }
});

test("filtered-only generic candidates trigger the document-wide fallback", () => {
  assert.deepEqual(runFixture("filtered-generic-fallback.html", "journal.example.edu"), [
    "fallback-available",
  ]);
});

test("translated reader wrapper reactivates document fallback after marker suppression", () => {
  const restore = installDom(`
    <html><head><title>Translated reader evidence article</title></head><body>
      <article>
        <div id="reader-wrapper">
          <span id="translated-child" data-paperlens-id="translated-child">
            ${articleParagraph("Already translated reader passage")}
          </span>
        </div>
      </article>
      <div class="sidebar-panel">
        <p id="fallback-only">${articleParagraph("Independent fallback passage")}</p>
      </div>
    </body></html>
  `, "journal.example.edu");
  try {
    const wrapper = document.querySelector<HTMLElement>("#reader-wrapper")!;
    const translated = document.querySelector<HTMLElement>("#translated-child")!;
    const fallback = document.querySelector<HTMLElement>("#fallback-only")!;

    const actual = collectParagraphs();

    assert.deepEqual(actual.map((node) => node.id), ["fallback-only"]);
    assert.strictEqual(actual[0], fallback);
    assert.equal(actual[0].ownerDocument, document);
    assert.equal(document.contains(actual[0]), true);
    assert.equal(actual.includes(wrapper), false);
    assert.equal(actual.includes(translated), false);
  } finally {
    restore();
  }
});

test("document fallback excludes translation and summary UI paragraphs", () => {
  const restore = installDom(`
    <html><head><title>PaperLens UI fallback boundary</title></head><body>
      <div class="paperlens-translation">
        <p id="translation-ui">${articleParagraph("PaperLens translated output")}</p>
      </div>
      <div class="paperlens-summary">
        <p id="summary-ui">${articleParagraph("PaperLens summary output")}</p>
      </div>
      <p id="external-fallback">${articleParagraph("External fallback passage")}</p>
    </body></html>
  `, "journal.example.edu");
  const originalCloneNode = document.cloneNode;
  try {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("forced fallback path");
      },
    });
    const translationUi = document.querySelector<HTMLElement>("#translation-ui")!;
    const summaryUi = document.querySelector<HTMLElement>("#summary-ui")!;
    const external = document.querySelector<HTMLElement>("#external-fallback")!;

    const actual = collectParagraphs();

    assert.deepEqual(actual.map((node) => node.id), ["external-fallback"]);
    assert.strictEqual(actual[0], external);
    assert.equal(actual[0].ownerDocument, document);
    assert.equal(document.contains(actual[0]), true);
    assert.equal(actual.includes(translationUi), false);
    assert.equal(actual.includes(summaryUi), false);
  } finally {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    restore();
  }
});

test("translated markers are optional without changing live-node identity or order", () => {
  const html = readFileSync(
    resolve("tests/fixtures/academic/fallback", "unknown-semantic.html"),
    "utf8",
  );
  const restore = installDom(html, "journal.example.edu");
  try {
    const bodyParagraph = document.querySelector<HTMLElement>("#unknown-body-1")!;
    bodyParagraph.setAttribute("data-paperlens-id", "existing");

    assert.deepEqual(collectParagraphs().map((node) => node.id), [
      "unknown-abstract",
      "unknown-caption",
      "unknown-body-2",
    ]);

    const included = collectParagraphs({ includeTranslatedParagraphs: true });
    assert.deepEqual(included.map((node) => node.id), [
      "unknown-abstract",
      "unknown-body-1",
      "unknown-caption",
      "unknown-body-2",
    ]);
    assert.strictEqual(included[1], bodyParagraph);
  } finally {
    restore();
  }
});

test("translated nested publisher leaves do not resurface through their wrappers", () => {
  const html = readFileSync(
    resolve("tests/fixtures/academic/profiles", "wiley.html"),
    "utf8",
  );
  const restore = installDom(html, "onlinelibrary.wiley.com");
  try {
    const leaf = document.querySelector<HTMLElement>("#w-paragraph-div")!;
    leaf.setAttribute("data-paperlens-id", "translated-nested-leaf");

    const untranslated = collectParagraphs();

    assert.deepEqual(untranslated.map((node) => node.id), ["w-body1", "w-figcap"]);
    assert.equal(untranslated.includes(leaf), false);
    assert.equal(
      untranslated.includes(document.querySelector<HTMLElement>("#w-paragraph-wrapper")!),
      false,
    );

    const all = collectParagraphs({ includeTranslatedParagraphs: true });
    assert.deepEqual(all.map((node) => node.id), ["w-body1", "w-figcap", "w-paragraph-div"]);
    assert.strictEqual(all[2], leaf);
  } finally {
    restore();
  }
});

test("ACS marked nested leaves survive Readability clone failure through public arbitration", () => {
  const html = readFileSync(
    resolve("tests/fixtures/academic/profiles", "acs.html"),
    "utf8",
  );
  const restore = installDom(html, "pubs.acs.org");
  const originalCloneNode = document.cloneNode;

  try {
    const body = document.querySelector<HTMLElement>("#acs-body1")!;
    const caption = document.querySelector<HTMLElement>("#acs-caption")!;
    const leaf = document.querySelector<HTMLElement>("#acs-nlm-div")!;
    const wrapper = document.querySelector<HTMLElement>("#acs-nlm-wrapper")!;
    leaf.setAttribute("data-paperlens-id", "translated-acs-leaf");
    const before = document.documentElement.outerHTML;
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("forced ACS clone failure");
      },
    });

    const untranslated = collectParagraphs();

    assert.deepEqual(untranslated, [body, caption]);
    assert.equal(untranslated.includes(wrapper), false);

    const all = collectParagraphs({ includeTranslatedParagraphs: true });

    assert.deepEqual(all, [body, caption, leaf]);
    assert.strictEqual(all[2], leaf);
    assert.equal(all.includes(wrapper), false);
    all.forEach((node) => {
      assert.equal(node.ownerDocument, document);
      assert.equal(document.contains(node), true);
    });
    assert.equal(document.documentElement.outerHTML, before);
    assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
  } finally {
    Object.defineProperty(document, "cloneNode", {
      configurable: true,
      writable: true,
      value: originalCloneNode,
    });
    restore();
  }
});

test("sections group original fallback nodes under their preceding h2 headings", () => {
  const html = readFileSync(
    resolve("tests/fixtures/academic/fallback", "unknown-semantic.html"),
    "utf8",
  );
  const restore = installDom(html, "journal.example.edu");
  try {
    const originals = [
      document.querySelector<HTMLElement>("#unknown-abstract")!,
      document.querySelector<HTMLElement>("#unknown-body-1")!,
      document.querySelector<HTMLElement>("#unknown-caption")!,
      document.querySelector<HTMLElement>("#unknown-body-2")!,
    ];

    const sections = collectSections();

    assert.deepEqual(sections.map((section) => ({
      heading: section.heading,
      paragraphIds: section.paragraphs.map((node) => node.id),
    })), [
      { heading: "Abstract", paragraphIds: ["unknown-abstract"] },
      {
        heading: "Results",
        paragraphIds: ["unknown-body-1", "unknown-caption", "unknown-body-2"],
      },
    ]);
    assert.deepEqual(sections.flatMap((section) => section.paragraphs), originals);
    sections.flatMap((section) => section.paragraphs).forEach((node, index) => {
      assert.strictEqual(node, originals[index]);
    });
  } finally {
    restore();
  }
});

test("h3 and role headings create ordered semantic sections", () => {
  const restore = installDom(`
    <html><head><title>Semantic heading article</title></head><body>
      <article>
        <h3>Methods</h3>
        <p id="methods">${articleParagraph("Method details")}</p>
        <div role="heading">Findings</div>
        <p id="findings">${articleParagraph("Finding details")}</p>
      </article>
    </body></html>
  `, "journal.example.edu");
  try {
    assert.deepEqual(collectSections().map((section) => ({
      heading: section.heading,
      paragraphIds: section.paragraphs.map((node) => node.id),
    })), [
      { heading: "Methods", paragraphIds: ["methods"] },
      { heading: "Findings", paragraphIds: ["findings"] },
    ]);
  } finally {
    restore();
  }
});

test("nested heading scope returns following anchors to the eligible outer heading", () => {
  const restore = installDom(`
    <html><head><title>Nested semantic heading article</title></head><body>
      <article>
        <section>
          <h2>Outer discussion</h2>
          <p id="outer-before">${articleParagraph("Outer discussion before the nested section")}</p>
          <section>
            <h3>Nested analysis</h3>
            <p id="nested">${articleParagraph("Nested analysis details")}</p>
          </section>
          <p id="outer-after">${articleParagraph("Outer discussion after the nested section")}</p>
        </section>
      </article>
    </body></html>
  `, "journal.example.edu");
  try {
    assert.deepEqual(collectSections().map((section) => ({
      heading: section.heading,
      paragraphIds: section.paragraphs.map((node) => node.id),
    })), [
      { heading: "Outer discussion", paragraphIds: ["outer-before"] },
      { heading: "Nested analysis", paragraphIds: ["nested"] },
      { heading: "Outer discussion", paragraphIds: ["outer-after"] },
    ]);
  } finally {
    restore();
  }
});

test("equal heading text creates separate section occurrences", () => {
  const restore = installDom(`
    <html><head><title>Repeated semantic heading article</title></head><body>
      <article>
        <h2>Results</h2>
        <p id="first-results">${articleParagraph("First results occurrence")}</p>
        <h2>Results</h2>
        <p id="second-results">${articleParagraph("Second results occurrence")}</p>
      </article>
    </body></html>
  `, "journal.example.edu");
  try {
    assert.deepEqual(collectSections().map((section) => ({
      heading: section.heading,
      paragraphIds: section.paragraphs.map((node) => node.id),
    })), [
      { heading: "Results", paragraphIds: ["first-results"] },
      { heading: "Results", paragraphIds: ["second-results"] },
    ]);
  } finally {
    restore();
  }
});

test("excluded headings do not label a pre-heading passage", () => {
  const restore = installDom(`
    <html><head><title>Excluded semantic headings article</title></head><body>
      <nav><h2>Navigation</h2></nav>
      <article>
        <p id="after-navigation">${articleParagraph("Passage after navigation")}</p>
        <section id="references">
          <h2>References</h2>
          <p>${articleParagraph("Excluded reference passage")}</p>
        </section>
        <p id="resumed-discussion">${articleParagraph("Passage after the excluded material")}</p>
        <aside class="related-content"><h2>Related content</h2></aside>
        <p id="after-related">${articleParagraph("Passage after related content")}</p>
        <div class="paperlens-summary"><div role="heading">PaperLens summary</div></div>
        <p id="after-paperlens">${articleParagraph("Passage after PaperLens UI")}</p>
        <div class="paperlens-translation"><div role="heading">PaperLens translation</div></div>
        <p id="after-translation">${articleParagraph("Passage after PaperLens translation UI")}</p>
      </article>
    </body></html>
  `, "journal.example.edu");
  try {
    assert.deepEqual(collectSections().map((section) => ({
      heading: section.heading,
      paragraphIds: section.paragraphs.map((node) => node.id),
    })), [{
      heading: null,
      paragraphIds: [
        "after-navigation",
        "resumed-discussion",
        "after-related",
        "after-paperlens",
        "after-translation",
      ],
    }]);
  } finally {
    restore();
  }
});

test("Science profile exclusion scopes reject collateral headings", () => {
  const restore = installDom(`
    <html><head><title>Science profile semantic headings</title></head><body>
      <section id="bodymatter">
        <h2>Analysis</h2>
        <div id="science-body-before" role="paragraph">
          ${articleParagraph("Science body before collateral information")}
        </div>
        <aside id="core-collateral-info">
          <div role="heading">Collateral information</div>
          <div id="science-collateral" role="paragraph">
            ${articleParagraph("Excluded Science collateral information")}
          </div>
        </aside>
        <div id="science-body-after" role="paragraph">
          ${articleParagraph("Science body after collateral information")}
        </div>
      </section>
    </body></html>
  `, "www.science.org");
  try {
    assert.deepEqual(collectSections().map((section) => ({
      heading: section.heading,
      paragraphIds: section.paragraphs.map((node) => node.id),
    })), [{
      heading: "Analysis",
      paragraphIds: ["science-body-before", "science-body-after"],
    }]);
  } finally {
    restore();
  }
});

for (const fixture of PROFILE_CASES) {
  test(`academic profile contract: ${fixture.name}`, () => {
    const html = readFileSync(
      resolve("tests/fixtures/academic/profiles", fixture.file),
      "utf8",
    );
    if (fixture.profileOnlyId) {
      const restoreGenericHost = installDom(html, "journal.example.edu");
      try {
        const before = document.documentElement.outerHTML;
        const genericIds = collectParagraphs().map((node) => node.id);
        assert.equal(
          genericIds.includes(fixture.profileOnlyId),
          false,
          `${fixture.name}: ${fixture.profileOnlyId} must require its publisher profile`,
        );
        assert.equal(document.documentElement.outerHTML, before);
        assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
      } finally {
        restoreGenericHost();
      }
    }
    const restore = installDom(html, fixture.host);
    try {
      const before = document.documentElement.outerHTML;
      const expectedNodes = fixture.expectedIds.map((id) => {
        const element = document.getElementById(id);
        assert.ok(element, `${fixture.name}: missing expected fixture node ${id}`);
        return element;
      });
      fixture.forbiddenIds.forEach((id) => {
        assert.ok(
          document.getElementById(id),
          `${fixture.name}: missing forbidden fixture node ${id}`,
        );
      });

      const actual = collectParagraphs();

      assert.deepEqual(
        actual.map((node) => node.id),
        fixture.expectedIds,
        `${fixture.name}: exact extraction contract`,
      );
      actual.forEach((node, index) => {
        assert.strictEqual(node, expectedNodes[index]);
        assert.equal(node.ownerDocument, document);
        assert.equal(document.contains(node), true);
      });
      assert.equal(
        actual.some((node) => fixture.forbiddenIds.includes(node.id)),
        false,
      );
      assert.equal(document.documentElement.outerHTML, before);
      assert.equal(document.querySelector("[data-paperlens-source-id]"), null);
    } finally {
      restore();
    }
  });
}

for (const insertion of [
  {
    name: "paragraph",
    host: "journal.example.edu",
    id: "insertion-paragraph",
    html: `<p id="insertion-paragraph">${articleParagraph("paragraph insertion source")}</p>`,
  },
  {
    name: "NLM paragraph div",
    host: "pubs.acs.org",
    id: "insertion-nlm",
    html: `<div class="NLM_p" id="insertion-nlm">${articleParagraph("NLM insertion source")}</div>`,
  },
]) {
  test(`translation block inserts directly after the original ${insertion.name}`, () => {
    const restore = installDom(`
      <html><head><title>Translation insertion contract</title></head><body>
        <article>${insertion.html}</article>
      </body></html>
    `, insertion.host);
    const source = document.getElementById(insertion.id) as HTMLElement;
    const paperlensId = `${insertion.id}-paperlens`;
    const before = document.documentElement.outerHTML;
    let block: HTMLElement | null = null;

    try {
      source.setAttribute("data-paperlens-id", paperlensId);
      block = createTranslationBlock(source, paperlensId);

      assert.strictEqual(source.nextElementSibling, block);
      assert.equal(block.getAttribute("data-paperlens-block"), paperlensId);
      assert.strictEqual(
        collectParagraphs({ includeTranslatedParagraphs: true })
          .find((node) => node.id === source.id),
        source,
      );

      block.remove();
      block = null;
      source.removeAttribute("data-paperlens-id");
      assert.equal(document.documentElement.outerHTML, before);
    } finally {
      block?.remove();
      source.removeAttribute("data-paperlens-id");
      restore();
    }
  });
}
