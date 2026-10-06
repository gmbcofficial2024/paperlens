import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  createOptionsSettingsEditSession,
  type OptionsSettingsEditSessionDependencies,
} from "../src/options/settings-edit-session";
import type { RuntimeRequest, RuntimeResponse } from "../src/shared/messages";
import type { ExtensionSettings, ProviderId } from "../src/shared/types";

interface PendingUpdate {
  settings: ExtensionSettings;
  responded: boolean;
  respond(response: RuntimeResponse): void;
  reject(error: Error): void;
}

class FakeOptionsRuntime {
  readonly updateCalls: PendingUpdate[] = [];
  readonly cacheResponses: Array<{ ok: true } | { ok: false; error: string } | Error> = [];
  cacheClearCalls = 0;

  constructor(private readonly initialSettings: ExtensionSettings) {}

  readonly sendMessage = (async (message: RuntimeRequest): Promise<RuntimeResponse> => {
    if (message.type === "settings/get") {
      return { ok: true, settings: this.initialSettings };
    }
    if (message.type === "settings/update") {
      return new Promise<RuntimeResponse>((resolve, reject) => {
        const call: PendingUpdate = {
          settings: message.settings,
          responded: false,
          respond(response) {
            if (call.responded) return;
            call.responded = true;
            queueMicrotask(() => resolve(response));
          },
          reject(error) {
            if (call.responded) return;
            call.responded = true;
            queueMicrotask(() => reject(error));
          },
        };
        this.updateCalls.push(call);
      });
    }
    if (message.type === "cache/clear") {
      this.cacheClearCalls++;
      const response = this.cacheResponses.shift() ?? { ok: true as const };
      if (response instanceof Error) throw response;
      return response;
    }
    return { ok: false, error: `Unexpected runtime request: ${message.type}` };
  }) as OptionsSettingsEditSessionDependencies["sendMessage"];
}

class FakePermissions {
  readonly containsCalls: chrome.permissions.Permissions[] = [];
  readonly requestCalls: chrome.permissions.Permissions[] = [];

  constructor(
    private readonly containsResult = true,
    private readonly requestResult = true,
  ) {}

  contains(
    permissions: chrome.permissions.Permissions,
    callback: (result: boolean) => void,
  ): void {
    this.containsCalls.push(permissions);
    queueMicrotask(() => callback(this.containsResult));
  }

  request(
    permissions: chrome.permissions.Permissions,
    callback: (granted: boolean) => void,
  ): void {
    this.requestCalls.push(permissions);
    queueMicrotask(() => callback(this.requestResult));
  }
}

interface OptionsHarness {
  document: Document;
  window: Window;
  runtime: FakeOptionsRuntime;
  permissions: FakePermissions;
}

function initialSettings(): ExtensionSettings {
  return {
    currentProvider: "gemini",
    providerSettings: {
      gemini: { apiKey: "saved-gemini", model: "gemini-flash-latest" },
      vertex: { apiKey: "saved-vertex", model: "gemini-3.6-flash" },
      openai: { apiKey: "saved-openai", model: "gpt-5.6-terra" },
      anthropic: { apiKey: "saved-anthropic", model: "claude-sonnet-5" },
      custom: {},
    },
    cacheEnabled: true,
    maxConcurrency: 3,
    customPrompt: "Translate faithfully.",
    summary: {
      provider: "gemini",
      autoGenerate: false,
      prompt: "Summarize faithfully.",
      geminiModel: "gemini-flash-latest",
      vertexModel: "gemini-3.6-flash",
    },
  };
}

function normalizedSettings(): ExtensionSettings {
  return {
    ...initialSettings(),
    providerSettings: {
      gemini: { apiKey: "normalized-gemini", model: "gemini-pro-latest" },
      vertex: { apiKey: "normalized-vertex", model: "gemini-3.1-pro-preview" },
      openai: { apiKey: "normalized-openai", model: "gpt-5.6-sol" },
      anthropic: { apiKey: "normalized-anthropic", model: "claude-haiku-4-5-20251001" },
      custom: {
        apiKey: "normalized-custom",
        model: "normalized-model",
        customUrl: "https://normalized.example.test/v1/chat/completions",
      },
    },
    summary: {
      ...initialSettings().summary,
      prompt: "Normalized saved summary.",
    },
  };
}

