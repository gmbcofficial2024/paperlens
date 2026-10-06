# Changelog

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
