import { sendRuntimeMessage } from "../shared/messages";
import { PROVIDERS } from "../shared/providers";

async function init() {
  const providerInfo = document.getElementById("provider-info")!;
  const translateBtn = document.getElementById("translate-btn")!;
  const summaryBtn = document.getElementById("summary-btn")!;
  const settingsBtn = document.getElementById("settings-btn")!;
  const status = document.getElementById("status")!;

  // Load settings
  const res = await sendRuntimeMessage({ type: "settings/get" });

  if (res.ok && res.settings) {
    const provider = PROVIDERS[res.settings.currentProvider];
    const ps = res.settings.providerSettings[res.settings.currentProvider];
    const model = ps.model || provider.defaultModel;
    const hasKey = !!ps.apiKey;
    providerInfo.textContent = `${provider.name} / ${model}`;
    if (!hasKey && provider.requiresApiKey) {
      providerInfo.textContent += " (no API key)";
      providerInfo.style.color = "#e53935";
    }
    providerInfo.textContent += ` / Summary: ${res.settings.summary.provider}`;
  } else {
    providerInfo.textContent = "Error loading settings";
  }

  // Translate button
  translateBtn.addEventListener("click", async () => {
    status.textContent = "Starting...";
    const res = await sendRuntimeMessage({ type: "tabs/toggle-translate" });
    if (res.ok) {
      status.textContent = "Translation toggled";
      setTimeout(() => window.close(), 500);
    } else {
      status.textContent = res.error;
    }
  });

  summaryBtn.addEventListener("click", async () => {
    status.textContent = "Summarizing...";
    const res = await sendRuntimeMessage({ type: "tabs/summarize-paper" });
    if (res.ok) {
      status.textContent = "Summary started";
      setTimeout(() => window.close(), 500);
    } else {
      status.textContent = res.error;
    }
  });

  // Settings button
  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
