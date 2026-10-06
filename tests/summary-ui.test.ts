import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import * as summaryBlock from "../src/content/summary-block";

type Kind = "paper" | "article";
type UiOptions = {
  onCancel?: () => void;
  onRetry?: () => void;
  onKindChange?: (kind: Kind) => void;
  kind?: Kind;
};
type UiApi = typeof summaryBlock & {
  createSummaryBlock(options?: UiOptions): HTMLElement;
  setSummaryBlockScope(block: HTMLElement, scope: {
    paragraphCount: number;
    sectionCount: number;
    captionCount: number;
    tableCount: number;
    partial: boolean;
    reasons: string[];
  }): void;
  setSummaryBlockSourceChanged(block: HTMLElement, onUpdate: () => void): void;
  setSummaryBlockCancelled(block: HTMLElement): void;
};
const ui = summaryBlock as UiApi;

function installDocument() {
  const { document, window } = parseHTML("<!doctype html><html><body><main><section id='abstract'>Original abstract</section><p>Original article</p></main></body></html>");
  const globals = { document, window, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    document,
    restore() {
      ui.removeSummaryBlock();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

const PAPER_SUMMARY = [
  "## 1. 핵심 요약",
  "관찰은 **반복 측정**에서 나타났지만 원인을 확정하지 못했다.",
  "## 2. 연구 문제",
  "응답 변화의 원인을 구분한다.",
  "## 3. 방법",
  "같은 조건에서 대조군을 비교했다.",
  "## 4. 핵심 근거와 결과",
  "- 응답이 2 V에서 달라졌다.",
  "- 원문 데이터로 확인했다.",
  "## 5. 해석 또는 메커니즘",
  "제안된 설명과 관찰을 구분한다.",
  "## 6. 한계",
  "추가 대조 실험이 필요하다.",
  "## 7. 학술적·실용적 의의",
  "후속 조건을 좁힌다.",
].join("\n\n");

test("summary uses the accepted source anchor instead of an earlier sidebar article card", () => {
  const harness = installDocument();
  try {
    harness.document.body.innerHTML = '<aside><article class="CardJournal"><p>Journal metrics</p></article></aside><main><div class="ArticleDetailsV4__main__content"><h2>Abstract</h2><p id="scientific">Scientific source.</p></div></main>';
    const source = harness.document.getElementById("scientific")!;
    const block = ui.createSummaryBlock({insertionAnchor: source});
    assert.ok(block.parentElement === source.parentElement, "summary must sit beside the accepted source, not journal cards");
    assert.ok(block.nextElementSibling === source);
    ui.setSummaryBlockScope(block, {paragraphCount:1,sectionCount:1,captionCount:0,tableCount:0,partial:true,reasons:["abstract-only"]});
    const scopeText = block.querySelector(".paperlens-summary-scope")!.textContent ?? "";
    assert.doesNotMatch(scopeText, /abstract-only/);
    assert.match(scopeText, /초록/);
    assert.match(scopeText, /정식 본문/);
  } finally {harness.restore();}
});

test("summary places the takeaway before evidence and folds interpretation without losing it", () => {
  const harness = installDocument();
  try {
    const block = ui.createSummaryBlock();
    ui.finalizeSummaryBlock(block, PAPER_SUMMARY);
    const takeaway = block.querySelector(".paperlens-summary-takeaway");
    assert.ok(takeaway, "a requested takeaway must have a readable opening");
    assert.match(takeaway.textContent ?? "", /관찰은 반복 측정/);
    assert.equal(takeaway.querySelector("strong")?.textContent, "반복 측정");
    const body = block.querySelector(".paperlens-summary-body")!;
    const headings = [...body.querySelectorAll("h3")].map((heading) => heading.textContent);
    assert.deepEqual(headings, ["핵심 요약", "연구 문제", "방법", "핵심 근거와 결과", "해석 또는 메커니즘", "한계", "학술적·실용적 의의"]);
    assert.equal(body.querySelectorAll("li").length, 2);
    const more = block.querySelector<HTMLDetailsElement>("details.paperlens-summary-more")!;
    assert.ok(more, "late paper sections remain available through a native disclosure");
    assert.equal(more.hasAttribute("open"), false);
    assert.match(more.textContent ?? "", /추가 대조 실험이 필요하다/);
    assert.equal(body.querySelector("h3")?.textContent, "핵심 요약");
    assert.equal(block.getAttribute("aria-busy"), "false");
    assert.ok(harness.document.body.firstElementChild === block, "the reading note precedes the original article");
    assert.equal(harness.document.querySelector("#abstract")?.textContent, "Original abstract");
  } finally {
    harness.restore();
  }
});

test("summary treats model HTML as text and creates only safe outbound links", () => {
  const harness = installDocument();
  try {
    const block = ui.createSummaryBlock();
    ui.finalizeSummaryBlock(block, [
      "1. 핵심 요약",
      '<img src=x onerror="alert(1)"> <script>alert(2)</script> **안전한 강조**',
      "[자료](https://example.org/paper) [실행](javascript:alert(1)) [데이터](data:text/html,attack) ![추적](https://example.org/pixel)",
    ].join("\n\n"));
    assert.equal(block.querySelectorAll("img, script, iframe, object, embed").length, 0);
    assert.match(block.textContent ?? "", /<script>alert\(2\)<\/script>/);
    assert.equal(block.querySelector("strong")?.textContent, "안전한 강조");
    const links = [...block.querySelectorAll("a")];
    assert.equal(links.length, 1, "unsafe links and remote image markup must not create executable or fetched elements");
    assert.equal(links[0].getAttribute("href"), "https://example.org/paper");
    assert.match(links[0].getAttribute("rel") ?? "", /noopener/);
    assert.equal(block.querySelectorAll("[onerror], [onclick]").length, 0);
  } finally {
    harness.restore();
  }
});

test("folding and copying preserve the complete summary including collapsed sections", async () => {
  const harness = installDocument();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let copiedText = "";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text: string) => { copiedText = text; } } },
  });
  try {
    const block = ui.createSummaryBlock();
    ui.finalizeSummaryBlock(block, PAPER_SUMMARY);
    const fold = block.querySelector<HTMLButtonElement>(".paperlens-summary-fold");
    assert.ok(fold, "the reader can fold a long inline summary");
    const body = block.querySelector<HTMLElement>(".paperlens-summary-body")!;
    fold.click();
    assert.equal(body.hidden, true);
    assert.equal(fold.getAttribute("aria-expanded"), "false");
    assert.equal(fold.getAttribute("aria-controls"), body.id);
    fold.click();
    assert.equal(body.hidden, false);
    assert.equal(fold.getAttribute("aria-expanded"), "true");
    const copy = block.querySelector<HTMLButtonElement>(".paperlens-summary-copy");
    assert.ok(copy, "the complete reading note can be copied");
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(copiedText, PAPER_SUMMARY);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
    harness.restore();
  }
});

