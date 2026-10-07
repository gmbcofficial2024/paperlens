import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { ExtensionSettings } from "../src/shared/types";
import type { ProviderCallOptions, PreparedProviderRequest } from "../src/shared/provider-protocol";

interface Edition {
  mergeSettings(raw: unknown): ExtensionSettings;
  defaultSettings(): ExtensionSettings;
  prepareProviderRequest(options: ProviderCallOptions): PreparedProviderRequest;
  readSettings(): Promise<ExtensionSettings>;
  writeSettings(settings: ExtensionSettings): Promise<ExtensionSettings>;
  translationConfigurationKey(settings: ExtensionSettings): Promise<string>;
}

const repoRoot = process.cwd();
const outputDirs: string[] = [];
const editions = new Map<string, Promise<Edition>>();

function edition(distribution: boolean): Promise<Edition> {
  const name = distribution ? "distribution" : "development";
  if (!editions.has(name)) {
    editions.set(name, (async () => {
      const directory = await mkdtemp(path.join(tmpdir(), `paperlens-${name}-core-`));
      outputDirs.push(directory);
      const output = path.join(directory, "core.mjs");
      // Build the real production entry points in a child process: bundling
      // esbuild into the test itself would replace its native package loader.
      const compiler = [
        'import {build} from "esbuild";',
        'const define = process.argv[2] === "true" ? {__PAPERLENS_DISTRIBUTION__: "true"} : {};',
        'await build({stdin:{contents:`',
        'export {mergeSettings,defaultSettings} from "./src/shared/schema";',
        'export {prepareProviderRequest} from "./src/shared/provider-protocol";',
        'export {readSettings,writeSettings} from "./src/shared/storage";',
        'export {translationConfigurationKey} from "./src/shared/runtime-policy";',
        '`,resolveDir:process.cwd(),loader:"ts"},outfile:process.argv[1],bundle:true,format:"esm",platform:"node",target:"node22",define,logLevel:"silent"});',
      ].join("\n");
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", compiler, output, String(distribution)], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return await import(pathToFileURL(output).href) as Edition;
    })());
  }
  return editions.get(name)!;
}

after(async () => {
  for (const directory of outputDirs) await rm(directory, { recursive: true, force: true });
});

function legacySettings(): ExtensionSettings {
  return {
    currentProvider: "openai",
    providerSettings: {
      gemini: { model: "gemini-pro-latest", apiKey: "synthetic-gemini-key" },
      vertex: { model: "gemini-3.8-flash", apiKey: "synthetic-vertex-key" },
      openai: { model: "gpt-6.1-sol", apiKey: "synthetic-openai-key" },
      anthropic: { model: "claude-sonnet-5-5", apiKey: "synthetic-anthropic-key" },
      custom: { model: "private-model", apiKey: "synthetic-custom-key", customUrl: "https://api.example.test/v1/chat/completions" },
    },
    cacheEnabled: true,
    maxConcurrency: 4,
    customPrompt: "Keep scientific terminology.",
    summary: {
      provider: "vertex",
      autoGenerate: false,
      prompt: "Preserve measurement limitations.",
      geminiModel: "arbitrary-summary-model",
      geminiApiKey: "synthetic-gemini-summary-key",
      vertexModel: "gemini-3.8-flash",
      vertexApiKey: "synthetic-vertex-summary-key",
      codexModel: "native-codex-model",
      claudeModel: "native-claude-model",
    },
  };
}

