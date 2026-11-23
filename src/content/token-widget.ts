import type { TokenUsage } from "../shared/types";

export type ReadingMode = "bilingual" | "focus" | "source";
export type FontScale = "sm" | "md" | "lg";

export interface WidgetCallbacks {
  onStop?: () => void;
  onReadingModeChange?: (mode: ReadingMode) => void;
  onSummary?: () => void;
}

const WIDGET_ID = "paperlens-token-widget";
const TOAST_ID = "paperlens-page-toast";

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let toastHostEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

let totalInput = 0;
let totalOutput = 0;
let progressDone = 0;
let progressTotal = 0;
let minimized = false;
let isRunning = false;
let isStopped = false;
let readingMode: ReadingMode = "bilingual";
let fontScale: FontScale = "md";
let hasSummary = false;
let summaryRunning = false;
let callbacks: WidgetCallbacks = {};

const styles = `
  :host { all: initial; }
  .widget {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 2147483645;
    font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", ui-sans-serif, "Segoe UI", system-ui, sans-serif;
    font-size: 12px;
    color: #1d2922;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247,251,248,0.98)),
      repeating-linear-gradient(90deg, rgba(35,129,76,0.04) 0 1px, transparent 1px 16px);
    border: 1px solid rgba(49, 92, 67, 0.2);
    border-radius: 10px;
    padding: 11px 13px 12px;
    box-shadow: 0 16px 40px rgba(17, 35, 25, 0.16);
    min-width: 238px;
    max-width: 268px;
    line-height: 1.45;
    pointer-events: auto;
    backdrop-filter: blur(10px);
  }
  .widget.minimized {
    min-width: 112px;
    padding: 8px 11px;
    cursor: pointer;
  }
  .widget.minimized .details { display: none; }
  .widget.minimized .header { margin-bottom: 0; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .mark {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: #23814c;
    box-shadow: 0 0 0 4px rgba(35, 129, 76, 0.12);
    flex: 0 0 auto;
  }
  .widget.running .mark {
    animation: pl-hud-pulse 1.3s ease-in-out infinite;
  }
  @keyframes pl-hud-pulse {
    0%, 100% { box-shadow: 0 0 0 3px rgba(35, 129, 76, 0.12); }
    50% { box-shadow: 0 0 0 6px rgba(35, 129, 76, 0.26); }
  }
  .title {
    color: #17231c;
    font-weight: 800;
    letter-spacing: 0;
    line-height: 1.1;
    display: block;
  }
  .subtitle {
    color: #5c6b62;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    line-height: 1.1;
    margin-top: 3px;
    display: block;
  }
  .controls { display: flex; gap: 4px; }
  .controls button {
    align-items: center;
    background: rgba(255, 255, 255, 0.78);
    border: 1px solid rgba(49, 92, 67, 0.16);
    border-radius: 5px;
    color: #526057;
    cursor: pointer;
    display: inline-flex;
    font-size: 12px;
    height: 22px;
    justify-content: center;
    line-height: 1;
    padding: 0;
    width: 22px;
  }
  .controls button:hover {
    background: #eef6f1;
    color: #17231c;
  }
  .details .row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 2px 0;
  }
  .label {
    color: #627067;
    font-size: 11px;
  }
  .value {
    color: #1d2922;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
  }
  .progress-bar {
    height: 5px;
    background: rgba(35, 129, 76, 0.12);
    border-radius: 999px;
    margin: 7px 0 9px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #23814c, #6ca884);
    border-radius: inherit;
    transition: width 0.25s ease;
  }
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid rgba(49, 92, 67, 0.12);
  }
  .toolbar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .seg {
    display: inline-flex;
    background: rgba(35, 129, 76, 0.07);
    border: 1px solid rgba(49, 92, 67, 0.12);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }
  .seg button {
    appearance: none;
    background: transparent;
    border: 0;
    border-radius: 4px;
    color: #4f5f55;
    cursor: pointer;
    font-family: inherit;
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1.2;
    padding: 3px 6px;
    transition: background-color 0.14s ease, color 0.14s ease;
  }
  .seg button:hover {
    color: #17231c;
  }
  .seg button.active {
    background: #23814c;
    color: #ffffff;
  }
  .action-row {
    display: flex;
    gap: 6px;
  }
  .action-btn {
    flex: 1 1 0;
    appearance: none;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(49, 92, 67, 0.2);
    border-radius: 6px;
    color: #1f3527;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    padding: 5px 8px;
    text-align: center;
    transition: background-color 0.14s ease, border-color 0.14s ease;
  }
  .action-btn:hover {
    background: #eef6f1;
    border-color: rgba(35, 129, 76, 0.45);
  }
  .action-btn.stop-btn {
    border-color: rgba(180, 35, 24, 0.35);
    color: #b42318;
    background: #fff6f5;
  }
  .action-btn.stop-btn:hover {
    background: #feeceb;
    border-color: #b42318;
  }
  .hidden { display: none !important; }
`;

