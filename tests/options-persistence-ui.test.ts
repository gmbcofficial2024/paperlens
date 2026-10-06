import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";

async function loadOptionsDocument() {
  const html = await readFile("options.html", "utf8");
  return parseHTML(html).document;
}

test("options shows a visible local-only translation credential storage notice", async () => {
  const document = await loadOptionsDocument();
  const help = document.querySelector("#translation-key-storage-help");

  assert.ok(help);
  assert.equal(help.classList.contains("hidden"), false);
  const text = help.textContent ?? "";
  assert.match(text, /persist only after Save Settings/i);
  assert.match(text, /local to this browser profile/i);
  assert.match(text, /not synced/i);
  assert.match(text, /extension removal/i);
  assert.match(text, /profile changes/i);
  assert.match(text, /repository root and dist as separate unpacked extensions/i);
});

test("options shows Gemini and Vertex summary fallback help when their provider panels are revealed", async () => {
  const document = await loadOptionsDocument();
  const geminiFields = document.querySelector("#summary-gemini-fields");
  const vertexFields = document.querySelector("#summary-vertex-fields");
  const geminiHelp = document.querySelector("#summary-gemini-key-fallback-help");
  const vertexHelp = document.querySelector("#summary-vertex-key-fallback-help");

  assert.ok(geminiFields);
  assert.ok(vertexFields);
  assert.ok(geminiHelp);
  assert.ok(vertexHelp);
  assert.equal(geminiHelp.closest("#summary-gemini-fields"), geminiFields);
  assert.equal(vertexHelp.closest("#summary-vertex-fields"), vertexFields);
  geminiFields.classList.remove("hidden");
  vertexFields.classList.remove("hidden");
  assert.equal(geminiFields.classList.contains("hidden"), false);
  assert.equal(vertexFields.classList.contains("hidden"), false);
  assert.equal(geminiHelp.classList.contains("hidden"), false);
  assert.equal(vertexHelp.classList.contains("hidden"), false);
  assert.match(geminiHelp.textContent ?? "", /blank.*reuses.*saved translation.*Gemini key/i);
  assert.match(vertexHelp.textContent ?? "", /blank.*reuses.*saved translation.*Vertex key/i);
  assert.equal(document.querySelector<HTMLInputElement>("#api-key")?.type, "password");
  assert.equal(document.querySelector<HTMLInputElement>("#summary-gemini-api-key")?.type, "password");
  assert.equal(document.querySelector<HTMLInputElement>("#summary-vertex-api-key")?.type, "password");
});
