# Current PaperLens models

Official model guidance checked on 2026-11-23. These are PaperLens's available presets, not a promise of access for every API account.

| Provider | Available models | PaperLens default |
|---|---|---|
| Google Gemini API | Shared Release: `gemini-flash-latest` (Source builds also list `gemini-4-carbon`, `gemini-4-neon`, `gemini-4-hydrogen`, `gemini-pro-latest`, `gemini-flash-lite-latest`) | Gemini Flash Latest |
| Vertex AI | `gemini-4-carbon`, `gemini-4-neon`, `gemini-4-hydrogen`, `gemini-3.8-flash`, `gemini-3.5-flash-lite` | Gemini 4 Hydrogen |
| OpenAI | `gpt-6.2-astra`, `gpt-6.2-sol`, `gpt-6-luna` | GPT-6.2 Sol |
| Anthropic | `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` | Claude Sonnet 5.5 |
| Custom OpenAI-compatible server | Model ID supplied by that server | User supplied |
| Native Codex summary | Suggestions: `gpt-6.2-astra`, `gpt-6.2-sol`, `gpt-6-luna`; custom CLI model ID allowed | `gpt-6.2-sol` |
| Native Claude summary | Current Anthropic IDs above and rolling CLI aliases; custom CLI model ID allowed | `opus` |

Hydrogen, Sol, and Sonnet are PaperLens's balance of cost, latency, and translation quality. Choose another listed model when appropriate (`gemini-3.8-flash` and `gemini-3.5-flash-lite` remain available on Vertex AI for lower-cost Flash tiers); only the Gemini API model is fixed in shared Releases. Custom servers have their own model catalog, so use the model ID advertised by your server.

The **Paper & Article Summary** panel supports Gemini, Vertex, OpenAI and Anthropic APIs, plus optional Codex/Claude CLIs. Each API can use a summary-specific key and model. A blank override uses the same provider's saved translation setting, then its default model when no model is saved. Keys never fall back across providers. OpenAI and Anthropic summary model presets and recognized migrations use the same catalog as translation.

Native model suggestions do not restrict custom IDs or CLI aliases. Current Claude Code on the Anthropic API resolves `opus` to Opus 5.5, `sonnet` to Sonnet 5.5, `haiku` to Haiku 5.5, and `fable` to Fable 5.2 (mappings depend on the CLI version, provider, and environment overrides). Account access is separate from model selection. [OpenAI Docs: Codex models](https://developers.openai.com/codex/models), [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

Known older presets migrate without switching providers or moving keys: Vertex `gemini-3.1-pro-preview` and `gemini-2.5-pro` migrate to `gemini-4-neon`, `gemini-4-argon` migrates to `gemini-4-carbon`, earlier Vertex Flash (`3.5`/`3.6`/`3.7`) stays in the economical Flash tier at `gemini-3.8-flash`, OpenAI `gpt-6-astra` becomes `gpt-6.2-astra` and `gpt-6.1-sol`/`gpt-6.1-terra`/5.6 Sol become `gpt-6.2-sol` while 5.6 Luna becomes `gpt-6-luna`, Anthropic Fable 5.1 becomes Fable 5.2, Opus 4.8 becomes Opus 5.5, Sonnet 5 becomes Sonnet 5.5, and Haiku 4.5 becomes Haiku 5.5. Earlier recognized aliases use the corresponding current tier. Former native Codex defaults (`gpt-5.5`, `gpt-6.1-sol`) migrate to `gpt-6.2-sol`; other explicit native models and custom-server settings are retained. An existing low-cost Flash, Flash-Lite, or Haiku selection stays in that tier.

OpenAI requests remain tool-free Chat Completions: `gpt-6.2-astra` and `gpt-6.2-sol` use `reasoning_effort: "low"` without sampling parameters; `gpt-6-luna` uses `reasoning_effort: "none"` with the existing temperature. Anthropic `claude-sonnet-5-5` uses `between_tools` thinking (no up-front thinking in tool-free requests), `claude-haiku-5-5` disables thinking (`thinking.type = "disabled"`) for low-latency throughput, and Opus 5.5 / Fable 5.2 use their default adaptive thinking. [OpenAI migration guidance](https://developers.openai.com/api/docs/guides/latest-model), [Anthropic models](https://platform.claude.com/docs/en/models/overview), [Anthropic thinking](https://platform.claude.com/docs/en/build-with-claude/thinking).

Vertex uses the existing API-key Express `generateContent` endpoint. Gemini 4 models (`gemini-4-carbon`, `gemini-4-neon`, `gemini-4-hydrogen`) pass `generationConfig.thinkingConfig.thinkingLevel = "LOW"` without sampling fields or deprecated `thinkingBudget`; `gemini-3.8-flash` and `gemini-3.5-flash-lite` keep standard request payloads. Express support tables and newer examples are not fully aligned across accounts; exact Gemini 4 access on this endpoint has not been verified with a live account. This release validates request construction and migration without paid API calls. [Google Gemini 4 documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models), [Express REST reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/express-mode/api-reference), [Google's current API-key guidance](https://github.com/google/skills/blob/main/skills/cloud/gemini-api/SKILL.md).