async function createHarness(
  permissionResults: { contains?: boolean; request?: boolean } = {},
): Promise<OptionsHarness> {
  const html = await readFile("options.html", "utf8");
  const parsed = parseHTML(html);
  const selectPrototype = Object.getPrototypeOf(
    parsed.document.createElement("select"),
  ) as object;
  Object.defineProperty(selectPrototype, "value", {
    configurable: true,
    get(this: HTMLSelectElement): string {
      return Array.from(this.options).find((option) => option.selected)?.value ?? "";
    },
    set(this: HTMLSelectElement, value: string) {
      const options = Array.from(this.options);
      options.forEach((option) => option.removeAttribute("selected"));
      const selected = options.find((option) => option.value === value);
      if (selected) selected.selected = true;
    },
  });
  Object.defineProperty(parsed.window, "setTimeout", {
    configurable: true,
    value: () => 0,
  });

  const document = parsed.document as unknown as Document;
  const window = parsed.window as unknown as Window;
  const runtime = new FakeOptionsRuntime(initialSettings());
  const permissions = new FakePermissions(
    permissionResults.contains ?? true,
    permissionResults.request ?? true,
  );
  const session = createOptionsSettingsEditSession({
    document,
    sendMessage: runtime.sendMessage,
    permissions: permissions as OptionsSettingsEditSessionDependencies["permissions"],
  });
  await session.start();

  return { document, window, runtime, permissions };
}

function element<T extends Element>(harness: OptionsHarness, selector: string): T {
  const found = harness.document.querySelector<T>(selector);
  assert.ok(found, `Missing Options element ${selector}`);
  return found;
}

function dispatch(harness: OptionsHarness, target: Element, type: string): void {
  target.dispatchEvent(new harness.window.Event(type, { bubbles: true }));
}

function selectProvider(harness: OptionsHarness, providerId: ProviderId): void {
  const provider = element<HTMLSelectElement>(harness, "#provider");
  provider.value = providerId;
  dispatch(harness, provider, "change");
}

function click(harness: OptionsHarness, selector: string): void {
  dispatch(harness, element(harness, selector), "click");
}

function toastText(harness: OptionsHarness): string {
  return element<HTMLElement>(harness, "#toast").textContent ?? "";
}

async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await flushMicrotasks(2);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function editCustomDraft(
  harness: OptionsHarness,
  values: { apiKey: string; model: string; customUrl: string },
): void {
  selectProvider(harness, "custom");
  element<HTMLInputElement>(harness, "#api-key").value = values.apiKey;
  element<HTMLInputElement>(harness, "#custom-model").value = values.model;
  element<HTMLInputElement>(harness, "#custom-url").value = values.customUrl;
}

test("provider switching preserves raw drafts and never updates before explicit Save", async () => {
  const harness = await createHarness();
  const apiKey = element<HTMLInputElement>(harness, "#api-key");

  apiKey.value = "  unsaved-gemini  ";
  editCustomDraft(harness, {
    apiKey: "  unsaved-custom  ",
    model: "  unsaved-model  ",
    customUrl: "https://custom.example.test/v1/chat/completions",
  });
  selectProvider(harness, "gemini");

  assert.equal(apiKey.value, "  unsaved-gemini  ");
  assert.equal(harness.runtime.updateCalls.length, 0);
  selectProvider(harness, "custom");
  assert.equal(apiKey.value, "  unsaved-custom  ");
  assert.equal(element<HTMLInputElement>(harness, "#custom-model").value, "  unsaved-model  ");
  assert.equal(
    element<HTMLInputElement>(harness, "#custom-url").value,
    "https://custom.example.test/v1/chat/completions",
  );
  assert.equal(harness.runtime.updateCalls.length, 0);
});

test("invalid Custom URL retains raw drafts and avoids permission and settings writes", async () => {
  const harness = await createHarness();
  editCustomDraft(harness, {
    apiKey: "  invalid-url-key  ",
    model: "  invalid-url-model  ",
    customUrl: "http://custom.example.test/v1/chat/completions",
  });

  click(harness, "#save-btn");
  await waitFor(
    () => !element<HTMLButtonElement>(harness, "#save-btn").disabled,
    "controls after invalid URL",
  );

  assert.equal(toastText(harness), "Custom URL must use HTTPS");
  assert.equal(harness.permissions.containsCalls.length, 0);
  assert.equal(harness.permissions.requestCalls.length, 0);
  assert.equal(harness.runtime.updateCalls.length, 0);
  selectProvider(harness, "gemini");
  selectProvider(harness, "custom");
  assert.equal(element<HTMLInputElement>(harness, "#api-key").value, "  invalid-url-key  ");
  assert.equal(element<HTMLInputElement>(harness, "#custom-model").value, "  invalid-url-model  ");
  assert.equal(
    element<HTMLInputElement>(harness, "#custom-url").value,
    "http://custom.example.test/v1/chat/completions",
  );
});

