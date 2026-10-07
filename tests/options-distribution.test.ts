import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";
import type { OptionsSettingsEditSessionDependencies } from "../src/options/settings-edit-session";
import type { RuntimeRequest, RuntimeResponse } from "../src/shared/messages";
import { mergeSettings } from "../src/shared/schema";
import type { ExtensionSettings, ProviderId, SummaryProviderId } from "../src/shared/types";

type Factory = (dependencies: OptionsSettingsEditSessionDependencies) => { start(): Promise<void> };
let releaseFactory: Factory;
let developmentFactory: Factory;
let buildDirectory: string;
let html: string;

before(async () => {
  const require = createRequire(path.resolve("package.json"));
  const { build } = require("esbuild");
  buildDirectory = await mkdtemp(path.join(tmpdir(), "paperlens-options-policy-"));
  html = await readFile("options.html", "utf8");
  const factories = await Promise.all([true, false].map(async (distribution) => {
    const file = path.join(buildDirectory, `${distribution ? "release" : "development"}.mjs`);
    await build({
      entryPoints: ["src/options/settings-edit-session.ts"], outfile: file,
      bundle: true, format: "esm", platform: "node", target: "node20", logLevel: "silent",
      define: { __PAPERLENS_DISTRIBUTION__: String(distribution) },
    });
    const module = await import(pathToFileURL(file).href);
    return module.createOptionsSettingsEditSession as Factory;
  }));
  [releaseFactory, developmentFactory] = factories;
});

after(async () => {
  if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true });
});

function staleSettings(currentProvider: ProviderId = "custom", summaryProvider: SummaryProviderId = "vertex"): ExtensionSettings {
  return {
    currentProvider,
    providerSettings: {
      gemini: { apiKey: "saved-gemini-key", model: "gemini-pro-latest" },
      vertex: { apiKey: "saved-vertex-key", model: "gemini-3.1-pro-preview" },
      openai: { apiKey: "saved-openai-key", model: "gpt-6.1-sol" },
      anthropic: { apiKey: "saved-anthropic-key", model: "claude-sonnet-5-5" },
      custom: { apiKey: "saved-custom-key", model: "private-custom-model", customUrl: "https://dormant.example.test/private" },
    },
    maxConcurrency: 3, cacheEnabled: true, customPrompt: "Keep source details.",
    summary: {
      provider: summaryProvider, autoGenerate: false, prompt: "Keep claims separate.",
      geminiApiKey: "saved-summary-key", geminiModel: "gemini-pro-latest",
      vertexApiKey: "saved-summary-vertex-key", vertexModel: "gemini-3.1-pro-preview",
      codexModel: "saved-native-codex-model", claudeModel: "saved-native-claude-model",
    },
  };
}

async function harness(settings: ExtensionSettings, distribution = true, permissionResults = { contains: true, request: true }) {
  const parsed = parseHTML(html);
  const selectPrototype = Object.getPrototypeOf(parsed.document.createElement("select"));
  Object.defineProperty(selectPrototype, "value", {
    configurable: true,
    get(this: HTMLSelectElement) { return [...this.options].find((option) => option.selected)?.value ?? ""; },
    set(this: HTMLSelectElement, value: string) {
      const options = [...this.options];
      for (const option of options) option.removeAttribute("selected");
      const selected = options.find((option) => option.value === value);
      if (selected) selected.selected = true;
    },
  });
  Object.defineProperty(parsed.window, "setTimeout", { configurable: true, value: () => 0 });
  const document = parsed.document as unknown as Document;
  const permissionCalls: string[] = [];
  const permissionOrigins: unknown[] = [];
  const updates: Array<{ settings: ExtensionSettings; respond(response: RuntimeResponse): void }> = [];
  const sendMessage = (async (message: RuntimeRequest): Promise<RuntimeResponse> => {
    if (message.type === "settings/get") return { ok: true, settings };
    if (message.type === "settings/update") return new Promise((resolve) => updates.push({ settings: message.settings, respond: resolve }));
    throw new Error(`Unexpected runtime request ${message.type}`);
  }) as OptionsSettingsEditSessionDependencies["sendMessage"];
  const permissions = {
    contains(permission: unknown, callback: (result: boolean) => void) { permissionCalls.push("contains"); permissionOrigins.push(permission); callback(permissionResults.contains); },
    request(permission: unknown, callback: (result: boolean) => void) { permissionCalls.push("request"); permissionOrigins.push(permission); callback(permissionResults.request); },
  } as OptionsSettingsEditSessionDependencies["permissions"];
  const session = (distribution ? releaseFactory : developmentFactory)({ document, sendMessage, permissions });
  await session.start();
  return { document, window: parsed.window, updates, permissionCalls, permissionOrigins };
}

