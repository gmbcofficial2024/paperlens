# PaperLens privacy information

This document describes the shared unpacked extension in this repository. PaperLens has no hosted account service, telemetry endpoint, analytics or advertising code. API requests go directly from the extension to the provider you select.

## Data used for translation and summary

When you start translation or summary, PaperLens extracts article text accessible in the loaded page. Requests include the relevant source passages or full extracted summary document, headings, instructions and model choice. Summary requests also include the page title. Personal data or URLs present in captured source text are part of that input. These requests go to the configured provider: Google Gemini, Google Vertex AI, OpenAI, Anthropic, or your custom translation endpoint. The credential for that provider is sent to that provider to authenticate the request.

Translation can continue sending newly loaded article passages while its reading session is visible and active. Hide translation to pause that continuing work. If you enable summary before translation, starting translation also requests a summary. Otherwise summary is explicit. A changed source shows an update control rather than automatically sending a new full-summary request.

The optional **Test saved API connection** button sends a short test sentence and the saved translation credentials to the selected translation provider. It can incur a small API charge and does not send the active article as part of that check.

Source-scope notices describe captured text and evidence of partial access. PaperLens does not bypass paywalls or fetch unloaded sections, external PDF contents or supplemental files. Article content you can access after signing in can be processed like other loaded text. Provider handling, retention and billing follow your account and the provider's terms. Removing local data does not remove past provider requests. Avoid sending confidential content unless your chosen provider's handling is appropriate for it.

## Browser-local storage

API keys, provider choices, model names and custom instructions are saved in `chrome.storage.local` after **Save Settings**. They are not synchronized by PaperLens between profiles or installations. Credentials are stored in your browser profile, not in the shared ZIP. Treat profile access as credential access.

When translation caching is enabled, translated paragraphs, sentence alignment, source hashes, timestamps and size metadata are stored locally to avoid repeated requests. Alignment includes original source sentences. The cache is bounded to about 10 MB and evicts older entries. The current summary and page-reading state are displayed in the page; the extension does not maintain a separate permanent summary history.

Use **Clear Cache** in Settings to remove cached translations. Disabling the cache stops its use but does not itself clear existing entries. To remove saved credentials, clear each provider's key field and any separate summary key, then save. Removing the extension removes its browser-local storage. Reload the article to clear inserted reading UI from that page.

## Permissions and optional native integration

- `storage`: local settings and translation cache.
- `activeTab` and `scripting`: run the reading layer in the current page after a user command.
- Provider host permissions: contact supported API servers. Custom HTTPS endpoints ask for their server's optional permission when configured.
- `nativeMessaging`: optional Codex/Claude summary connection. The browser package includes this capability but does not install a native host. Normal Gemini API setup does not invoke a CLI.

If you deliberately install the optional Windows native host from the source checkout and choose Codex or Claude, the summary prompt is passed to that local CLI. The CLI uses its own login and external model service; this is not offline processing. The host runs in a temporary working directory, applies its CLI isolation settings and attempts to remove that directory after the request. CLI authentication and any provider-side logs follow the CLI's own behavior and policies.

## Optional Windows installation and update helper

The separately downloaded Windows helper contacts GitHub to read public release metadata and download the extension ZIP and its checksum. Those requests expose normal connection information, including your IP address, to GitHub. The helper does not read or transmit your article text, browser profile, API keys or browser settings. It writes extension files to the selected installation directory and keeps a backup when replacing an existing installation. The extension itself does not automatically download or run updates. GitHub's own service policies govern release downloads.

The shared ZIP includes only browser runtime assets, installation/privacy documents and project/dependency licenses. It does not include browser settings, keys, native-host registration manifests, local extension IDs or workstation paths. For questions or issues, use the public repository's Issues page without including credentials or confidential article contents.
