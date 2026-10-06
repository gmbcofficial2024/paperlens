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
      openai: { apiKey: "saved-openai-key", model: "gpt-5.6-terra" },
      anthropic: { apiKey: "saved-anthropic-key", model: "claude-sonnet-5" },
      custom: { apiKey: "saved-custom-key", model: "private-custom-model", customUrl: "http://dormant.example.test/private" },
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

async function harness(settings: ExtensionSettings, distribution = true) {
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
  const updates: Array<{ settings: ExtensionSettings; respond(response: RuntimeResponse): void }> = [];
  const sendMessage = (async (message: RuntimeRequest): Promise<RuntimeResponse> => {
    if (message.type === "settings/get") return { ok: true, settings };
    if (message.type === "settings/update") return new Promise((resolve) => updates.push({ settings: message.settings, respond: resolve }));
    throw new Error(`Unexpected runtime request ${message.type}`);
  }) as OptionsSettingsEditSessionDependencies["sendMessage"];
  const permissions = {
    contains(_permission: unknown, callback: (result: boolean) => void) { permissionCalls.push("contains"); callback(false); },
    request(_permission: unknown, callback: (result: boolean) => void) { permissionCalls.push("request"); callback(false); },
  } as OptionsSettingsEditSessionDependencies["permissions"];
  const session = (distribution ? releaseFactory : developmentFactory)({ document, sendMessage, permissions });
  await session.start();
  return { document, window: parsed.window, updates, permissionCalls };
}

function select(document: Document, id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  assert.ok(element, `Missing Options select ${id}`);
  return element as HTMLSelectElement;
}

async function flush() {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

test("shared Options normalizes stale providers and Pro models into one disabled Flash Latest choice", async () => {
  for (const provider of ["custom", "openai", "anthropic", "vertex"] as const) {
    const page = await harness(staleSettings(provider));
    assert.deepEqual([...select(page.document, "provider").options].map((option) => option.value), ["gemini"]);
    assert.equal(select(page.document, "provider").value, "gemini");
    assert.equal(select(page.document, "provider").disabled, true);
    for (const id of ["model", "summary-gemini-model"]) {
      const model = select(page.document, id);
      assert.deepEqual([...model.options].map((option) => option.value), ["gemini-flash-latest"]);
      assert.equal(model.value, "gemini-flash-latest");
      assert.equal(model.disabled, true);
    }
    assert.deepEqual([...select(page.document, "summary-provider").options].map((option) => option.value), ["gemini", "codex", "claude"]);
    assert.equal(select(page.document, "summary-provider").value, "gemini");
    assert.equal(page.document.getElementById("summary-vertex-fields")!.classList.contains("hidden"), true);
    for (const id of ["translation-distribution-model-note", "summary-distribution-model-note"]) {
      const note = page.document.getElementById(id);
      assert.ok(note, "fixed release model should be explained to the reader");
      assert.equal(note.classList.contains("hidden"), false);
      assert.match(note.textContent ?? "", /Fixed in shared release: Gemini Flash Latest \(gemini-flash-latest\)/);
    }
  }
});

test("shared Save keeps the model fixed, retains credentials/native choices, and ignores dormant custom permissions", async () => {
  const baseline = staleSettings();
  const page = await harness(baseline);
  (page.document.getElementById("api-key") as HTMLInputElement).value = "  edited-gemini-key  ";
  const summaryProvider = select(page.document, "summary-provider");
  summaryProvider.value = "codex";
  summaryProvider.dispatchEvent(new page.window.Event("change"));
  (page.document.getElementById("save-btn") as HTMLButtonElement).click();
  await flush();
  assert.equal(page.updates.length, 1, "a dormant custom URL must not block the Gemini settings save");
  assert.deepEqual(page.permissionCalls, []);
  const saved = page.updates[0].settings;
  assert.equal(saved.currentProvider, "gemini");
  assert.equal(saved.providerSettings.gemini.model, "gemini-flash-latest");
  assert.equal(saved.providerSettings.gemini.apiKey, "edited-gemini-key");
  assert.equal(saved.summary.geminiModel, "gemini-flash-latest");
  assert.equal(saved.summary.geminiApiKey, "saved-summary-key");
  assert.equal(saved.summary.provider, "codex");
  assert.equal(saved.summary.codexModel, "saved-native-codex-model");
  assert.equal(saved.summary.claudeModel, "saved-native-claude-model");
  assert.equal(saved.providerSettings.openai.apiKey, "saved-openai-key");
  assert.equal(saved.providerSettings.anthropic.apiKey, "saved-anthropic-key");
  assert.equal(saved.providerSettings.vertex.apiKey, "saved-vertex-key");
  assert.deepEqual(saved.providerSettings.custom, baseline.providerSettings.custom);
  assert.equal(saved.summary.vertexApiKey, "saved-summary-vertex-key");
  // A stale runtime response must not unlock a forbidden provider or model.
  page.updates[0].respond({ ok: true, settings: staleSettings("openai", "codex") });
  await flush();
  assert.equal((page.document.getElementById("save-btn") as HTMLButtonElement).disabled, false);
  assert.equal((page.document.getElementById("api-key") as HTMLInputElement).disabled, false);
  for (const id of ["provider", "model", "summary-gemini-model"]) assert.equal(select(page.document, id).disabled, true);
  assert.equal(select(page.document, "provider").value, "gemini");
  assert.equal(select(page.document, "model").value, "gemini-flash-latest");
  assert.equal(select(page.document, "summary-gemini-model").value, "gemini-flash-latest");
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
    for (const id of ["provider", "model", "summary-gemini-model"]) assert.equal(select(page.document, id).disabled, true);
    assert.equal(select(page.document, "summary-provider").disabled, false);
    assert.equal(select(page.document, "summary-provider").value, provider);
    assert.deepEqual(page.permissionCalls, []);
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
