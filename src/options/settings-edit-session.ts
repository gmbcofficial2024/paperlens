import { sendRuntimeMessage } from "../shared/messages";
import { PROVIDERS, listProviders } from "../shared/providers";
import { DISTRIBUTION_API_MODEL, IS_DISTRIBUTION } from "../shared/distribution-policy";
import { mergeSettings } from "../shared/schema";
import { redactSecrets } from "../shared/secrets";
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
  private readonly summaryCodexModels: HTMLDataListElement;
  private readonly summaryClaudeFields: HTMLElement;
  private readonly summaryClaudeModelInput: HTMLInputElement;
  private readonly summaryClaudeModels: HTMLDataListElement;
  private readonly summaryGeminiFields: HTMLElement;
  private readonly summaryGeminiApiKeyInput: HTMLInputElement;
  private readonly summaryGeminiModelSelect: HTMLSelectElement;
  private readonly summaryVertexFields: HTMLElement;
  private readonly summaryVertexApiKeyInput: HTMLInputElement;
  private readonly summaryVertexModelSelect: HTMLSelectElement;
  private readonly summaryOpenaiFields: HTMLElement;
  private readonly summaryOpenaiApiKeyInput: HTMLInputElement;
  private readonly summaryOpenaiModelSelect: HTMLSelectElement;
  private readonly summaryAnthropicFields: HTMLElement;
  private readonly summaryAnthropicApiKeyInput: HTMLInputElement;
  private readonly summaryAnthropicModelSelect: HTMLSelectElement;
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
    this.summaryCodexModels = requireElement<HTMLDataListElement>(document, "summary-codex-models");
    this.summaryClaudeFields = requireElement(document, "summary-claude-fields");
    this.summaryClaudeModelInput = requireElement<HTMLInputElement>(
      document,
      "summary-claude-model",
    );
    this.summaryClaudeModels = requireElement<HTMLDataListElement>(document, "summary-claude-models");
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
    this.summaryOpenaiFields = requireElement(document, "summary-openai-fields");
    this.summaryOpenaiApiKeyInput = requireElement<HTMLInputElement>(document, "summary-openai-api-key");
    this.summaryOpenaiModelSelect = requireElement<HTMLSelectElement>(document, "summary-openai-model");
    this.summaryAnthropicFields = requireElement(document, "summary-anthropic-fields");
    this.summaryAnthropicApiKeyInput = requireElement<HTMLInputElement>(document, "summary-anthropic-api-key");
    this.summaryAnthropicModelSelect = requireElement<HTMLSelectElement>(document, "summary-anthropic-model");
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
    if (IS_DISTRIBUTION) this.configureDistributionControls();
    await this.loadSettings();
  }

  private configureDistributionControls(): void {
    this.dependencies.document.getElementById("summary-distribution-model-note")?.classList.remove("hidden");
    this.dependencies.document.getElementById("summary-gemini-model-fallback-help")?.classList.add("hidden");
    const summaryHelp = this.dependencies.document.getElementById("summary-provider-help");
    if (summaryHelp) summaryHelp.textContent = "Gemini, Vertex, OpenAI and Anthropic work directly with your API keys. Only the Gemini model is fixed to Flash Latest in the shared release. Optional Codex and Claude require a separately installed Native Messaging host and a logged-in CLI.";
    const quickStart = this.dependencies.document.getElementById("api-quick-start-help");
    if (quickStart) quickStart.textContent = "Choose a provider, enter your own API key, then click Save Settings. Only the Gemini model is fixed in the shared release. A blank Gemini summary key reuses the saved Gemini translation key. No local CLI is needed for API providers.";
    this.summaryGeminiModelSelect.disabled = true;
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
      const fixedInDistribution = IS_DISTRIBUTION && this.displayedProviderId === "gemini" && control === this.modelSelect;
      control.disabled = disabled || fixedInDistribution;
    }
    this.summaryGeminiModelSelect.disabled = IS_DISTRIBUTION;
    this.summaryVertexModelSelect.disabled = false;
    this.summaryOpenaiModelSelect.disabled = false;
    this.summaryAnthropicModelSelect.disabled = false;
  }

  private populateModelChoices(
    container: HTMLSelectElement | HTMLDataListElement,
    models: Array<{ id: string; label: string }>,
  ): void {
    container.innerHTML = "";
    for (const model of models) {
      const option = this.dependencies.document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      container.appendChild(option);
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
    const fixedGemini = IS_DISTRIBUTION && providerId === "gemini";
    this.modelSelect.disabled = this.saveInProgress || fixedGemini;
    this.dependencies.document.getElementById("translation-distribution-model-note")?.classList.toggle("hidden", !fixedGemini);
    if (fixedGemini) {
      const option = this.dependencies.document.createElement("option");
      option.value = DISTRIBUTION_API_MODEL;
      option.textContent = `Gemini Flash Latest (${DISTRIBUTION_API_MODEL})`;
      this.modelSelect.appendChild(option);
      this.modelSelect.disabled = true;
      this.modelField.classList.remove("hidden");
      this.customModelField.classList.add("hidden");
      this.customUrlField.classList.add("hidden");
      return;
    }
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
      model: IS_DISTRIBUTION && providerId === "gemini" ? DISTRIBUTION_API_MODEL : PROVIDERS[providerId].models.length === 0
        ? this.customModelInput.value
        : this.modelSelect.value,
      customUrl: this.customUrlInput.value,
    };
  }

  private renderProviderDraft(providerId: ProviderId, draft: ProviderDraft): void {
    this.apiKeyInput.value = draft.apiKey;
    if (IS_DISTRIBUTION && providerId === "gemini") {
      this.modelSelect.value = DISTRIBUTION_API_MODEL;
    } else if (PROVIDERS[providerId].models.length === 0) {
      this.customModelInput.value = draft.model;
    } else {
      this.modelSelect.value = draft.model || PROVIDERS[providerId].defaultModel;
    }
    this.customUrlInput.value = draft.customUrl;
  }

  private populateSummaryModels(): void {
    this.summaryGeminiModelSelect.innerHTML = "";
    const geminiModels = IS_DISTRIBUTION
      ? [{ id: DISTRIBUTION_API_MODEL, label: `Gemini Flash Latest (${DISTRIBUTION_API_MODEL})` }]
      : [{ id: "", label: "Reuse saved translation Gemini model" }, ...PROVIDERS.gemini.models];
    for (const model of geminiModels) {
      const option = this.dependencies.document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      this.summaryGeminiModelSelect.appendChild(option);
    }

    this.populateModelChoices(this.summaryVertexModelSelect, [
      { id: "", label: "Reuse saved translation Vertex model" },
      ...PROVIDERS.vertex.models,
    ]);
    this.summaryGeminiModelSelect.disabled = IS_DISTRIBUTION;
    this.summaryVertexModelSelect.disabled = false;
    this.populateModelChoices(this.summaryOpenaiModelSelect, [
      { id: "", label: "Reuse saved translation OpenAI model" },
      ...PROVIDERS.openai.models,
    ]);
    this.populateModelChoices(this.summaryAnthropicModelSelect, [
      { id: "", label: "Reuse saved translation Anthropic model" },
      ...PROVIDERS.anthropic.models,
    ]);
    this.populateModelChoices(this.summaryCodexModels, PROVIDERS.openai.models);
    this.populateModelChoices(this.summaryClaudeModels, [
      { id: "opus", label: "Latest Opus alias" },
      { id: "sonnet", label: "Latest Sonnet alias" },
      { id: "haiku", label: "Latest Haiku alias" },
      { id: "fable", label: "Latest Fable alias" },
      ...PROVIDERS.anthropic.models,
    ]);
  }

  private showSummaryProviderFields(providerId: SummaryProviderId): void {
    this.summaryCodexFields.classList.toggle("hidden", providerId !== "codex");
    this.summaryClaudeFields.classList.toggle("hidden", providerId !== "claude");
    this.summaryGeminiFields.classList.toggle("hidden", providerId !== "gemini");
    this.summaryVertexFields.classList.toggle("hidden", providerId !== "vertex");
    this.summaryOpenaiFields.classList.toggle("hidden", providerId !== "openai");
    this.summaryAnthropicFields.classList.toggle("hidden", providerId !== "anthropic");
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

      const settings = IS_DISTRIBUTION ? mergeSettings(response.settings) : response.settings;
      this.savedSettingsBaseline = settings;
      this.providerDrafts = buildDraftSet(settings.providerSettings);
      this.populateProviders();
      this.providerSelect.value = settings.currentProvider;
      this.displayedProviderId = settings.currentProvider;
      this.populateModels(settings.currentProvider);
      this.renderProviderDraft(
        settings.currentProvider,
        this.providerDrafts[settings.currentProvider],
      );

      this.concurrencyInput.value = String(settings.maxConcurrency);
      this.customPromptInput.value = settings.customPrompt ?? "";
      this.cacheEnabledInput.checked = settings.cacheEnabled;

      this.populateSummaryModels();
      this.summaryAutoGenerateInput.checked = settings.summary.autoGenerate;
      this.summaryProviderSelect.value = settings.summary.provider;
      this.showSummaryProviderFields(settings.summary.provider);
      this.summaryCodexModelInput.value = settings.summary.codexModel ?? "";
      this.summaryClaudeModelInput.value = settings.summary.claudeModel ?? "";
      this.summaryGeminiApiKeyInput.value = settings.summary.geminiApiKey ?? "";
      this.summaryGeminiModelSelect.value = settings.summary.geminiModel ?? "";
      this.summaryVertexApiKeyInput.value = settings.summary.vertexApiKey ?? "";
      this.summaryVertexModelSelect.value = settings.summary.vertexModel ?? "";
      this.summaryOpenaiApiKeyInput.value = settings.summary.openaiApiKey ?? "";
      this.summaryOpenaiModelSelect.value = settings.summary.openaiModel ?? "";
      this.summaryAnthropicApiKeyInput.value = settings.summary.anthropicApiKey ?? "";
      this.summaryAnthropicModelSelect.value = settings.summary.anthropicModel ?? "";
      this.summaryPromptInput.value = settings.summary.prompt;
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

    const snapshot: ExtensionSettings = {
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
        openaiApiKey: toOptionalString(this.summaryOpenaiApiKeyInput.value),
        openaiModel: toOptionalString(this.summaryOpenaiModelSelect.value),
        anthropicApiKey: toOptionalString(this.summaryAnthropicApiKeyInput.value),
        anthropicModel: toOptionalString(this.summaryAnthropicModelSelect.value),
      },
    };
    return IS_DISTRIBUTION ? mergeSettings(snapshot) : snapshot;
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
        this.showSaveFailure(response.ok ? undefined : response.error, snapshot);
        return;
      }

      const settings = IS_DISTRIBUTION ? mergeSettings(response.settings) : response.settings;
      this.savedSettingsBaseline = settings;
      this.providerDrafts = buildDraftSet(settings.providerSettings);
      this.providerSelect.value = settings.currentProvider;
      this.displayedProviderId = settings.currentProvider;
      this.populateModels(this.displayedProviderId);
      this.renderProviderDraft(
        this.displayedProviderId,
        this.providerDrafts[this.displayedProviderId],
      );
      this.showToast("Settings saved");
    } catch (error) {
      this.showSaveFailure(error, snapshot);
    } finally {
      this.saveInProgress = false;
      this.setProviderSaveControlsDisabled(false);
    }
  }

  private showSaveFailure(error: unknown, snapshot: ExtensionSettings): void {
    const detail = (typeof error === "string"
      ? error
      : error instanceof Error ? error.message : "").trim();
    const secrets = [
      ...Object.values(this.savedSettingsBaseline?.providerSettings ?? {})
        .map((provider) => provider.apiKey),
      ...Object.values(this.providerDrafts ?? {}).map((draft) => draft.apiKey),
      ...Object.values(snapshot.providerSettings).map((provider) => provider.apiKey),
      this.savedSettingsBaseline?.summary.geminiApiKey,
      this.savedSettingsBaseline?.summary.vertexApiKey,
      this.savedSettingsBaseline?.summary.openaiApiKey,
      this.savedSettingsBaseline?.summary.anthropicApiKey,
      snapshot.summary.geminiApiKey,
      snapshot.summary.vertexApiKey,
      snapshot.summary.openaiApiKey,
      snapshot.summary.anthropicApiKey,
      this.apiKeyInput.value,
      this.summaryGeminiApiKeyInput.value,
      this.summaryVertexApiKeyInput.value,
      this.summaryOpenaiApiKeyInput.value,
      this.summaryAnthropicApiKeyInput.value,
    ].flatMap((secret) => secret ? [secret, secret.trim()] : [])
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    // The shared redactor skips short strings; suppress details in that case.
    const safeDetail = secrets.some((secret) => secret.length <= 4)
      ? ""
      : redactSecrets(detail, secrets);
    this.showToast(safeDetail
      ? `Failed to save settings: ${safeDetail}`
      : "Failed to save settings");
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
