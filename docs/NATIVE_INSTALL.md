# Optional native summary installation on Windows

The shared browser ZIP works with API keys alone. This advanced path is for people who explicitly want Codex CLI or Claude CLI summaries and have the full PaperLens source checkout. Native summaries use the CLI's authenticated model service; they are not offline.

## Requirements

- Windows with PowerShell, Node available on the browser's `PATH`, and Chrome or Edge.
- A compatible Codex CLI or Claude CLI installation, already authenticated through that CLI's normal process.
- The full source checkout, kept in a permanent directory. The host launcher refers to files there. CLI versions must support the isolation flags used by `native-host/paperlens-summary-host.js`.
- A loaded PaperLens extension. The source checkout can be built with `npm ci` and `npm run build`, then loaded using its `dist/` folder, or you can use the browser release folder.

No Python installation is required. This repository supplies a Windows host launcher and Windows registry scripts; native installation on other operating systems is not covered by these instructions.

## Register for your own extension ID

Open `chrome://extensions` (or `edge://extensions`), enable Developer mode, and copy the ID shown on your own PaperLens card. In PowerShell at the source checkout, replace the placeholder with that actual ID:

```powershell
./scripts/register-native-host.ps1 -ExtensionId '<your-PaperLens-extension-ID>' -Browser Chrome
```

Use `-Browser Edge` for Edge. For separate Chrome and Edge installations, pass their IDs as an array and both browser names. The script validates IDs, generates a host manifest pointing to this checkout's launcher, and registers it under the current user's browser registry key. Do not use a manifest or extension ID copied from someone else's computer.

The generated file is `native-host/com.paperlens.summary_host.json`. It contains your local path and extension ID and is ignored by Git. Generate it on your own computer; the public repository and browser ZIP do not supply a preconfigured registration. Re-register if you move the source checkout or load an extension from a new directory whose ID changes.

Select **Codex CLI** or **Claude CLI** in PaperLens Settings, choose the model your CLI supports, and click **Save Settings**. Run Alt+S on an article. API translation remains separately configured.

If Chrome reports that the host is unavailable, confirm that the saved provider, extension ID, browser registration, checkout path, Node executable and authenticated CLI are all correct. Restart the browser after changing its `PATH` environment. The extension's API key fields do not authenticate the CLI.

## Remove the optional host registration

```powershell
./scripts/unregister-native-host.ps1 -Browser Chrome
```

Repeat with `-Browser Edge` if registered there. Choose an API summary provider in Settings afterwards. Unregistering the host does not delete your CLI account, authentication data or source checkout.