test("scope reports captured counts and partial reasons without claiming all source content", () => {
  const harness = installDocument();
  try {
    const block = ui.createSummaryBlock();
    assert.equal(typeof ui.setSummaryBlockScope, "function", "scope is a required reader-visible contract");
    ui.setSummaryBlockScope(block, { paragraphCount: 12, sectionCount: 4, captionCount: 2, tableCount: 1, partial: true, reasons: ["유료 접근 제한이 감지되었습니다.", "<img onerror='attack'>"] });
    const scope = block.querySelector(".paperlens-summary-scope")!;
    assert.match(scope.textContent ?? "", /본문 12개/);
    assert.match(scope.textContent ?? "", /섹션 4개/);
    assert.match(scope.textContent ?? "", /그림 설명 2개/);
    assert.match(scope.textContent ?? "", /표 1개/);
    assert.match(scope.textContent ?? "", /유료 접근 제한/);
    assert.match(scope.textContent ?? "", /일부 원문/);
    assert.doesNotMatch(scope.textContent ?? "", /100\s*%|전체 원문을 읽/);
    assert.equal(scope.querySelectorAll("img").length, 0);
  } finally {
    harness.restore();
  }
});

test("retry and cancellation controls distinguish display cancellation from provider cancellation", () => {
  const harness = installDocument();
  let stopped = 0;
  let retried = 0;
  try {
    const block = ui.createSummaryBlock({ onCancel: () => { stopped += 1; }, onRetry: () => { retried += 1; } });
    const cancel = block.querySelector<HTMLButtonElement>(".paperlens-summary-cancel");
    assert.ok(cancel, "a generating result can stop displaying");
    assert.equal(cancel.textContent, "표시 중단");
    cancel.click();
    assert.equal(stopped, 1);
    assert.equal(block.getAttribute("aria-busy"), "false");
    assert.match(block.textContent ?? "", /이미 전송된 요청은 계속 처리될 수 있습니다/);
    ui.setSummaryBlockError(block, "서비스 연결에 실패했습니다.");
    const retry = block.querySelector<HTMLButtonElement>(".paperlens-summary-retry")!;
    assert.equal(retry.hidden, false);
    retry.click();
    assert.equal(retried, 1);
    const same = ui.createSummaryBlock({ onCancel: () => { stopped += 10; } });
    assert.strictEqual(same, block, "a rerun reuses the current inline position");
    assert.equal(harness.document.querySelectorAll("#paperlens-paper-summary").length, 1);
    assert.equal(block.getAttribute("aria-busy"), "true");
    block.querySelector<HTMLButtonElement>(".paperlens-summary-cancel")!.click();
    assert.equal(stopped, 11, "reruns must not retain obsolete callback listeners");
  } finally {
    harness.restore();
  }
});