test("permission denial retains raw drafts and avoids settings writes", async () => {
  const harness = await createHarness({ contains: false, request: false });
  editCustomDraft(harness, {
    apiKey: "  denied-key  ",
    model: "  denied-model  ",
    customUrl: "https://denied.example.test/v1/chat/completions",
  });

  click(harness, "#save-btn");
  await waitFor(
    () => toastText(harness) === "Custom API permission denied",
    "permission denial feedback",
  );

  assert.equal(harness.runtime.updateCalls.length, 0);
  assert.deepEqual(harness.permissions.containsCalls, [{
    origins: ["https://denied.example.test/*"],
  }]);
  assert.deepEqual(harness.permissions.requestCalls, [{
    origins: ["https://denied.example.test/*"],
  }]);
  selectProvider(harness, "gemini");
  selectProvider(harness, "custom");
  assert.equal(element<HTMLInputElement>(harness, "#api-key").value, "  denied-key  ");
  assert.equal(element<HTMLInputElement>(harness, "#custom-model").value, "  denied-model  ");
});

test("pending Save locks provider edits, ignores overlap, and preserves drafts after an unsuccessful response", async () => {
  const harness = await createHarness();
  const provider = element<HTMLSelectElement>(harness, "#provider");
  const apiKey = element<HTMLInputElement>(harness, "#api-key");
  const model = element<HTMLSelectElement>(harness, "#model");
  const customModel = element<HTMLInputElement>(harness, "#custom-model");
  const customUrl = element<HTMLInputElement>(harness, "#custom-url");
  const save = element<HTMLButtonElement>(harness, "#save-btn");
  const summaryPrompt = element<HTMLTextAreaElement>(harness, "#summary-prompt");

  apiKey.value = "  pending-gemini  ";
  editCustomDraft(harness, {
    apiKey: "  pending-custom  ",
    model: "  pending-model  ",
    customUrl: "https://pending.example.test/v1/chat/completions",
  });
  selectProvider(harness, "gemini");
  click(harness, "#save-btn");
  await waitFor(() => harness.runtime.updateCalls.length === 1, "pending settings update");

  for (const control of [provider, apiKey, model, customModel, customUrl, save]) {
    assert.equal(control.disabled, true);
  }
  assert.equal(summaryPrompt.disabled, false);
  click(harness, "#save-btn");
  await flushMicrotasks();
  assert.equal(harness.runtime.updateCalls.length, 1);

  harness.runtime.updateCalls[0].respond({ ok: false, error: "storage failed" });
  await waitFor(() => !save.disabled, "controls after unsuccessful save");
  assert.equal(toastText(harness), "Failed to save settings");
  selectProvider(harness, "custom");
  assert.equal(apiKey.value, "  pending-custom  ");
  assert.equal(customModel.value, "  pending-model  ");
  assert.equal(customUrl.value, "https://pending.example.test/v1/chat/completions");
  selectProvider(harness, "gemini");
  assert.equal(apiKey.value, "  pending-gemini  ");
});

test("runtime rejection preserves raw drafts and re-enables provider controls", async () => {
  const harness = await createHarness();
  const apiKey = element<HTMLInputElement>(harness, "#api-key");
  const save = element<HTMLButtonElement>(harness, "#save-btn");
  apiKey.value = "  retry-gemini  ";

  click(harness, "#save-btn");
  await waitFor(() => harness.runtime.updateCalls.length === 1, "rejected settings update");
  harness.runtime.updateCalls[0].reject(new Error("runtime unavailable"));
  await waitFor(() => !save.disabled, "controls after runtime rejection");

  assert.equal(toastText(harness), "Failed to save settings");
  assert.equal(apiKey.value, "  retry-gemini  ");
  assert.equal(element<HTMLSelectElement>(harness, "#provider").disabled, false);
});

