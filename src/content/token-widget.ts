import type { TokenUsage } from "../shared/types";

const WIDGET_ID = "paperlens-token-widget";

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let totalInput = 0;
let totalOutput = 0;
let progressDone = 0;
let progressTotal = 0;
let minimized = false;

const styles = `
  :host { all: initial; }
  .widget {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 2147483645;
    font-family: ui-sans-serif, "Segoe UI", system-ui, sans-serif;
    font-size: 12px;
    color: #1d2922;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,252,249,0.98)),
      repeating-linear-gradient(90deg, rgba(35,129,76,0.05) 0 1px, transparent 1px 16px);
    border: 1px solid rgba(49, 92, 67, 0.18);
    border-radius: 9px;
    padding: 11px 13px 12px;
    box-shadow: 0 16px 40px rgba(17, 35, 25, 0.16);
    min-width: 218px;
    line-height: 1.5;
    pointer-events: auto;
    backdrop-filter: blur(10px);
  }
  .widget.minimized {
    min-width: 106px;
    padding: 8px 11px;
    cursor: pointer;
  }
  .widget.minimized .details { display: none; }
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
  .title {
    color: #17231c;
    font-weight: 800;
    letter-spacing: 0;
    line-height: 1;
  }
  .subtitle {
    color: #6a766e;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 1;
    margin-top: 4px;
    text-transform: uppercase;
  }
  .controls { display: flex; gap: 4px; }
  .controls button {
    align-items: center;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(49, 92, 67, 0.14);
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
    background: #f2f7f3;
    color: #17231c;
  }
  .details .row {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 3px 0;
  }
  .label {
    color: #66726b;
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
    margin-top: 9px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #23814c, #79a98e);
    border-radius: inherit;
    transition: width 0.3s ease;
  }
`;

function render(): void {
  if (!shadow) return;
  const widget = shadow.querySelector(".widget");
  if (!widget) return;

  if (minimized) {
    widget.classList.add("minimized");
    return;
  }
  widget.classList.remove("minimized");

  const inputEl = shadow.querySelector(".input-tokens");
  const outputEl = shadow.querySelector(".output-tokens");
  const progressEl = shadow.querySelector(".progress-text");
  const fillEl = shadow.querySelector<HTMLElement>(".progress-fill");

  if (inputEl) inputEl.textContent = totalInput.toLocaleString();
  if (outputEl) outputEl.textContent = totalOutput.toLocaleString();
  if (progressEl) progressEl.textContent = `${progressDone} / ${progressTotal}`;
  if (fillEl) {
    fillEl.style.width = progressTotal > 0 ? `${(progressDone / progressTotal) * 100}%` : "0%";
  }
}

export function showWidget(): void {
  if (hostEl) {
    hostEl.style.display = "";
    return;
  }

  hostEl = document.createElement("div");
  hostEl.id = WIDGET_ID;
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
          <button class="minimize-btn" title="Minimize" aria-label="Minimize">-</button>
          <button class="close-btn" title="Close" aria-label="Close">x</button>
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
      </div>
    </div>
  `;

  shadow.querySelector(".minimize-btn")?.addEventListener("click", () => {
    minimized = !minimized;
    render();
  });

  shadow.querySelector(".close-btn")?.addEventListener("click", () => {
    hideWidget();
  });

  shadow.querySelector(".widget")?.addEventListener("click", () => {
    if (minimized) {
      minimized = false;
      render();
    }
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
}
