import { renderSafeSummary } from "./safe-summary-renderer";

const SUMMARY_BLOCK_ID = "paperlens-paper-summary";
const BODY_ID = "paperlens-paper-summary-body";
const SCOPE_REASON_LABELS: Record<string, string> = {
  "abstract-only": "현재 공개된 초록만 읽었습니다. 정식 본문은 아직 제공되지 않습니다.",
  "access-restricted": "원문의 접근 제한이 감지되었습니다.",
  "content-not-loaded": "아직 불러오지 않은 원문이 있습니다.",
  "unrepresented-article-text": "본문 일부를 추출 결과와 대조하지 못했습니다.",
  "extraction-limit": "내용이 많아 원문 확인 범위를 제한했습니다.",
  "no-readable-content": "읽을 수 있는 본문을 찾지 못했습니다.",
  "ancillary-content-excluded": "참고문헌 등 부속 정보는 요약 범위에서 제외했습니다.",
};

export interface SummaryBlockScope {
  paragraphCount: number;
  sectionCount: number;
  captionCount: number;
  tableCount: number;
  partial: boolean;
  reasons: string[];
}

export interface SummaryBlockOptions {
  insertionAnchor?: Element;
  onCancel?: () => void;
  onRetry?: () => void;
  onKindChange?: (kind: "paper" | "article") => void;
  kind?: "paper" | "article";
}

interface SummaryBlockState {
  options: SummaryBlockOptions;
  phase: "running" | "ready" | "error" | "cancelled";
  summary: string;
  scope: SummaryBlockScope | null;
  sourceUpdate: (() => void) | null;
  title: HTMLElement;
  status: HTMLElement;
  body: HTMLElement;
  scopeContent: HTMLElement;
  cancel: HTMLButtonElement;
  retry: HTMLButtonElement;
  copy: HTMLButtonElement;
  copyFeedback: HTMLElement;
  fold: HTMLButtonElement;
  kind: HTMLSelectElement;
  notice: HTMLElement | null;
}

const states = new WeakMap<HTMLElement, SummaryBlockState>();

function findSummaryInsertionAnchor(): Element | null {
  return document.querySelector([
    "#abstracts", "#abstract", "#Abs1", "[id^='Abs']", ".Abstracts", ".abstract",
    "section[aria-labelledby*='abstract' i]", "section[id*='abstract' i]", "article", "main",
  ].join(", "));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  return node;
}

function updateState(block: HTMLElement, state: SummaryBlockState): void {
  block.classList.toggle("paperlens-summary-loading", state.phase === "running");
  block.classList.toggle("paperlens-summary-error", state.phase === "error");
  block.classList.toggle("paperlens-summary-cancelled", state.phase === "cancelled");
  block.setAttribute("aria-busy", String(state.phase === "running"));
  state.title.textContent = state.options.kind === "article" ? "글 요약" : "논문 요약";
  state.status.textContent = state.phase === "running" ? "요약 중"
    : state.phase === "error" ? "요약 실패"
    : state.phase === "cancelled" ? "표시 중단"
    : state.sourceUpdate ? "원문 변경됨"
    : state.scope?.partial ? "일부 원문 기준" : "요약 완료";
  state.cancel.hidden = state.phase !== "running" || !state.options.onCancel;
  state.retry.hidden = !["error", "cancelled"].includes(state.phase) || !state.options.onRetry;
  state.copy.hidden = state.phase !== "ready";
  state.fold.hidden = state.phase !== "ready";
  state.kind.hidden = !state.options.onKindChange;
  const kindOptions = [...state.kind.options];
  for (const option of kindOptions) option.selected = false;
  const selectedKind = kindOptions.find((option) => option.value === (state.options.kind ?? "paper"));
  if (selectedKind) selectedKind.selected = true;
}

function expandBody(state: SummaryBlockState): void {
  state.body.hidden = false;
  state.fold.setAttribute("aria-expanded", "true");
  state.fold.textContent = "요약 접기";
}

