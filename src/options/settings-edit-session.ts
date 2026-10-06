import { sendRuntimeMessage } from "../shared/messages";
import { PROVIDERS, listProviders } from "../shared/providers";
import type {
  ExtensionSettings,
  ProviderId,
  ProviderSetting,
  SummaryProviderId,
} from "../shared/types";

export interface OptionsSettingsEditSession {
  start(): Promise<void>;
}

export interface OptionsSettingsEditSessionDependencies {
  document: Document;
  sendMessage: typeof sendRuntimeMessage;
  permissions: Pick<typeof chrome.permissions, "contains" | "request">;
}

interface ProviderDraft {
  apiKey: string;
  model: string;
  customUrl: string;
}

type ProviderDrafts = Record<ProviderId, ProviderDraft>;

function requireElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing Options element #${id}`);
  return element as T;
}

function toDraft(setting: ProviderSetting): ProviderDraft {
  return {
    apiKey: setting.apiKey ?? "",
    model: setting.model ?? "",
    customUrl: setting.customUrl ?? "",
  };
}

function buildDraftSet(
  settings: Record<ProviderId, ProviderSetting>,
): ProviderDrafts {
  return {
    gemini: toDraft(settings.gemini),
    vertex: toDraft(settings.vertex),
    openai: toDraft(settings.openai),
    anthropic: toDraft(settings.anthropic),
    custom: toDraft(settings.custom),
  };
}

function replaceDraft(
  drafts: ProviderDrafts,
  providerId: ProviderId,
  draft: ProviderDraft,
): ProviderDrafts {
  return {
    gemini: providerId === "gemini" ? { ...draft } : { ...drafts.gemini },
    vertex: providerId === "vertex" ? { ...draft } : { ...drafts.vertex },
    openai: providerId === "openai" ? { ...draft } : { ...drafts.openai },
    anthropic: providerId === "anthropic" ? { ...draft } : { ...drafts.anthropic },
    custom: providerId === "custom" ? { ...draft } : { ...drafts.custom },
  };
}

function toOptionalString(value: string): string | undefined {
  return value.trim() || undefined;
}

function providerDraftsToSettings(
  drafts: ProviderDrafts,
): Record<ProviderId, ProviderSetting> {
  const toSettings = (draft: ProviderDraft): ProviderSetting => ({
    apiKey: toOptionalString(draft.apiKey),
    model: toOptionalString(draft.model),
    customUrl: toOptionalString(draft.customUrl),
  });

  return {
    gemini: toSettings(drafts.gemini),
    vertex: toSettings(drafts.vertex),
    openai: toSettings(drafts.openai),
    anthropic: toSettings(drafts.anthropic),
    custom: toSettings(drafts.custom),
  };
}

class OptionsSettingsEditSessionImpl implements OptionsSettingsEditSession {
  private readonly providerSelect: HTMLSelectElement;
  private readonly apiKeyInput: HTMLInputElement;
  private readonly modelField: HTMLElement;
  private readonly modelSelect: HTMLSelectElement;
  private readonly customModelField: HTMLElement;
  private readonly customModelInput: HTMLInputElement;
  private readonly customUrlField: HTMLElement;
  private readonly customUrlInput: HTMLInputElement;
  private readonly concurrencyInput: HTMLInputElement;
  private readonly cacheEnabledInput: HTMLInputElement;
  private readonly customPromptInput: HTMLTextAreaElement;
  private readonly summaryAutoGenerateInput: HTMLInputElement;
  private readonly summaryProviderSelect: HTMLSelectElement;
  private readonly summaryCodexFields: HTMLElement;
  private readonly summaryCodexModelInput: HTMLInputElement;
  private readonly summaryClaudeFields: HTMLElement;
  private readonly summaryClaudeModelInput: HTMLInputElement;
  private readonly summaryGeminiFields: HTMLElement;
  private readonly summaryGeminiApiKeyInput: HTMLInputElement;
  private readonly summaryGeminiModelSelect: HTMLSelectElement;
  private readonly summaryVertexFields: HTMLElement;
  private readonly summaryVertexApiKeyInput: HTMLInputElement;
  private readonly summaryVertexModelSelect: HTMLSelectElement;
  private readonly summaryPromptInput: HTMLTextAreaElement;
  private readonly clearCacheButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly toast: HTMLElement;
  private readonly providerSaveControls: Array<
    HTMLSelectElement | HTMLInputElement | HTMLButtonElement
  >;

