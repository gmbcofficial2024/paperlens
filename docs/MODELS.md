# Current PaperLens models

Official model guidance checked on 2026-10-07. These are PaperLens's available presets, not a promise of access for every API account.

| Provider | Available models | PaperLens default |
|---|---|---|
| Google Gemini API | Shared Release: `gemini-flash-latest` | Gemini Flash Latest |
| Vertex AI | `gemini-3.1-pro-preview`, `gemini-3.8-flash`, `gemini-3.5-flash-lite` | Gemini 3.8 Flash |
| OpenAI | `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna` | GPT-6.1 Sol |
| Anthropic | `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001` | Claude Sonnet 5.5 |
| Custom OpenAI-compatible server | Model ID supplied by that server | User supplied |
| Native Codex summary | Suggestions: `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna`; custom CLI model ID allowed | `gpt-6.1-sol` |
| Native Claude summary | Current Anthropic IDs above and rolling CLI aliases; custom CLI model ID allowed | `opus` |

Sol and Sonnet are PaperLens's balance of cost, latency and translation quality. Choose another listed model when appropriate; only the Gemini API model is fixed in shared Releases. Custom servers have their own model catalog, so use the model ID advertised by your server.

The **Paper & Article Summary** panel supports Gemini, Vertex, OpenAI and Anthropic APIs, plus optional Codex/Claude CLIs. Each API can use a summary-specific key and model. A blank override uses the same provider's saved translation setting, then its default model when no model is saved. Keys never fall back across providers. OpenAI and Anthropic summary model presets and recognized migrations use the same catalog as translation.

Native model suggestions do not restrict custom IDs or CLI aliases. Current Claude Code on the Anthropic API resolves `opus` to Opus 5.5 and `sonnet` to Sonnet 5.5; mappings depend on the CLI version, provider and environment overrides. Opus 5.5 requires Claude Code 2.1.280 or later, Sonnet 5.5 requires 2.1.284, and Fable 5.1 requires 2.1.257. Account access is separate from model selection. [OpenAI Docs: Codex models](https://developers.openai.com/codex/models), [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

Known older presets migrate without switching providers or moving keys: OpenAI 5.6 Sol/Terra become 6.1 Sol, 5.6 Luna becomes 6 Luna, Anthropic Opus 4.8 becomes Opus 5.5, Sonnet 5 becomes Sonnet 5.5, and Vertex Flash 3.6/3.7 become Flash 3.8. Earlier recognized aliases use the corresponding current tier. The former native Codex default `gpt-5.5` becomes `gpt-6.1-sol`; other explicit native models and custom-server settings are retained. An existing low-cost Haiku or Flash-Lite selection stays in that tier.

OpenAI requests remain tool-free Chat Completions: Astra and Sol use low reasoning without sampling parameters; Luna uses no reasoning with the existing temperature. Anthropic Sonnet 5.5 uses `between_tools` thinking, which returns text without up-front thinking in these tool-free requests; Opus and Fable use their default adaptive thinking. [OpenAI migration guidance](https://developers.openai.com/api/docs/guides/latest-model), [Anthropic models](https://platform.claude.com/docs/en/models/overview), [Anthropic thinking](https://platform.claude.com/docs/en/build-with-claude/thinking).

Vertex uses the existing API-key Express `generateContent` endpoint. Google recommends Flash 3.8 and documents the 3.6/3.7 migration. Express support tables and newer examples are not fully aligned; exact Flash 3.8 access on this endpoint has not been verified with a live account. This release validates request construction and migration without paid API calls. [Google migration guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash), [Express REST reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/express-mode/api-reference), [Google's current API-key guidance](https://github.com/google/skills/blob/main/skills/cloud/gemini-api/SKILL.md).
