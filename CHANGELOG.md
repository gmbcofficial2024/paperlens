# Changelog

## Unreleased

- Explicitly select the elevated Windows sandbox for Codex native summaries while preserving the root-deny, temporary-folder-read and network-off permission profile.
- Check the Codex sandbox setup prerequisite before launching from the browser and show actionable setup guidance when it is missing.
- Document the one-time administrator-approved Codex setup and source-host update procedure. Native-host source changes do not require reinstalling the browser extension.

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