  private savedSettingsBaseline: ExtensionSettings | null = null;
  private providerDrafts: ProviderDrafts | null = null;
  private displayedProviderId: ProviderId | null = null;
  private saveInProgress = false;

  constructor(private readonly dependencies: OptionsSettingsEditSessionDependencies) {
    const { document } = dependencies;
    this.providerSelect = requireElement<HTMLSelectElement>(document, "provider");
    this.apiKeyInput = requireElement<HTMLInputElement>(document, "api-key");
    this.modelField = requireElement(document, "model-field");
    this.modelSelect = requireElement<HTMLSelectElement>(document, "model");
    this.customModelField = requireElement(document, "custom-model-field");
    this.customModelInput = requireElement<HTMLInputElement>(document, "custom-model");
    this.customUrlField = requireElement(document, "custom-url-field");
    this.customUrlInput = requireElement<HTMLInputElement>(document, "custom-url");
    this.concurrencyInput = requireElement<HTMLInputElement>(document, "concurrency");
    this.cacheEnabledInput = requireElement<HTMLInputElement>(document, "cache-enabled");
    this.customPromptInput = requireElement<HTMLTextAreaElement>(document, "custom-prompt");
    this.summaryAutoGenerateInput = requireElement<HTMLInputElement>(
      document,
      "summary-auto-generate",
    );
    this.summaryProviderSelect = requireElement<HTMLSelectElement>(document, "summary-provider");
    this.summaryCodexFields = requireElement(document, "summary-codex-fields");
    this.summaryCodexModelInput = requireElement<HTMLInputElement>(document, "summary-codex-model");
    this.summaryClaudeFields = requireElement(document, "summary-claude-fields");
    this.summaryClaudeModelInput = requireElement<HTMLInputElement>(
      document,
      "summary-claude-model",
    );
    this.summaryGeminiFields = requireElement(document, "summary-gemini-fields");
    this.summaryGeminiApiKeyInput = requireElement<HTMLInputElement>(
      document,
      "summary-gemini-api-key",
    );
    this.summaryGeminiModelSelect = requireElement<HTMLSelectElement>(
      document,
      "summary-gemini-model",
    );
    this.summaryVertexFields = requireElement(document, "summary-vertex-fields");
    this.summaryVertexApiKeyInput = requireElement<HTMLInputElement>(
      document,
      "summary-vertex-api-key",
    );
    this.summaryVertexModelSelect = requireElement<HTMLSelectElement>(
      document,
      "summary-vertex-model",
    );
    this.summaryPromptInput = requireElement<HTMLTextAreaElement>(document, "summary-prompt");
    this.clearCacheButton = requireElement<HTMLButtonElement>(document, "clear-cache-btn");
    this.saveButton = requireElement<HTMLButtonElement>(document, "save-btn");
    this.toast = requireElement(document, "toast");
    this.providerSaveControls = [
      this.providerSelect,
      this.apiKeyInput,
      this.modelSelect,
      this.customModelInput,
      this.customUrlInput,
      this.saveButton,
    ];
  }

  async start(): Promise<void> {
    this.bindEvents();
    await this.loadSettings();
  }

  private bindEvents(): void {
    this.providerSelect.addEventListener("change", () => this.changeProvider());
    this.summaryProviderSelect.addEventListener("change", () => {
      this.showSummaryProviderFields(this.summaryProviderSelect.value as SummaryProviderId);
    });
    this.saveButton.addEventListener("click", () => {
      void this.save();
    });
    this.clearCacheButton.addEventListener("click", () => {
      void this.clearCache();
    });
  }

