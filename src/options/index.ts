import { sendRuntimeMessage } from "../shared/messages";
import { createOptionsSettingsEditSession } from "./settings-edit-session";

const session = createOptionsSettingsEditSession({
  document,
  sendMessage: sendRuntimeMessage,
  permissions: chrome.permissions,
});

void session.start();

const connectionButton = document.getElementById("test-connection-btn") as HTMLButtonElement;
const connectionStatus = document.getElementById("connection-status")!;
connectionButton.addEventListener("click", async () => {
  connectionButton.disabled = true;
  connectionStatus.textContent = "Testing the saved translation provider...";
  try {
    const response = await sendRuntimeMessage({
      type: "translate/paragraph",
      text: "PaperLens connection test. This sentence confirms that the saved provider can translate text.",
      paragraphId: "paperlens-connection-test",
    });
    connectionStatus.textContent = response.ok
      ? "Connection successful. You can now use Alt+T and Alt+S on an article."
      : response.error;
  } catch (error) {
    connectionStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    connectionButton.disabled = false;
  }
});