test("source changes preserve the prior result until the reader explicitly updates", () => {
  const harness = installDocument();
  let updates = 0;
  const kinds: Kind[] = [];
  try {
    const block = ui.createSummaryBlock({ kind: "article", onKindChange: (kind) => { kinds.push(kind); } });
    ui.finalizeSummaryBlock(block, "## 핵심 내용\n\n이전 원문의 요약.");
    assert.equal(typeof ui.setSummaryBlockSourceChanged, "function");
    ui.setSummaryBlockSourceChanged(block, () => { updates += 1; });
    assert.equal(updates, 0, "new content must never silently cause a paid summary rerun");
    const notice = block.querySelector(".paperlens-summary-source-changed")!;
    assert.match(notice.textContent ?? "", /이전 원문/);
    assert.match(block.querySelector(".paperlens-summary-body")?.textContent ?? "", /이전 원문의 요약/);
    notice.querySelector<HTMLButtonElement>("button")!.click();
    assert.equal(updates, 1);
    const kind = block.querySelector<HTMLSelectElement>(".paperlens-summary-kind")!;
    assert.equal(kind.getAttribute("aria-label"), "문서 종류");
    for (const option of kind.options) option.selected = false;
    kind.querySelector<HTMLOptionElement>("option[value='paper']")!.selected = true;
    kind.dispatchEvent(new harness.document.defaultView!.Event("change"));
    assert.deepEqual(kinds, ["paper"]);
    assert.equal(updates, 1, "kind correction must not itself trigger a paid update");
  } finally {
    harness.restore();
  }
});

test("plain model output remains readable when it does not follow requested sections", () => {
  const harness = installDocument();
  try {
    const block = ui.createSummaryBlock();
    ui.finalizeSummaryBlock(block, "한 문단 요약.\n\n두 번째 문단.");
    assert.equal(block.querySelectorAll(".paperlens-summary-body p").length, 2);
    assert.match(block.querySelector(".paperlens-summary-body")?.textContent ?? "", /두 번째 문단/);
    assert.equal(block.querySelector(".paperlens-summary-more"), null);
    ui.removeSummaryBlock();
    assert.equal(harness.document.getElementById("paperlens-paper-summary"), null);
  } finally {
    harness.restore();
  }
});

test("ordinary articles retain their own claims hierarchy and fold viewpoints and qualifications", () => {
  const harness = installDocument();
  try {
    const block = ui.createSummaryBlock({ kind: "article" });
    ui.finalizeSummaryBlock(block, [
      "1. 핵심 요약\n보도된 핵심 내용을 요약한다.",
      "2. 배경과 맥락\n사건의 배경이다.",
      "3. 주요 내용\n주요 사실이다.",
      "4. 주장과 근거\n인용 주장의 출처를 보존한다.",
      "5. 출처와 관점\n기자의 관점을 구분한다.",
      "6. 불확실성과 주의점\n확인되지 않은 내용을 구분한다.",
      "7. 의미와 영향\n적용 범위를 제한한다.",
    ].join("\n\n"));
    assert.equal(block.querySelectorAll(".paperlens-summary-body h3").length, 7);
    const more = block.querySelector(".paperlens-summary-more")!;
    assert.deepEqual([...more.querySelectorAll("h3")].map((node) => node.textContent), ["출처와 관점", "불확실성과 주의점", "의미와 영향"]);
    assert.match(more.querySelector("summary")?.textContent ?? "", /관점.*주의점.*영향/);
    assert.doesNotMatch(more.querySelector("summary")?.textContent ?? "", /메커니즘|학술/);
  } finally {
    harness.restore();
  }
});

test("extraction reason codes become plain language source limits", () => {
  const harness = installDocument();
  try {
    const block = ui.createSummaryBlock();
    ui.setSummaryBlockScope(block, { paragraphCount: 4, sectionCount: 2, captionCount: 0, tableCount: 0, partial: true, reasons: ["access-restricted", "content-not-loaded", "ancillary-content-excluded"] });
    const text = block.querySelector(".paperlens-summary-scope")?.textContent ?? "";
    assert.doesNotMatch(text, /access-restricted|content-not-loaded|ancillary-content-excluded/);
    assert.match(text, /접근.*제한/);
    assert.match(text, /불러오지 않은/);
    assert.match(text, /참고문헌/);
  } finally {
    harness.restore();
  }
});
