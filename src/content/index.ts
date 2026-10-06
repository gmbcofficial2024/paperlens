import { sendRuntimeMessage } from "../shared/messages";
import { shouldResetTranslationForNavigation } from "../shared/navigation";
import { createPageReadingSession } from "./page-reading-session";

const pageReadingSession = createPageReadingSession({
  sendRuntimeMessage,
  scheduleRetry: (callback, delayMs) => {
    const timeoutId = window.setTimeout(callback, delayMs);
    return () => window.clearTimeout(timeoutId);
  },
});

window.addEventListener("pagehide", () => pageReadingSession.reset());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "paperlens/ping") {
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "toggle-translate") {
    void pageReadingSession.toggleTranslation().catch((error) => {
      console.error(error);
    });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "summarize-paper") {
    void pageReadingSession.summarize().catch((error) => {
      console.error(error);
    });
    sendResponse({ ok: true });
    return;
  }
});

let lastUrl = location.href;

function checkUrlChange(): void {
  const currentUrl = location.href;
  if (shouldResetTranslationForNavigation(lastUrl, currentUrl)) {
    pageReadingSession.reset();
  }
  lastUrl = currentUrl;
}

if (typeof navigation !== "undefined") {
  navigation.addEventListener("navigatesuccess", checkUrlChange);
} else {
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function(...args: Parameters<typeof history.pushState>) {
    origPushState(...args);
    checkUrlChange();
  };

  history.replaceState = function(...args: Parameters<typeof history.replaceState>) {
    origReplaceState(...args);
    checkUrlChange();
  };

  window.addEventListener("popstate", checkUrlChange);
}

console.log("PaperLens content script loaded");
