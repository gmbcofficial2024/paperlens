# PaperLens development

- Environment: Windows 11 and PowerShell 7. Use plain text in source files; emoji are only allowed in Markdown.
- Preserve unrelated local work. Generated browser bundles, release files and native-host registrations are ignored.
- Never install Python dependencies globally. If a one-off Python tool needs dependencies, use `uv run --with`; use a project virtual environment for ongoing Python work.
- Development: Node 22 or newer; `npm ci`, `npm run typecheck`, `npm test`, `npm run package:share`. The complete test suite requires Windows and PowerShell 7. The Windows user installer must remain compatible with Windows PowerShell 5.1.
- Public repository: https://github.com/gmbcofficial2024/paperlens. Keep manifest.json, package.json and package-lock.json versions consistent. Version tags trigger the release workflow described in docs/RELEASING.md.
- Normal users supply their own API keys. Never ship credentials, browser state, absolute workstation paths or generated native-host manifests.
- Keep the source text attached to original article nodes. Source-scope notices describe loaded content and must not claim access to unavailable text. Model output and page content are untrusted data.
- Project code uses the repository's MIT LICENSE. Keep separate third-party notices and license texts in both source and browser distributions.