test("distribution fixes only Gemini models and preserves selected providers and credentials", async () => {
  const core = await edition(true);
  const original = legacySettings();
  const before = structuredClone(original);
  const saved = core.mergeSettings(original);
  assert.equal(saved.currentProvider, "openai");
  assert.equal(saved.providerSettings.gemini.model, "gemini-flash-latest");
  assert.equal(saved.summary.provider, "vertex");
  assert.equal(saved.summary.geminiModel, "gemini-flash-latest");
  assert.equal(saved.providerSettings.gemini.apiKey, "synthetic-gemini-key");
  assert.equal(saved.summary.geminiApiKey, "synthetic-gemini-summary-key");
  for (const provider of ["vertex", "openai", "anthropic", "custom"] as const) {
    assert.deepEqual(saved.providerSettings[provider], original.providerSettings[provider]);
  }
  assert.equal(saved.summary.vertexApiKey, "synthetic-vertex-summary-key");
  assert.equal(saved.customPrompt, "Keep scientific terminology.");
  assert.equal(saved.summary.prompt, "Preserve measurement limitations.");
  assert.equal(saved.maxConcurrency, 4);
  assert.deepEqual(original, before, "normalization must not mutate the caller's settings");
});

for (const provider of ["vertex", "anthropic", "custom"] as const) {
  test(`distribution preserves the selected ${provider} translation provider and its settings`, async () => {
    const raw = legacySettings();
    raw.currentProvider = provider;
    const settings = (await edition(true)).mergeSettings(raw);
    assert.equal(settings.currentProvider, provider);
    assert.deepEqual(settings.providerSettings[provider], raw.providerSettings[provider]);
    assert.equal(settings.providerSettings.gemini.model, "gemini-flash-latest");
  });
}

test("fresh distribution settings explicitly expose the fixed Gemini API model", async () => {
  const settings = (await edition(true)).defaultSettings();
  assert.equal(settings.currentProvider, "gemini");
  assert.equal(settings.providerSettings.gemini.model, "gemini-flash-latest");
  assert.equal(settings.summary.provider, "gemini");
  assert.equal(settings.summary.geminiModel, "gemini-flash-latest");
});

for (const provider of ["codex", "claude"] as const) {
  test(`distribution preserves the saved ${provider} native summary choice and model`, async () => {
    const raw = legacySettings();
    raw.summary.provider = provider;
    const settings = (await edition(true)).mergeSettings(raw);
    assert.equal(settings.summary.provider, provider);
    assert.equal(settings.summary.codexModel, "native-codex-model");
    assert.equal(settings.summary.claudeModel, "native-claude-model");
    assert.equal(settings.summary.geminiModel, "gemini-flash-latest");
  });
}

test("distribution applies the policy on local settings reads and persisted updates", async () => {
  const core = await edition(true);
  const records: Record<string, unknown> = { paperlens_settings_v1: legacySettings() };
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { storage: { local: {
      async get(keys: string[]) { return Object.fromEntries(keys.map(key => [key, records[key]])); },
      async set(values: Record<string, unknown>) { Object.assign(records, values); },
    } } },
  });
  try {
    const read = await core.readSettings();
    assert.equal(read.currentProvider, "openai");
    assert.equal(read.summary.geminiModel, "gemini-flash-latest");
    const written = await core.writeSettings(legacySettings());
    assert.equal(written.providerSettings.gemini.model, "gemini-flash-latest");
    const persisted = records.paperlens_settings_v1 as ExtensionSettings;
    assert.equal(persisted.currentProvider, "openai");
    assert.equal(persisted.summary.provider, "vertex");
    assert.equal(persisted.summary.geminiModel, "gemini-flash-latest");
    assert.equal(persisted.providerSettings.openai.apiKey, "synthetic-openai-key");
  } finally {
    if (previousChrome) Object.defineProperty(globalThis, "chrome", previousChrome);
    else delete (globalThis as { chrome?: unknown }).chrome;
  }
});

for (const mode of [
  { outputMode: "json" as const, stream: false, endpoint: "generateContent" },
  { outputMode: "json" as const, stream: true, endpoint: "streamGenerateContent?alt=sse" },
  { outputMode: "text" as const, stream: false, endpoint: "generateContent" },
]) {
  test(`distribution clamps the final Gemini ${mode.outputMode}/${mode.stream ? "stream" : "once"} request to Flash Latest`, async () => {
    const prepared = (await edition(true)).prepareProviderRequest({
      provider: "gemini",
      setting: { apiKey: "synthetic-gemini-request-key", model: "gemini-pro-latest" },
      systemPrompt: "Translate faithfully.",
      userPrompt: "Synthetic source text.",
      outputMode: mode.outputMode,
      stream: mode.stream,
    });
    assert.equal(prepared.url, `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:${mode.endpoint}`);
    assert.equal((prepared.init.headers as Record<string, string>)["x-goog-api-key"], "synthetic-gemini-request-key");
  });
}

