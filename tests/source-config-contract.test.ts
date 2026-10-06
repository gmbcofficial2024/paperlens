import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

test("manifest exposes only the translation and single-shot summary surface", async () => {
  const manifest = await readJson("manifest.json");
  const commands = manifest.commands as Record<
    string,
    { suggested_key: { default: string } }
  >;

  assert.deepEqual(manifest.permissions, [
    "storage",
    "activeTab",
    "scripting",
    "nativeMessaging",
  ]);
  assert.deepEqual(manifest.host_permissions, [
    "https://generativelanguage.googleapis.com/*",
    "https://aiplatform.googleapis.com/*",
    "https://api.openai.com/*",
    "https://api.anthropic.com/*",
  ]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
  assert.deepEqual(Object.keys(commands), [
    "toggle-translate",
    "summarize-paper",
  ]);
  assert.equal(commands["toggle-translate"].suggested_key.default, "Alt+T");
  assert.equal(commands["summarize-paper"].suggested_key.default, "Alt+S");
  assert.equal("minimum_chrome_version" in manifest, false);
  assert.equal("side_panel" in manifest, false);
  assert.equal("content_security_policy" in manifest, false);
});

test("package exposes only the reduced build and provider canary surface", async () => {
  const packageJson = await readJson("package.json");

  assert.deepEqual(packageJson.scripts, {
    build: "node build.mjs",
    watch: "node build.mjs --watch",
    typecheck: "tsc --noEmit",
    test: "node scripts/run-tests.mjs",
    "test:providers:live": "node scripts/provider-canary.mjs",
    "package:share": "node scripts/package-share.mjs",
  });
  assert.deepEqual(packageJson.dependencies, {
    zod: "^3.23.0",
  });
  assert.deepEqual(packageJson.devDependencies, {
    "@types/chrome": "^0.0.287",
    esbuild: "^0.28.2",
    linkedom: "^0.18.12",
    typescript: "^5.7.0",
  });
});
