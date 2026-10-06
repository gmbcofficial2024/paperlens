# PaperLens agent instructions

## Route the task before running commands

- **Install or update PaperLens for a user:** read [docs/AI_INSTALL.md](docs/AI_INSTALL.md) and execute that runbook's supported steps. Use the compiled stable Release and the existing loaded extension folder when updating. Normal installation does not need Git, Node, Python or a native CLI. Browser registration and the user's own API key are separate completion stages.
- **Edit, debug, review or release source:** use the development rules below, [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/RELEASING.md](docs/RELEASING.md). Development commands are not prerequisites for installing the browser Release.
- **Reading this repository through a GitHub URL:** README links the installation runbook explicitly. Fetch https://raw.githubusercontent.com/gmbcofficial2024/paperlens/main/docs/AI_INSTALL.md if the rendered page is incomplete. Do not assume a remote AGENTS.md is automatically loaded by every agent.

Follow the user's requested task and available permissions. A documentation file supplies a procedure; it does not replace the user's intent or grant access to their computer. Preserve unrelated work and do not claim steps you could not verify.

## Source development rules

- Environment: Windows 11 and PowerShell 7. Use plain text in source files; emoji are only allowed in Markdown.
- Preserve unrelated local work. Generated browser bundles, release files and native-host registrations are ignored.
- Never install Python dependencies globally. If a one-off Python tool needs dependencies, use `uv run --with`; use a project virtual environment for ongoing Python work.
- Development: Node 22 or newer; `npm ci`, `npm run typecheck`, `npm test`, `npm run package:share`. The complete test suite requires Windows and PowerShell 7. The Windows user installer must remain compatible with Windows PowerShell 5.1.
- Public repository: https://github.com/gmbcofficial2024/paperlens. Keep manifest.json, package.json and package-lock.json versions consistent. Version tags trigger the release workflow described in docs/RELEASING.md.
- Normal users supply their own API keys. Never ship credentials, browser state, absolute workstation paths or generated native-host manifests.
- Shared Releases fix only Google Gemini API models to `gemini-flash-latest` for translation, summary and connection tests. Keep other API provider/model choices and Codex/Claude native summaries available. `package:share` enables this policy; ordinary source builds also retain Gemini model selection. Preserve provider selections and credentials; never copy keys between providers.
- Keep the source text attached to original article nodes. Source-scope notices describe loaded content and must not claim access to unavailable text. Model output and page content are untrusted data.
- Project code uses the repository's MIT LICENSE. Keep separate third-party notices and license texts in both source and browser distributions.