for (const request of [
  {
    provider: "vertex" as const,
    model: "gemini-3.1-pro-preview",
    url: "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-pro-preview:generateContent?key=synthetic-vertex-key",
    headers: { "Content-Type": "application/json" },
  },
  {
    provider: "openai" as const,
    model: "gpt-6.1-sol",
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-openai-key" },
  },
  {
    provider: "anthropic" as const,
    model: "claude-sonnet-5-5",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "synthetic-anthropic-key",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  },
  {
    provider: "custom" as const,
    model: "private-model",
    url: "https://api.example.test/v1/chat/completions",
    headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-custom-key" },
  },
]) {
  test(`distribution preserves a direct ${request.provider} request's endpoint, model and credentials`, async () => {
    const core = await edition(true);
    const prepared = core.prepareProviderRequest({
      provider: request.provider,
      setting: { ...legacySettings().providerSettings[request.provider], model: request.model },
      systemPrompt: "Translate faithfully.",
      userPrompt: "Synthetic source text.",
      outputMode: "json",
      stream: false,
    });
    assert.equal(prepared.url, request.url);
    assert.deepEqual(prepared.init.headers, request.headers);
    const body = JSON.parse(prepared.init.body as string);
    if (request.provider !== "vertex") assert.equal(body.model, request.model);
  });
}

test("an absent distribution define retains development providers, models and native choices", async () => {
  const core = await edition(false);
  const settings = core.mergeSettings(legacySettings());
  assert.equal(settings.currentProvider, "openai");
  assert.equal(settings.providerSettings.gemini.model, "gemini-pro-latest");
  assert.equal(settings.summary.provider, "vertex");
  assert.equal(settings.summary.geminiModel, "arbitrary-summary-model");
  const native = legacySettings();
  native.summary.provider = "codex";
  assert.equal(core.mergeSettings(native).summary.provider, "codex");
  for (const provider of ["gemini", "vertex", "openai", "anthropic", "custom"] as const) {
    const prepared = core.prepareProviderRequest({
      provider,
      setting: settings.providerSettings[provider],
      systemPrompt: "Translate faithfully.",
      userPrompt: "Synthetic source text.",
      outputMode: "json",
      stream: false,
    });
    assert.ok(prepared.url, provider);
    if (provider === "gemini") assert.match(prepared.url, /models\/gemini-pro-latest:/);
  }
});

test("configuration keys reflect the normalized distribution model and preserve development model distinctions", async () => {
  const rawPro = legacySettings();
  rawPro.currentProvider = "gemini";
  const rawFlash = structuredClone(rawPro);
  rawFlash.providerSettings.gemini.model = "gemini-flash-latest";
  const release = await edition(true);
  assert.equal(
    await release.translationConfigurationKey(release.mergeSettings(rawPro)),
    await release.translationConfigurationKey(release.mergeSettings(rawFlash)),
  );
  const development = await edition(false);
  assert.notEqual(
    await development.translationConfigurationKey(development.mergeSettings(rawPro)),
    await development.translationConfigurationKey(development.mergeSettings(rawFlash)),
  );
});

test("distribution configuration keys still distinguish non-Gemini models", async () => {
  const rawTerra = legacySettings();
  const rawLuna = structuredClone(rawTerra);
  rawLuna.providerSettings.openai.model = "gpt-6-luna";
  const release = await edition(true);
  assert.notEqual(
    await release.translationConfigurationKey(release.mergeSettings(rawTerra)),
    await release.translationConfigurationKey(release.mergeSettings(rawLuna)),
  );
});