function makeBlock(block: HTMLElement): SummaryBlockState {
  block.className = "paperlens-summary";
  block.setAttribute("aria-label", "PaperLens 읽기 노트");
  const top = element("header", "paperlens-summary-top");
  const brand = element("span", "paperlens-summary-brand", "PaperLens");
  const status = element("span", "paperlens-summary-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  top.append(brand, status);

  const intro = element("div", "paperlens-summary-intro");
  const title = element("h2", "paperlens-summary-title", "논문 요약");
  const kind = element("select", "paperlens-summary-kind");
  kind.setAttribute("aria-label", "문서 종류");
  for (const [value, label] of [["paper", "논문"], ["article", "일반 글"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    kind.appendChild(option);
  }
  intro.append(title, kind);

  const body = element("div", "paperlens-summary-body");
  body.id = BODY_ID;
  const footer = element("footer", "paperlens-summary-footer");
  const scope = element("details", "paperlens-summary-scope");
  const scopeLabel = element("summary", "", "요약에 사용한 범위");
  const scopeContent = element("div", "paperlens-summary-scope-content", "요약에 사용할 원문 범위를 확인 중입니다.");
  scope.append(scopeLabel, scopeContent);
  const actions = element("div", "paperlens-summary-actions");
  const cancel = button("paperlens-summary-cancel", "표시 중단");
  const retry = button("paperlens-summary-retry", "다시 시도");
  const copy = button("paperlens-summary-copy", "요약 복사");
  const fold = button("paperlens-summary-fold", "요약 접기");
  fold.setAttribute("aria-controls", BODY_ID);
  fold.setAttribute("aria-expanded", "true");
  const copyFeedback = element("span", "paperlens-summary-copy-feedback");
  copyFeedback.setAttribute("role", "status");
  actions.append(cancel, retry, copy, fold, copyFeedback);
  footer.append(scope, actions);
  block.replaceChildren(top, intro, body, footer);
  const state: SummaryBlockState = {
    options: {}, phase: "running", summary: "", scope: null, sourceUpdate: null,
    title, status, body, scopeContent, cancel, retry, copy, copyFeedback, fold, kind, notice: null,
  };
  states.set(block, state);
  cancel.addEventListener("click", () => {
    if (state.phase !== "running") return;
    setSummaryBlockCancelled(block);
    state.options.onCancel?.();
  });
  retry.addEventListener("click", () => state.options.onRetry?.());
  fold.addEventListener("click", () => {
    state.body.hidden = !state.body.hidden;
    fold.setAttribute("aria-expanded", String(!state.body.hidden));
    fold.textContent = state.body.hidden ? "요약 펼치기" : "요약 접기";
  });
  copy.addEventListener("click", () => {
    if (state.phase !== "ready") return;
    state.copyFeedback.textContent = "";
    const summary = state.summary;
    void (async () => {
      try {
        await navigator.clipboard.writeText(summary);
        if (state.summary === summary && state.phase === "ready") state.copyFeedback.textContent = "복사됨";
      } catch {
        if (state.summary === summary && state.phase === "ready") state.copyFeedback.textContent = "브라우저에서 복사할 수 없습니다.";
      }
    })();
  });
  kind.addEventListener("change", () => {
    const value = kind.value;
    if (value !== "paper" && value !== "article") return;
    state.options.kind = value;
    updateState(block, state);
    state.options.onKindChange?.(value);
  });
  return state;
}

export function createSummaryBlock(options: SummaryBlockOptions = {}): HTMLElement {
  const existing = document.getElementById(SUMMARY_BLOCK_ID);
  const block = existing ?? element("section", "paperlens-summary");
  block.id = SUMMARY_BLOCK_ID;
  const state = states.get(block) ?? makeBlock(block);
  state.options = { ...options };
  state.phase = "running";
  state.summary = "";
  state.scope = null;
  state.sourceUpdate = null;
  state.notice?.remove();
  state.notice = null;
  state.scopeContent.textContent = "요약에 사용할 원문 범위를 확인 중입니다.";
  state.copyFeedback.textContent = "";
  state.body.textContent = "원문을 읽고 요약하고 있습니다.";
  expandBody(state);
  updateState(block, state);
  if (!existing || options.insertionAnchor?.isConnected) {
    const anchor = options.insertionAnchor?.isConnected ? options.insertionAnchor : findSummaryInsertionAnchor();
    if (anchor?.parentNode) anchor.parentNode.insertBefore(block, anchor);
    else document.body.prepend(block);
  }
  return block;
}

export function finalizeSummaryBlock(block: HTMLElement, summary: string): void {
  const state = states.get(block);
  if (!state) return;
  state.phase = "ready";
  state.summary = summary;
  state.body.replaceChildren(renderSafeSummary(summary, block.ownerDocument, state.options.kind));
  expandBody(state);
  updateState(block, state);
}

export function setSummaryBlockError(block: HTMLElement, error: string): void {
  const state = states.get(block);
  if (!state) return;
  state.phase = "error";
  state.body.textContent = error;
  expandBody(state);
  updateState(block, state);
}

export function setSummaryBlockCancelled(block: HTMLElement): void {
  const state = states.get(block);
  if (!state) return;
  state.phase = "cancelled";
  state.body.textContent = "결과 표시를 중단했습니다. 이미 전송된 요청은 계속 처리될 수 있습니다.";
  expandBody(state);
  updateState(block, state);
}

export function setSummaryBlockScope(block: HTMLElement, scope: SummaryBlockScope): void {
  const state = states.get(block);
  if (!state) return;
  state.scope = scope;
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const counts = element("p", "", `본문 ${count(scope.paragraphCount)}개, 섹션 ${count(scope.sectionCount)}개, 그림 설명 ${count(scope.captionCount)}개, 표 ${count(scope.tableCount)}개`);
  const note = element("p", "", scope.partial
    ? "일부 원문만 사용할 수 있습니다. 읽지 못한 내용은 요약에 포함되지 않습니다."
    : "현재 페이지에서 추출한 내용을 사용했습니다.");
  state.scopeContent.replaceChildren(counts, note);
  if (scope.reasons.length) {
    const reasons = element("ul", "");
    for (const reason of scope.reasons) reasons.appendChild(element("li", "", SCOPE_REASON_LABELS[reason] ?? reason));
    state.scopeContent.appendChild(reasons);
  }
  updateState(block, state);
}

export function setSummaryBlockSourceChanged(block: HTMLElement, onUpdate: () => void): void {
  const state = states.get(block);
  if (!state) return;
  state.sourceUpdate = onUpdate;
  if (!state.notice) {
    const notice = element("aside", "paperlens-summary-source-changed");
    const message = element("p", "", "요약의 기준이 변경되었습니다. 현재 요약은 이전 원문과 문서 종류를 기준으로 작성되었습니다.");
    const update = button("paperlens-summary-update", "요약 업데이트");
    update.addEventListener("click", () => state.sourceUpdate?.());
    notice.append(message, update);
    state.body.before(notice);
    state.notice = notice;
  }
  updateState(block, state);
}

export function removeSummaryBlock(): void {
  document.getElementById(SUMMARY_BLOCK_ID)?.remove();
}