test("successful Save normalizes every provider draft without overwriting pending summary edits", async () => {
  const harness = await createHarness();
  const apiKey = element<HTMLInputElement>(harness, "#api-key");
  const model = element<HTMLSelectElement>(harness, "#model");

  apiKey.value = "  draft-gemini  ";
  model.value = "gemini-pro-latest";
  selectProvider(harness, "vertex");
  apiKey.value = "  draft-vertex  ";
  model.value = "gemini-3.1-pro-preview";
  selectProvider(harness, "openai");
  apiKey.value = "  draft-openai  ";
  model.value = "gpt-5.6-sol";
  selectProvider(harness, "anthropic");
  apiKey.value = "  draft-anthropic  ";
  model.value = "claude-haiku-4-5-20251001";
  editCustomDraft(harness, {
    apiKey: "  draft-custom  ",
    model: "  draft-custom-model  ",
    customUrl: "  https://save.example.test/v1/chat/completions  ",
  });
  selectProvider(harness, "gemini");

  click(harness, "#save-btn");
  await waitFor(() => harness.runtime.updateCalls.length === 1, "successful settings update");
  const sent = harness.runtime.updateCalls[0].settings.providerSettings;
  assert.deepEqual(sent, {
    gemini: { apiKey: "draft-gemini", model: "gemini-pro-latest", customUrl: undefined },
    vertex: { apiKey: "draft-vertex", model: "gemini-3.1-pro-preview", customUrl: undefined },
    openai: { apiKey: "draft-openai", model: "gpt-5.6-sol", customUrl: undefined },
    anthropic: {
      apiKey: "draft-anthropic",
      model: "claude-haiku-4-5-20251001",
      customUrl: undefined,
    },
    custom: {
      apiKey: "draft-custom",
      model: "draft-custom-model",
      customUrl: "https://save.example.test/v1/chat/completions",
    },
  });

  const summaryPrompt = element<HTMLTextAreaElement>(harness, "#summary-prompt");
  summaryPrompt.value = "Edited while Save is pending.";
  harness.runtime.updateCalls[0].respond({ ok: true, settings: normalizedSettings() });
  await waitFor(
    () => !element<HTMLButtonElement>(harness, "#save-btn").disabled,
    "controls after successful save",
  );

  assert.equal(summaryPrompt.value, "Edited while Save is pending.");
  const expected: Record<ProviderId, { apiKey: string; model: string; customUrl?: string }> = {
    gemini: { apiKey: "normalized-gemini", model: "gemini-pro-latest" },
    vertex: { apiKey: "normalized-vertex", model: "gemini-3.1-pro-preview" },
    openai: { apiKey: "normalized-openai", model: "gpt-5.6-sol" },
    anthropic: { apiKey: "normalized-anthropic", model: "claude-haiku-4-5-20251001" },
    custom: {
      apiKey: "normalized-custom",
      model: "normalized-model",
      customUrl: "https://normalized.example.test/v1/chat/completions",
    },
  };
  for (const providerId of Object.keys(expected) as ProviderId[]) {
    selectProvider(harness, providerId);
    assert.equal(apiKey.value, expected[providerId].apiKey);
    if (providerId === "custom") {
      assert.equal(
        element<HTMLInputElement>(harness, "#custom-model").value,
        expected[providerId].model,
      );
      assert.equal(
        element<HTMLInputElement>(harness, "#custom-url").value,
        expected[providerId].customUrl,
      );
    } else {
      assert.equal(model.value, expected[providerId].model);
    }
  }
});

test("Clear Cache sends one request per click and reports exact success and failure feedback", async () => {
  const harness = await createHarness();
  harness.runtime.cacheResponses.push(
    { ok: true },
    { ok: false, error: "cache unavailable" },
  );

  click(harness, "#clear-cache-btn");
  await waitFor(() => toastText(harness) === "Cache cleared", "cache success feedback");
  assert.equal(harness.runtime.cacheClearCalls, 1);

  click(harness, "#clear-cache-btn");
  await waitFor(
    () => toastText(harness) === "Failed to clear cache",
    "cache failure feedback",
  );
  assert.equal(harness.runtime.cacheClearCalls, 2);
  assert.equal(harness.runtime.updateCalls.length, 0);
});