const toastStyles = `
  :host { all: initial; }
  .toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
    font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.45;
    padding: 10px 16px;
    border-radius: 8px;
    color: #f7faf8;
    background: rgba(23, 35, 28, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 12px 30px rgba(10, 22, 16, 0.24);
    max-width: min(460px, calc(100vw - 32px));
    text-align: center;
    pointer-events: auto;
  }
  .toast.error {
    background: rgba(138, 28, 20, 0.96);
    border-color: rgba(255, 210, 206, 0.25);
  }
`;

function applyDocumentDisplayAttributes(): void {
  const root = document.documentElement;
  if (!root) return;
  if (readingMode === "bilingual") {
    root.removeAttribute("data-paperlens-reading-mode");
  } else {
    root.setAttribute("data-paperlens-reading-mode", readingMode);
  }
  if (fontScale === "md") {
    root.removeAttribute("data-paperlens-font-scale");
  } else {
    root.setAttribute("data-paperlens-font-scale", fontScale);
  }
}

function clearDocumentDisplayAttributes(): void {
  const root = document.documentElement;
  if (!root) return;
  root.removeAttribute("data-paperlens-reading-mode");
  root.removeAttribute("data-paperlens-font-scale");
}

function statusSubtitleText(): string {
  if (isRunning) return "Translating...";
  if (isStopped) return "Stopped";
  if (readingMode === "source") return "Original only";
  if (readingMode === "focus") return "Focus mode";
  if (progressTotal > 0 && progressDone >= progressTotal) return "Reading HUD";
  return "Reading HUD";
}

function render(): void {
  if (!shadow) return;
  const widget = shadow.querySelector(".widget");
  if (!widget) return;

  widget.classList.toggle("running", isRunning);
  const subtitleEl = shadow.querySelector(".subtitle");
  if (subtitleEl) subtitleEl.textContent = statusSubtitleText();

  if (minimized) {
    widget.classList.add("minimized");
    return;
  }
  widget.classList.remove("minimized");

  const inputEl = shadow.querySelector(".input-tokens");
  const outputEl = shadow.querySelector(".output-tokens");
  const progressEl = shadow.querySelector(".progress-text");
  const fillEl = shadow.querySelector<HTMLElement>(".progress-fill");
  const stopBtn = shadow.querySelector<HTMLButtonElement>(".stop-btn");
  const summaryBtn = shadow.querySelector<HTMLButtonElement>(".summary-btn");

  if (inputEl) inputEl.textContent = totalInput.toLocaleString();
  if (outputEl) outputEl.textContent = totalOutput.toLocaleString();
  if (progressEl) progressEl.textContent = `${progressDone} / ${progressTotal}`;
  if (fillEl) {
    fillEl.style.width = progressTotal > 0 ? `${Math.min(100, (progressDone / progressTotal) * 100)}%` : "0%";
  }
  if (stopBtn) {
    stopBtn.classList.toggle("hidden", !isRunning || !callbacks.onStop);
  }
  if (summaryBtn) {
    summaryBtn.classList.toggle("hidden", !callbacks.onSummary);
    summaryBtn.textContent = summaryRunning ? "요약 중..." : hasSummary ? "요약 보기" : "논문 요약";
  }

  shadow.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === readingMode);
  });
  shadow.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.scale === fontScale);
  });
}

export function configureWidget(nextCallbacks: WidgetCallbacks): void {
  callbacks = { ...callbacks, ...nextCallbacks };
  render();
}

export function setWidgetRunning(running: boolean, stopped = false): void {
  isRunning = running;
  isStopped = !running && stopped;
  render();
}

export function setWidgetSummaryState(present: boolean, running: boolean): void {
  hasSummary = present;
  summaryRunning = running;
  render();
}

export function setWidgetReadingMode(mode: ReadingMode): void {
  readingMode = mode;
  applyDocumentDisplayAttributes();
  render();
}

export function setWidgetFontScale(scale: FontScale): void {
  fontScale = scale;
  applyDocumentDisplayAttributes();
  render();
}

