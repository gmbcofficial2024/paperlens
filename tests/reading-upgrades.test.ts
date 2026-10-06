import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings, mergeSettings } from "../src/shared/schema";
import { buildSummaryPrompt } from "../src/shared/summary-prompts";
import { serializeSummaryDocument } from "../src/summary/document";
import { requestSummaryOnce } from "../src/summary/flow";

test("a fresh installation can summarize with the translation Gemini key without a native host", () => {
  const fresh = defaultSettings();
  assert.equal(fresh.currentProvider, "gemini");
  assert.equal(fresh.summary.provider, "gemini");
  const migrated = mergeSettings({summary: {provider: "claude"}});
  assert.equal(migrated.summary.provider, "claude");
});

test("article summaries ask for context and attribution rather than inventing a research method", async () => {
  const input = {title: "Council election", articleText: "A quoted statement.", kind: "article" as const};
  let received: unknown;
  await requestSummaryOnce(input, async request => {
    received = request;
    return {ok: true, result: {summary: "done"}};
  });
  assert.equal((received as {kind?: string}).kind, "article");
  const prompt = buildSummaryPrompt({...input, customPrompt: ""});
  assert.ok(prompt.includes("배경과 맥락"));
  assert.ok(prompt.includes("주장과 근거"));
  assert.ok(prompt.includes("출처"));
  assert.equal(prompt.includes("3. 방법"), false);
  assert.ok(prompt.includes('"articleText":"A quoted statement."'));
});

test("summary serialization preserves equal text in separate semantic sections", () => {
  const text = serializeSummaryDocument([
    {heading: "Abstract", paragraphs: ["No significant difference was observed."]},
    {heading: "Results", paragraphs: ["No significant difference was observed."]},
  ]);
  assert.equal(text.match(/No significant difference was observed\./g)?.length, 2);
  assert.ok(text.includes("## Results"));
});

test("abstract-only source is carried to the provider and cannot be described as a full-paper summary", async () => {
  const input = {articleText:"Loaded abstract.",sourceScope:"abstract-only" as const};
  let scope: string | undefined;
  await requestSummaryOnce(input, async request => {scope=request.sourceScope; return {ok:true,result:{summary:"done"}};});
  assert.equal(scope,"abstract-only");
  const prompt=buildSummaryPrompt({...input,customPrompt:""});
  assert.ok(prompt.includes("초록만"));
  assert.ok(prompt.includes("정식 본문"));
  assert.equal(prompt.includes("학술 논문 전체"),false);
});