  private showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add("show");
    const ownerWindow = this.dependencies.document.defaultView;
    if (ownerWindow) {
      ownerWindow.setTimeout(() => this.toast.classList.remove("show"), 2000);
    } else {
      setTimeout(() => this.toast.classList.remove("show"), 2000);
    }
  }

  private setProviderSaveControlsDisabled(disabled: boolean): void {
    for (const control of this.providerSaveControls) {
      control.disabled = disabled;
    }
  }

  private populateProviders(): void {
    this.providerSelect.innerHTML = "";
    for (const provider of listProviders()) {
      const option = this.dependencies.document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.name;
      this.providerSelect.appendChild(option);
    }
  }

  private populateModels(providerId: ProviderId): void {
    this.modelSelect.innerHTML = "";
    const provider = PROVIDERS[providerId];
    const hasFixedModels = provider.models.length > 0;

    if (!hasFixedModels) {
      const option = this.dependencies.document.createElement("option");
      option.value = "";
      option.textContent = "(custom model)";
      this.modelSelect.appendChild(option);
    } else {
      for (const model of provider.models) {
        const option = this.dependencies.document.createElement("option");
        option.value = model.id;
        option.textContent = model.label;
        this.modelSelect.appendChild(option);
      }
    }

    this.modelField.classList.toggle("hidden", !hasFixedModels);
    this.customModelField.classList.toggle("hidden", hasFixedModels);
    this.customUrlField.classList.toggle("hidden", !provider.requiresUrl);
    this.customModelInput.placeholder = provider.id === "vertex"
      ? provider.defaultModel
      : "e.g., llama-3.1-70b-instruct";
  }

  private readDisplayedProviderDraft(providerId: ProviderId): ProviderDraft {
    return {
      apiKey: this.apiKeyInput.value,
      model: PROVIDERS[providerId].models.length === 0
        ? this.customModelInput.value
        : this.modelSelect.value,
      customUrl: this.customUrlInput.value,
    };
  }

  private renderProviderDraft(providerId: ProviderId, draft: ProviderDraft): void {
    this.apiKeyInput.value = draft.apiKey;
    if (PROVIDERS[providerId].models.length === 0) {
      this.customModelInput.value = draft.model;
    } else {
      this.modelSelect.value = draft.model || PROVIDERS[providerId].defaultModel;
    }
    this.customUrlInput.value = draft.customUrl;
  }

  private populateSummaryModels(): void {
    this.summaryGeminiModelSelect.innerHTML = "";
    for (const model of PROVIDERS.gemini.models) {
      const option = this.dependencies.document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      this.summaryGeminiModelSelect.appendChild(option);
    }

    this.summaryVertexModelSelect.innerHTML = "";
    for (const model of PROVIDERS.vertex.models) {
      const option = this.dependencies.document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      this.summaryVertexModelSelect.appendChild(option);
    }
  }

  private showSummaryProviderFields(providerId: SummaryProviderId): void {
    this.summaryCodexFields.classList.toggle("hidden", providerId !== "codex");
    this.summaryClaudeFields.classList.toggle("hidden", providerId !== "claude");
    this.summaryGeminiFields.classList.toggle("hidden", providerId !== "gemini");
    this.summaryVertexFields.classList.toggle("hidden", providerId !== "vertex");
  }

  private changeProvider(): void {
    if (!this.providerDrafts || !this.displayedProviderId) return;

    this.providerDrafts = replaceDraft(
      this.providerDrafts,
      this.displayedProviderId,
      this.readDisplayedProviderDraft(this.displayedProviderId),
    );
    const providerId = this.providerSelect.value as ProviderId;
    this.populateModels(providerId);
    this.displayedProviderId = providerId;
    this.renderProviderDraft(providerId, this.providerDrafts[providerId]);
  }

  private async loadSettings(): Promise<void> {
    try {
      const response = await this.dependencies.sendMessage({ type: "settings/get" });
      if (!response.ok || !("settings" in response)) {
        this.showToast("Failed to load settings");
        return;
      }

      this.savedSettingsBaseline = response.settings;
      this.providerDrafts = buildDraftSet(response.settings.providerSettings);
      this.populateProviders();
      this.providerSelect.value = response.settings.currentProvider;
      this.displayedProviderId = response.settings.currentProvider;
      this.populateModels(response.settings.currentProvider);
      this.renderProviderDraft(
        response.settings.currentProvider,
        this.providerDrafts[response.settings.currentProvider],
      );

      this.concurrencyInput.value = String(response.settings.maxConcurrency);
      this.customPromptInput.value = response.settings.customPrompt ?? "";
      this.cacheEnabledInput.checked = response.settings.cacheEnabled;

      this.populateSummaryModels();
      this.summaryAutoGenerateInput.checked = response.settings.summary.autoGenerate;
      this.summaryProviderSelect.value = response.settings.summary.provider;
      this.showSummaryProviderFields(response.settings.summary.provider);
      this.summaryCodexModelInput.value = response.settings.summary.codexModel ?? "";
      this.summaryClaudeModelInput.value = response.settings.summary.claudeModel ?? "";
      this.summaryGeminiApiKeyInput.value = response.settings.summary.geminiApiKey ?? "";
      this.summaryGeminiModelSelect.value = response.settings.summary.geminiModel
        || PROVIDERS.gemini.defaultModel;
      this.summaryVertexApiKeyInput.value = response.settings.summary.vertexApiKey ?? "";
      this.summaryVertexModelSelect.value = response.settings.summary.vertexModel
        || PROVIDERS.vertex.defaultModel;
      this.summaryPromptInput.value = response.settings.summary.prompt;
    } catch {
      this.showToast("Failed to load settings");
    }
  }

  private originPatternFromCustomUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error("Custom URL must use HTTPS");
    }
    return `${url.protocol}//${url.hostname}/*`;
  }

  private async ensureCustomUrlPermission(value: string): Promise<boolean> {
    const permission = { origins: [this.originPatternFromCustomUrl(value)] };
    const alreadyGranted = await new Promise<boolean>((resolve) => {
      this.dependencies.permissions.contains(permission, resolve);
    });
    if (alreadyGranted) return true;

    return new Promise<boolean>((resolve) => {
      this.dependencies.permissions.request(permission, resolve);
    });
  }

  private createSettingsSnapshot(
    currentProvider: ProviderId,
    providerSettings: Record<ProviderId, ProviderSetting>,
  ): ExtensionSettings {
    const baseline = this.savedSettingsBaseline;
    if (!baseline) throw new Error("Settings baseline is unavailable");

    return {
      currentProvider,
      providerSettings,
      cacheEnabled: this.cacheEnabledInput.checked,
      maxConcurrency: parseInt(this.concurrencyInput.value) || 3,
      customPrompt: this.customPromptInput.value.trim(),
      summary: {
        ...baseline.summary,
        provider: this.summaryProviderSelect.value as SummaryProviderId,
        autoGenerate: this.summaryAutoGenerateInput.checked,
        prompt: this.summaryPromptInput.value.trim(),
        codexModel: this.summaryCodexModelInput.value.trim() || undefined,
        claudeModel: this.summaryClaudeModelInput.value.trim() || undefined,
        geminiApiKey: this.summaryGeminiApiKeyInput.value.trim() || undefined,
        geminiModel: this.summaryGeminiModelSelect.value || undefined,
        vertexApiKey: this.summaryVertexApiKeyInput.value.trim() || undefined,
        vertexModel: this.summaryVertexModelSelect.value || undefined,
      },
    };
  }

  private async save(): Promise<void> {
    if (
      this.saveInProgress ||
      !this.savedSettingsBaseline ||
      !this.providerDrafts ||
      !this.displayedProviderId
    ) {
      return;
    }

    const currentProvider = this.providerSelect.value as ProviderId;
    this.providerDrafts = replaceDraft(
      this.providerDrafts,
      this.displayedProviderId,
      this.readDisplayedProviderDraft(this.displayedProviderId),
    );
    const providerSettings = providerDraftsToSettings(this.providerDrafts);
    const snapshot = this.createSettingsSnapshot(currentProvider, providerSettings);

    this.saveInProgress = true;
    this.setProviderSaveControlsDisabled(true);

    try {
      const customUrl = providerSettings.custom.customUrl;
      if (customUrl) {
        let granted: boolean;
        try {
          granted = await this.ensureCustomUrlPermission(customUrl);
        } catch {
          this.showToast("Custom URL must use HTTPS");
          return;
        }
        if (!granted) {
          this.showToast("Custom API permission denied");
          return;
        }
      }

      const response = await this.dependencies.sendMessage({
        type: "settings/update",
        settings: snapshot,
      });
      if (!response.ok || !("settings" in response)) {
        this.showToast("Failed to save settings");
        return;
      }

      this.savedSettingsBaseline = response.settings;
      this.providerDrafts = buildDraftSet(response.settings.providerSettings);
      this.providerSelect.value = response.settings.currentProvider;
      this.displayedProviderId = response.settings.currentProvider;
      this.populateModels(this.displayedProviderId);
      this.renderProviderDraft(
        this.displayedProviderId,
        this.providerDrafts[this.displayedProviderId],
      );
      this.showToast("Settings saved");
    } catch {
      this.showToast("Failed to save settings");
    } finally {
      this.saveInProgress = false;
      this.setProviderSaveControlsDisabled(false);
    }
  }

  private async clearCache(): Promise<void> {
    try {
      const response = await this.dependencies.sendMessage({ type: "cache/clear" });
      this.showToast(response.ok ? "Cache cleared" : "Failed to clear cache");
    } catch {
      this.showToast("Failed to clear cache");
    }
  }
}

export function createOptionsSettingsEditSession(
  dependencies: OptionsSettingsEditSessionDependencies,
): OptionsSettingsEditSession {
  return new OptionsSettingsEditSessionImpl(dependencies);
}