function select(document: Document, id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  assert.ok(element, `Missing Options select ${id}`);
  return element as HTMLSelectElement;
}

async function flush() {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

const legacyOptionsCases = [
  {
    openai: "gpt-5.6-sol", currentOpenai: "gpt-6.1-sol",
    anthropic: "claude-opus-4-8", currentAnthropic: "claude-opus-5-5",
    codex: "gpt-5.5", currentCodex: "gpt-6.1-sol",
  },
  {
    openai: "gpt-5.6-terra", currentOpenai: "gpt-6.1-sol",
    anthropic: "claude-sonnet-5", currentAnthropic: "claude-sonnet-5-5",
    codex: "private-native-codex-model", currentCodex: "private-native-codex-model",
  },
  {
    openai: "gpt-5.6-luna", currentOpenai: "gpt-6-luna",
    anthropic: "claude-haiku-4-5-20251001", currentAnthropic: "claude-haiku-4-5-20251001",
    codex: undefined, currentCodex: "gpt-6.1-sol",
  },
];

for (const distribution of [false, true]) {
  for (const legacyCase of legacyOptionsCases) {
    test(`${distribution ? "release" : "development"} Options keeps migrated ${legacyCase.openai} models and keys through failed Save and reopening`, async () => {
      const legacy = staleSettings("openai", "vertex");
      legacy.providerSettings.vertex.model = "gemini-3.6-flash";
      legacy.providerSettings.openai.model = legacyCase.openai;
      legacy.providerSettings.anthropic.model = legacyCase.anthropic;
      legacy.summary.vertexModel = "gemini-3.6-flash";
      legacy.summary.codexModel = legacyCase.codex;
      legacy.summary.claudeModel = "opus";
      // The worker normalizes persisted settings before serving Options;
      // release Options also runs its distribution-compiled normalization.
      const page = await harness(mergeSettings(legacy), distribution);
      const expected = {
        gemini: { key: "saved-gemini-key", model: distribution ? "gemini-flash-latest" : "gemini-pro-latest" },
        vertex: { key: "saved-vertex-key", model: "gemini-3.8-flash" },
        openai: { key: "saved-openai-key", model: legacyCase.currentOpenai },
        anthropic: { key: "saved-anthropic-key", model: legacyCase.currentAnthropic },
        custom: { key: "saved-custom-key", model: "private-custom-model" },
      };
      const visit = (currentPage: typeof page, provider: ProviderId) => {
        const providerSelect = select(currentPage.document, "provider");
        providerSelect.value = provider;
        providerSelect.dispatchEvent(new currentPage.window.Event("change"));
      };
      const assertDraft = (currentPage: typeof page, provider: ProviderId, key: string) => {
        assert.equal(select(currentPage.document, "provider").value, provider);
        assert.equal((currentPage.document.getElementById("api-key") as HTMLInputElement).value, key);
        if (provider === "custom") {
          assert.equal((currentPage.document.getElementById("custom-model") as HTMLInputElement).value, expected.custom.model);
          assert.equal((currentPage.document.getElementById("custom-url") as HTMLInputElement).value, "https://dormant.example.test/private");
        } else {
          const model = select(currentPage.document, "model");
          assert.ok([...model.options].some((option) => option.value === expected[provider].model), `${provider} mapped model must remain selectable`);
          assert.equal(model.value, expected[provider].model);
        }
      };
      assert.equal((page.document.getElementById("summary-codex-model") as HTMLInputElement).value, legacyCase.currentCodex);
      assert.equal((page.document.getElementById("summary-claude-model") as HTMLInputElement).value, "opus");
      assert.equal(select(page.document, "summary-vertex-model").value, "gemini-3.8-flash");

      const providers: ProviderId[] = ["gemini", "vertex", "openai", "anthropic", "custom"];
      for (const provider of providers) {
        visit(page, provider);
        assertDraft(page, provider, expected[provider].key);
        (page.document.getElementById("api-key") as HTMLInputElement).value = `  ${expected[provider].key}-draft  `;
      }
      visit(page, "openai");
      (page.document.getElementById("save-btn") as HTMLButtonElement).click();
      await flush();
      assert.equal(page.updates.length, 1);
      const assertSnapshot = (snapshot: ExtensionSettings) => {
        assert.equal(snapshot.currentProvider, "openai");
        for (const provider of providers) {
          assert.equal(snapshot.providerSettings[provider].apiKey, `${expected[provider].key}-draft`);
          assert.equal(snapshot.providerSettings[provider].model, expected[provider].model);
        }
        assert.equal(snapshot.summary.provider, "vertex");
        assert.equal(snapshot.summary.vertexModel, "gemini-3.8-flash");
        assert.equal(snapshot.summary.geminiApiKey, "saved-summary-key");
        assert.equal(snapshot.summary.vertexApiKey, "saved-summary-vertex-key");
        assert.equal(snapshot.summary.codexModel, legacyCase.currentCodex);
        assert.equal(snapshot.summary.claudeModel, "opus");
      };
      assertSnapshot(page.updates[0].settings);
      page.updates[0].respond({ ok: false, error: "controlled storage failure" });
      await flush();
      assert.equal(select(page.document, "provider").disabled, false);
      for (const provider of providers) {
        visit(page, provider);
        assertDraft(page, provider, `  ${expected[provider].key}-draft  `);
      }

      visit(page, "openai");
      (page.document.getElementById("save-btn") as HTMLButtonElement).click();
      await flush();
      assert.equal(page.updates.length, 2);
      assertSnapshot(page.updates[1].settings);
      const persisted = mergeSettings(page.updates[1].settings);
      page.updates[1].respond({ ok: true, settings: persisted });
      await flush();
      assertDraft(page, "openai", "saved-openai-key-draft");

      const reopened = await harness(persisted, distribution);
      assert.equal(select(reopened.document, "provider").value, "openai");
      for (const provider of providers) {
        visit(reopened, provider);
        assertDraft(reopened, provider, `${expected[provider].key}-draft`);
      }
      assert.equal(select(reopened.document, "summary-provider").value, "vertex");
      assert.equal(select(reopened.document, "summary-vertex-model").value, "gemini-3.8-flash");
      assert.equal((reopened.document.getElementById("summary-codex-model") as HTMLInputElement).value, legacyCase.currentCodex);
      assert.equal((reopened.document.getElementById("summary-claude-model") as HTMLInputElement).value, "opus");
      assert.equal((reopened.document.getElementById("summary-gemini-api-key") as HTMLInputElement).value, "saved-summary-key");
      assert.equal((reopened.document.getElementById("summary-vertex-api-key") as HTMLInputElement).value, "saved-summary-vertex-key");
    });
  }
}

test("shared Options retains every provider and fixes only Gemini model choices", async () => {
  for (const provider of ["gemini", "custom", "openai", "anthropic", "vertex"] as const) {
    const page = await harness(staleSettings(provider));
    assert.deepEqual([...select(page.document, "provider").options].map((option) => option.value), ["gemini", "vertex", "openai", "anthropic", "custom"]);
    assert.equal(select(page.document, "provider").value, provider);
    assert.equal(select(page.document, "provider").disabled, false);
    const model = select(page.document, "model");
    assert.equal(model.disabled, provider === "gemini");
    if (provider === "gemini") {
      assert.deepEqual([...model.options].map((option) => option.value), ["gemini-flash-latest"]);
      assert.equal(model.value, "gemini-flash-latest");
    } else if (provider === "custom") {
      assert.equal(page.document.getElementById("model-field")!.classList.contains("hidden"), true);
      assert.equal((page.document.getElementById("custom-model") as HTMLInputElement).disabled, false);
      assert.equal((page.document.getElementById("custom-url") as HTMLInputElement).disabled, false);
    } else {
      assert.equal(model.options.length, provider === "anthropic" ? 4 : 3);
      assert.notEqual(model.value, "gemini-flash-latest");
    }
    const summaryGemini = select(page.document, "summary-gemini-model");
    assert.deepEqual([...summaryGemini.options].map((option) => option.value), ["gemini-flash-latest"]);
    assert.equal(summaryGemini.value, "gemini-flash-latest");
    assert.equal(summaryGemini.disabled, true);
    assert.deepEqual([...select(page.document, "summary-provider").options].map((option) => option.value), ["gemini", "vertex", "codex", "claude"]);
    assert.equal(select(page.document, "summary-provider").value, "vertex");
    assert.equal(select(page.document, "summary-vertex-model").disabled, false);
    assert.equal(page.document.getElementById("summary-vertex-fields")!.classList.contains("hidden"), false);
    const note = page.document.getElementById("translation-distribution-model-note")!;
    assert.equal(note.classList.contains("hidden"), provider !== "gemini");
    assert.match(note.textContent ?? "", /Fixed in shared release: Gemini Flash Latest \(gemini-flash-latest\)/);
    assert.equal(page.document.getElementById("summary-distribution-model-note")!.classList.contains("hidden"), false);
  }
});

test("shared provider switching and Save preserve editable non-Gemini drafts with both Gemini models fixed", async () => {
  const baseline = staleSettings("openai", "vertex");
  const page = await harness(baseline);
  const providerSelect = select(page.document, "provider");
  const model = select(page.document, "model");
  const apiKey = page.document.getElementById("api-key") as HTMLInputElement;
  const changeProvider = (provider: ProviderId) => {
    providerSelect.value = provider;
    providerSelect.dispatchEvent(new page.window.Event("change"));
  };
  apiKey.value = "  edited-openai-key  ";
  model.value = "gpt-6.1-sol";
  changeProvider("gemini");
  apiKey.value = "  edited-gemini-key  ";
  assert.equal(model.value, "gemini-flash-latest");
  assert.equal(model.disabled, true);
  changeProvider("vertex");
  apiKey.value = "  edited-vertex-key  ";
  model.value = "gemini-3.8-flash";
  assert.equal(model.disabled, false);
  changeProvider("custom");
  apiKey.value = "  edited-custom-key  ";
  (page.document.getElementById("custom-model") as HTMLInputElement).value = "edited-custom-model";
  (page.document.getElementById("custom-url") as HTMLInputElement).value = "https://custom.example.test/v1/chat/completions";
  changeProvider("openai");
  select(page.document, "summary-vertex-model").value = "gemini-3.8-flash";
  (page.document.getElementById("save-btn") as HTMLButtonElement).click();
  await flush();
  assert.equal(page.updates.length, 1);
  assert.deepEqual(page.permissionCalls, ["contains"]);
  const saved = page.updates[0].settings;
  assert.equal(saved.currentProvider, "openai");
  assert.equal(saved.providerSettings.gemini.model, "gemini-flash-latest");
  assert.equal(saved.providerSettings.gemini.apiKey, "edited-gemini-key");
  assert.equal(saved.summary.geminiModel, "gemini-flash-latest");
  assert.equal(saved.summary.geminiApiKey, "saved-summary-key");
  assert.equal(saved.summary.provider, "vertex");
  assert.equal(saved.summary.vertexModel, "gemini-3.8-flash");
  assert.equal(saved.summary.codexModel, "saved-native-codex-model");
  assert.equal(saved.summary.claudeModel, "saved-native-claude-model");
  assert.equal(saved.providerSettings.openai.apiKey, "edited-openai-key");
  assert.equal(saved.providerSettings.openai.model, "gpt-6.1-sol");
  assert.equal(saved.providerSettings.anthropic.apiKey, "saved-anthropic-key");
  assert.equal(saved.providerSettings.vertex.apiKey, "edited-vertex-key");
  assert.equal(saved.providerSettings.vertex.model, "gemini-3.8-flash");
  assert.deepEqual(saved.providerSettings.custom, { apiKey: "edited-custom-key", model: "edited-custom-model", customUrl: "https://custom.example.test/v1/chat/completions" });
  assert.equal(saved.summary.vertexApiKey, "saved-summary-vertex-key");
  // A stale Gemini model in the runtime response is clamped without replacing other choices.
  page.updates[0].respond({ ok: true, settings: { ...saved, providerSettings: { ...saved.providerSettings, gemini: { ...saved.providerSettings.gemini, model: "gemini-pro-latest" } }, summary: { ...saved.summary, geminiModel: "gemini-pro-latest" } } });
  await flush();
  assert.equal((page.document.getElementById("save-btn") as HTMLButtonElement).disabled, false);
  assert.equal(apiKey.disabled, false);
  assert.equal(providerSelect.disabled, false);
  assert.equal(providerSelect.value, "openai");
  assert.equal(model.disabled, false);
  assert.equal(model.value, "gpt-6.1-sol");
  assert.equal(select(page.document, "summary-vertex-model").disabled, false);
  assert.equal(select(page.document, "summary-gemini-model").disabled, true);
  assert.equal(select(page.document, "summary-gemini-model").value, "gemini-flash-latest");
  changeProvider("gemini");
  assert.equal(model.value, "gemini-flash-latest");
  assert.equal(model.disabled, true);
  assert.equal(apiKey.value, "edited-gemini-key");
  changeProvider("vertex");
  assert.equal(model.disabled, false);
  assert.equal(model.value, "gemini-3.8-flash");
  assert.equal(apiKey.value, "edited-vertex-key");
  changeProvider("custom");
  assert.equal((page.document.getElementById("custom-model") as HTMLInputElement).value, "edited-custom-model");
  assert.equal((page.document.getElementById("custom-url") as HTMLInputElement).value, "https://custom.example.test/v1/chat/completions");
  assert.equal(apiKey.value, "edited-custom-key");
});

test("shared native summary selections remain available while API models stay fixed after failed Save", async () => {
  for (const provider of ["codex", "claude"] as const) {
    const page = await harness(staleSettings("gemini", provider));
    assert.equal(select(page.document, "summary-provider").value, provider);
    assert.equal(select(page.document, "summary-provider").disabled, false);
    assert.equal(page.document.getElementById(`summary-${provider}-fields`)!.classList.contains("hidden"), false);
    (page.document.getElementById("save-btn") as HTMLButtonElement).click();
    await flush();
    assert.equal(page.updates.length, 1);
    assert.equal(page.updates[0].settings.summary.provider, provider);
    page.updates[0].respond({ ok: false, error: "controlled storage failure" });
    await flush();
    assert.equal(select(page.document, "provider").disabled, false);
    for (const id of ["model", "summary-gemini-model"]) assert.equal(select(page.document, id).disabled, true);
    assert.equal(select(page.document, "summary-vertex-model").disabled, false);
    assert.equal(select(page.document, "summary-provider").disabled, false);
    assert.equal(select(page.document, "summary-provider").value, provider);
    assert.deepEqual(page.permissionCalls, ["contains"]);
  }
});

test("development Options retains original provider and model selection without release-only notes", async () => {
  const page = await harness(staleSettings("openai", "vertex"), false);
  assert.deepEqual([...select(page.document, "provider").options].map((option) => option.value), ["gemini", "vertex", "openai", "anthropic", "custom"]);
  assert.equal(select(page.document, "provider").value, "openai");
  assert.equal(select(page.document, "provider").disabled, false);
  assert.equal(select(page.document, "model").disabled, false);
  assert.equal(select(page.document, "summary-gemini-model").options.length, 3);
  assert.equal(select(page.document, "summary-provider").value, "vertex");
  for (const id of ["translation-distribution-model-note", "summary-distribution-model-note"]) {
    assert.equal(page.document.getElementById(id)?.classList.contains("hidden"), true);
  }
});

test("shared Custom HTTPS API uses normal permission requests and saves its selected model", async () => {
  const page = await harness(staleSettings("custom", "claude"), true, { contains: false, request: true });
  (page.document.getElementById("custom-model") as HTMLInputElement).value = "lab-custom-model";
  (page.document.getElementById("custom-url") as HTMLInputElement).value = "https://lab.example.test/v1/chat/completions";
  (page.document.getElementById("save-btn") as HTMLButtonElement).click();
  await flush();
  assert.deepEqual(page.permissionCalls, ["contains", "request"]);
  assert.deepEqual(page.permissionOrigins, [{ origins: ["https://lab.example.test/*"] }, { origins: ["https://lab.example.test/*"] }]);
  assert.equal(page.updates.length, 1);
  assert.equal(page.updates[0].settings.currentProvider, "custom");
  assert.equal(page.updates[0].settings.providerSettings.custom.model, "lab-custom-model");
  assert.equal(page.updates[0].settings.summary.provider, "claude");
  page.updates[0].respond({ ok: true, settings: page.updates[0].settings });
  await flush();
  assert.equal(select(page.document, "provider").disabled, false);
  assert.equal((page.document.getElementById("custom-model") as HTMLInputElement).disabled, false);
  assert.equal((page.document.getElementById("custom-url") as HTMLInputElement).disabled, false);
});

test("shared Custom permission denial prevents settings writes and keeps editable drafts", async () => {
  const page = await harness(staleSettings("custom"), true, { contains: false, request: false });
  (page.document.getElementById("custom-model") as HTMLInputElement).value = "unsaved-custom-model";
  (page.document.getElementById("save-btn") as HTMLButtonElement).click();
  await flush();
  assert.deepEqual(page.permissionCalls, ["contains", "request"]);
  assert.equal(page.updates.length, 0);
  assert.equal(page.document.getElementById("toast")!.textContent, "Custom API permission denied");
  assert.equal((page.document.getElementById("custom-model") as HTMLInputElement).value, "unsaved-custom-model");
  assert.equal((page.document.getElementById("custom-model") as HTMLInputElement).disabled, false);
  assert.equal(select(page.document, "provider").disabled, false);
});
