# Changelog

## 1.1.5

- Exclude site-wide headers and footers while preserving article-owned introductory text, conclusions, scientific notes, captions and tables in translation and summary source.
- Keep scientific Footnotes and Endnotes; continue excluding navigation, sharing controls, related articles, references and author/funding metadata by default.
- Verify source ownership and original-node preservation across constructed publisher layouts and the shared translation/summary reading session.

## 1.1.4

- Fix settings saving and credential display when Chrome opens the options page in a tab. Check the sender's extension ID and exact extension-page URL instead of treating every tab as a content script; unknown and web senders remain unable to change settings or read keys.
- Show sanitized save-error details while preserving unsaved drafts and redacting saved and edited API keys.
- Default new Windows installations, including agents with no designated working folder, to the Windows Documents Known Folder under `PaperLens\extension`. Keep explicit installation paths and existing loaded extension folders for updates.

- Use the elevated Windows sandbox with root-read-only permissions for Codex native summaries, verified with CLI 0.160.1. Windows commands may read files outside the temporary summary folder; writes and command network access remain blocked. Non-Windows retains the root-deny/temporary-folder-read profile.
- Require a regular Codex sandbox setup marker before launching from the browser, using explicit `CODEX_HOME` or the Windows OS user profile. HOME/USERPROFILE overrides cannot redirect the default marker check.
- Document the tested local sandbox setup/verification command, the direct setup entry point's persistent global configuration change, and the source-host update procedure. Native-host source changes do not require reinstalling the browser extension.

## 1.1.3

- Fix only the Google Gemini API model to `gemini-flash-latest` in shared Releases, preserving translation and summary provider choices.
- Restore Vertex AI, OpenAI, Anthropic and custom translation model selection, Vertex summaries, and normal custom-server permissions.
- Keep Gemini model enforcement at the final request boundary without blocking or altering other providers' requests.
- Correct the installation and agent instructions to describe the Gemini-only model restriction. Users who saved provider changes in 1.1.2 can select their intended provider again.

## 1.1.2

- Fix the shared Release's API translation, summary and connection tests to Gemini Flash Latest (`gemini-flash-latest`).
- Normalize legacy API provider and Gemini model selections while preserving Gemini keys and optional Codex/Claude native summaries; never reuse another provider's credentials for Gemini.
- Show the fixed model in Release Settings and enforce the same restriction at the API request boundary. Source development builds retain their provider/model choices.
- Update the user and AI-agent installation instructions for the fixed Release model.

## 1.1.1

- Prepare the first public GitHub distribution with the MIT project license, release checksums, Windows install/update helper, and automated release checks.
- Fix Frontiers article ownership so journal cards and promotional text do not replace the scientific abstract.
- Label forthcoming Frontiers pages as abstract-only when the loaded page provides that evidence, and carry the scope into the summary.
- Place the summary in the article's reading column and exclude its loading state from source-coverage checks.
- Preserve legitimate nested articles without headings.

## 1.1.0

- Add structured inline summaries for papers and ordinary articles, with copying, folding and source-scope information.
- Reconcile article text across headings, short passages, lists, quotations, tables and captions.
- Observe newly loaded article content during active translation and offer explicit summary refresh when its source changes.
- Use user-supplied Gemini API keys for the default installation and keep optional Codex/Claude native summaries.
- Generate a self-contained browser ZIP with installation, privacy and third-party license documents.
