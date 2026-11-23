import { sendRuntimeMessage } from "../shared/messages";
import { PROVIDERS } from "../shared/providers";
import type { TabReadingStatus } from "../shared/types";

function renderTabStatus(
  tabStatus: TabReadingStatus,
  elements: {
    badge: HTMLElement;
    translateBtn: HTMLButtonElement;
    translateLabel: HTMLElement;
    stopBtn: HTMLButtonElement;
    summaryBtn: HTMLButtonElement;
    summaryLabel: HTMLElement;
  },
): void {
  const { badge, translateBtn, translateLabel, stopBtn, summaryBtn, summaryLabel } = elements;

  if (!tabStatus.injectable) {
    badge.textContent = "Unsupported tab";
    badge.classList.add("muted");
    translateBtn.disabled = true;
    summaryBtn.disabled = true;
    stopBtn.classList.add("hidden");
    return;
  }

  translateBtn.disabled = false;
  summaryBtn.disabled = false;
  stopBtn.classList.toggle("hidden", !tabStatus.inProgress);

  if (tabStatus.inProgress) {
    badge.textContent = tabStatus.total > 0
      ? `Translating ${tabStatus.done}/${tabStatus.total}`
      : "Translating...";
    badge.classList.remove("muted");
    translateLabel.textContent = tabStatus.visible ? "Hide Translations" : "Show Translations";
  } else if (tabStatus.active && tabStatus.visible) {
    badge.textContent = "Translated";
    badge.classList.remove("muted");
    translateLabel.textContent = "Hide Translations";
  } else if (tabStatus.active && !tabStatus.visible) {
    badge.textContent = "Hidden";
    badge.classList.add("muted");
    translateLabel.textContent = "Show Translations";
  } else if (tabStatus.hasSummary) {
    badge.textContent = tabStatus.summaryRunning ? "Summarizing..." : "Summary ready";
    badge.classList.remove("muted");
    translateLabel.textContent = "Translate Page";
  } else {
    badge.textContent = "Ready";
    badge.classList.add("muted");
    translateLabel.textContent = "Translate Page";
  }

  summaryLabel.textContent = tabStatus.summaryRunning
    ? "Summarizing..."
    : tabStatus.hasSummary
      ? "Update Summary"
      : "Summarize Paper";
}

async function init() {
  const providerInfo = document.getElementById("provider-info")!;
  const tabBadge = document.getElementById("tab-badge")!;
  const keyWarning = document.getElementById("key-warning")!;
  const keyWarningText = document.getElementById("key-warning-text")!;
  const setupKeyBtn = document.getElementById("setup-key-btn")!;
  const translateBtn = document.getElementById("translate-btn") as HTMLButtonElement;
  const translateLabel = document.getElementById("translate-label")!;
  const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
  const summaryBtn = document.getElementById("summary-btn") as HTMLButtonElement;
  const summaryLabel = document.getElementById("summary-label")!;
  const settingsBtn = document.getElementById("settings-btn")!;
  const status = document.getElementById("status")!;

  const [settingsRes, tabRes] = await Promise.all([
    sendRuntimeMessage({ type: "settings/get" }),
    sendRuntimeMessage({ type: "tabs/page-status" }),
  ]);

  if (settingsRes.ok && settingsRes.settings) {
    const provider = PROVIDERS[settingsRes.settings.currentProvider];
    const ps = settingsRes.settings.providerSettings[settingsRes.settings.currentProvider];
    const model = ps.model || provider.defaultModel;
    const hasKey = Boolean(ps.apiKey?.trim());
    providerInfo.textContent = `${provider.name} / ${model} / Summary: ${settingsRes.settings.summary.provider}`;
    if (!hasKey && provider.requiresApiKey) {
      keyWarningText.textContent = `${provider.name} API 키가 아직 설정되지 않았습니다.`;
      keyWarning.classList.remove("hidden");
    } else {
      keyWarning.classList.add("hidden");
    }
  } else {
    providerInfo.textContent = "Error loading settings";
  }

  if (tabRes.ok && tabRes.status) {
    renderTabStatus(tabRes.status, {
      badge: tabBadge,
      translateBtn,
      translateLabel,
      stopBtn,
      summaryBtn,
      summaryLabel,
    });
  }

  translateBtn.addEventListener("click", async () => {
    status.textContent = "Starting...";
    const res = await sendRuntimeMessage({ type: "tabs/toggle-translate" });
    if (res.ok) {
      status.textContent = "Translation toggled";
      setTimeout(() => window.close(), 450);
    } else {
      status.textContent = res.error;
    }
  });

  stopBtn.addEventListener("click", async () => {
    status.textContent = "Stopping...";
    const res = await sendRuntimeMessage({ type: "tabs/stop-translate" });
    if (res.ok) {
      status.textContent = "Translation stopped";
      stopBtn.classList.add("hidden");
      setTimeout(() => window.close(), 450);
    } else {
      status.textContent = res.error;
    }
  });

  summaryBtn.addEventListener("click", async () => {
    status.textContent = "Summarizing...";
    const res = await sendRuntimeMessage({ type: "tabs/summarize-paper" });
    if (res.ok) {
      status.textContent = "Summary started";
      setTimeout(() => window.close(), 450);
    } else {
      status.textContent = res.error;
    }
  });

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };
  settingsBtn.addEventListener("click", openOptions);
  setupKeyBtn.addEventListener("click", openOptions);
}

void init();