export function showPageToast(message: string, tone: "info" | "error" = "info", durationMs = 3600): void {
  if (!document.documentElement) return;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastHostEl?.remove();

  const host = document.createElement("div");
  host.id = TOAST_ID;
  host.setAttribute("data-paperlens-ui", "toast");
  host.style.all = "initial";
  const toastShadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = toastStyles;
  const box = document.createElement("div");
  box.className = tone === "error" ? "toast error" : "toast";
  box.setAttribute("role", "status");
  box.textContent = message;
  toastShadow.append(styleEl, box);

  document.documentElement.appendChild(host);
  toastHostEl = host;

  toastTimer = setTimeout(() => {
    if (toastHostEl === host) {
      host.remove();
      toastHostEl = null;
      toastTimer = null;
    }
  }, durationMs);
}

export function hidePageToast(): void {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastHostEl?.remove();
  toastHostEl = null;
}

export function showWidget(): void {
  applyDocumentDisplayAttributes();
  if (hostEl) {
    hostEl.style.display = "";
    render();
    return;
  }

  hostEl = document.createElement("div");
  hostEl.id = WIDGET_ID;
  hostEl.setAttribute("data-paperlens-ui", "hud");
  hostEl.style.all = "initial";
  shadow = hostEl.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>${styles}</style>
    <div class="widget">
      <div class="header">
        <div class="brand">
          <span class="mark"></span>
          <span>
            <span class="title">PaperLens</span>
            <span class="subtitle">Reading HUD</span>
          </span>
        </div>
        <div class="controls">
          <button type="button" class="minimize-btn" title="Minimize" aria-label="Minimize">-</button>
          <button type="button" class="close-btn" title="Close" aria-label="Close">x</button>
        </div>
      </div>
      <div class="details">
        <div class="row">
          <span class="label">Input tokens</span>
          <span class="value input-tokens">0</span>
        </div>
        <div class="row">
          <span class="label">Output tokens</span>
          <span class="value output-tokens">0</span>
        </div>
        <div class="row">
          <span class="label">Progress</span>
          <span class="value progress-text">0 / 0</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: 0%"></div>
        </div>
        <div class="toolbar">
          <div class="toolbar-row">
            <div class="seg" role="group" aria-label="Reading mode">
              <button type="button" data-mode="bilingual" class="active" title="원문과 번역 함께 보기">병렬</button>
              <button type="button" data-mode="focus" title="원문을 흐리게 하여 번역에 집중">집중</button>
              <button type="button" data-mode="source" title="번역 숨기기">원문</button>
            </div>
            <div class="seg" role="group" aria-label="Font size">
              <button type="button" data-scale="sm" title="작게">A-</button>
              <button type="button" data-scale="md" class="active" title="보통">A</button>
              <button type="button" data-scale="lg" title="크게">A+</button>
            </div>
          </div>
          <div class="action-row">
            <button type="button" class="action-btn stop-btn hidden">번역 중단</button>
            <button type="button" class="action-btn summary-btn hidden">논문 요약</button>
          </div>
        </div>
      </div>
    </div>
  `;

  shadow.querySelector(".minimize-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    minimized = !minimized;
    render();
  });

  shadow.querySelector(".close-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideWidget();
  });

  shadow.querySelector(".widget")?.addEventListener("click", () => {
    if (minimized) {
      minimized = false;
      render();
    }
  });

  shadow.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mode = btn.dataset.mode as ReadingMode;
      if (!mode) return;
      setWidgetReadingMode(mode);
      callbacks.onReadingModeChange?.(mode);
    });
  });

  shadow.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const scale = btn.dataset.scale as FontScale;
      if (!scale) return;
      setWidgetFontScale(scale);
    });
  });

  shadow.querySelector(".stop-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onStop?.();
  });

  shadow.querySelector(".summary-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onSummary?.();
  });

  document.documentElement.appendChild(hostEl);
  render();
}

export function hideWidget(): void {
  if (hostEl) {
    hostEl.style.display = "none";
  }
}

export function destroyWidget(): void {
  hostEl?.remove();
  hostEl = null;
  shadow = null;
  hidePageToast();
  clearDocumentDisplayAttributes();
  callbacks = {};
  resetCounters();
}

export function addUsage(usage?: TokenUsage): void {
  if (!usage) return;
  totalInput += usage.inputTokens;
  totalOutput += usage.outputTokens;
  render();
}

export function setProgress(done: number, total: number): void {
  progressDone = done;
  progressTotal = total;
  render();
}

export function resetCounters(): void {
  totalInput = 0;
  totalOutput = 0;
  progressDone = 0;
  progressTotal = 0;
  minimized = false;
  isRunning = false;
  isStopped = false;
  readingMode = "bilingual";
  fontScale = "md";
  hasSummary = false;
  summaryRunning = false;
}
