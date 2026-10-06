# Optional native summary installation on Windows

The shared browser ZIP works with API keys alone. This advanced path is for people who explicitly want Codex CLI or Claude CLI summaries and have the full PaperLens source checkout. Native summaries use the CLI's authenticated model service; they are not offline.

## Requirements

- Windows with PowerShell, Node available on the browser's `PATH`, and Chrome or Edge.
- A compatible Codex CLI or Claude CLI installation, already authenticated through that CLI's normal process.
- For Codex on Windows, complete the elevated Windows sandbox's one-time administrator-approved setup before using the native host. Claude does not use this Codex sandbox.
- The full source checkout, kept in a permanent directory. The host launcher refers to files there. CLI versions must support the isolation flags used by `native-host/paperlens-summary-host.js`.
- A loaded PaperLens extension. The source checkout can be built with `npm ci` and `npm run build`, then loaded using its `dist/` folder, or you can use the browser release folder.

No Python installation is required. This repository supplies a Windows host launcher and Windows registry scripts; native installation on other operating systems is not covered by these instructions.

## Complete the Codex Windows sandbox setup

PaperLens gives Codex a temporary working folder with read access, denies reads elsewhere, and disables command network access. The Windows `unelevated` restricted-token sandbox cannot enforce this split read policy. PaperLens therefore explicitly selects `windows.sandbox="elevated"` for Codex on Windows while keeping the same file and network limits. This sandbox runs commands under restricted sandbox users; it does not give the summarizing model administrator access.

Open an interactive Codex CLI with the elevated sandbox selected:

```powershell
codex --sandbox read-only -c 'windows.sandbox="elevated"'
```

Complete Codex's Windows sandbox setup and approve its administrator/UAC prompt when your machine permits it. No article needs to be submitted to a model to configure the sandbox. The setup creates the sandbox users and related Windows permissions/firewall rules. See [OpenAI's Windows sandbox instructions](https://learn.chatgpt.com/docs/windows/windows-sandbox) for the supported setup and enterprise-policy limitations.

The native host checks for the setup marker under `CODEX_HOME/.sandbox/setup_marker.json` (normally `%USERPROFILE%\.codex\.sandbox\setup_marker.json`) before starting Codex. If it is missing, the host reports the required setup instead of starting hidden administrator provisioning from the browser. The check is a prerequisite check, not a guarantee that Windows policy, sandbox users and logon rights are still healthy.

After setup, retry `Alt+S`. Do not remove the file/read restrictions or use `--dangerously-bypass-approvals-and-sandbox` to work around this error. If administrator-approved sandbox setup is blocked on a managed machine, choose an API summary provider or use a separately configured Claude CLI instead.

## Register for your own extension ID

Open `chrome://extensions` (or `edge://extensions`), enable Developer mode, and copy the ID shown on your own PaperLens card. In PowerShell at the source checkout, replace the placeholder with that actual ID:

```powershell
./scripts/register-native-host.ps1 -ExtensionId '<your-PaperLens-extension-ID>' -Browser Chrome
```

Use `-Browser Edge` for Edge. For separate Chrome and Edge installations, pass their IDs as an array and both browser names. The script validates IDs, generates a host manifest pointing to this checkout's launcher, and registers it under the current user's browser registry key. Do not use a manifest or extension ID copied from someone else's computer.

The generated file is `native-host/com.paperlens.summary_host.json`. It contains your local path and extension ID and is ignored by Git. Generate it on your own computer; the public repository and browser ZIP do not supply a preconfigured registration. Re-register if you move the source checkout or load an extension from a new directory whose ID changes.

Select **Codex CLI** or **Claude CLI** in PaperLens Settings, choose the model your CLI supports, and click **Save Settings**. Run Alt+S on an article. API translation remains separately configured.

If Chrome reports that the host is unavailable, confirm that the saved provider, extension ID, browser registration, checkout path, Node executable and authenticated CLI are all correct. Restart the browser after changing its `PATH` environment. The extension's API key fields do not authenticate the CLI.

If Codex reports `unelevated restricted-token sandbox cannot enforce split filesystem read restrictions`, update the native-host source and complete the Windows sandbox setup above. The browser Release ZIP does not contain the native host. Updating the source checkout updates an already registered host at the same path; no re-registration or browser extension reinstall is needed for this host-code change.

## Remove the optional host registration

```powershell
./scripts/unregister-native-host.ps1 -Browser Chrome
```

Repeat with `-Browser Edge` if registered there. Choose an API summary provider in Settings afterwards. Unregistering the host does not delete your CLI account, authentication data or source checkout.
