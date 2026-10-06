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

On Windows, PaperLens selects `windows.sandbox="elevated"` with a root-read-only filesystem profile (`":root"="read"`). Codex commands may read local files outside the temporary summary folder; this mode does not confine reads to the captured article. File writes and command network access remain blocked. Summaries still run in a temporary working folder and ignore user configuration and rules. The host retains root-deny/temporary-folder-read permissions on non-Windows systems.

The Windows root-deny/temporary-folder-read profile is unsupported by the tested Codex sandbox, including its elevated backend. Update the native-host source as well as completing setup; setup alone does not repair an older host that still sends that profile. The procedure below was verified with Codex CLI `0.160.1`.

Run this command in PowerShell to provision the sandbox if needed and verify it with a local echo command:

```powershell
codex sandbox -P paperlens_setup --include-managed-config -C "$env:WINDIR" `
  -c 'windows.sandbox="elevated"' `
  -c 'permissions.paperlens_setup.filesystem={":root"="read"}' `
  -c 'permissions.paperlens_setup.network.enabled=false' `
  -- "$env:WINDIR\System32\cmd.exe" /d /c 'echo PaperLens sandbox setup verified'
```

Approve the administrator/UAC prompt when your machine permits it. Successful verification prints `PaperLens sandbox setup verified`. This command makes no model request and does not save a global Windows sandbox mode in `config.toml`. Provisioning creates restricted sandbox users and related Windows permissions/firewall rules; the summarizing model does not receive administrator access. See [OpenAI's Windows sandbox instructions](https://learn.chatgpt.com/docs/windows/windows-sandbox) for setup and enterprise-policy limitations.

Codex also provides `codex sandbox setup --elevated --current-user`. Its implementation in CLI `0.153.4` and `0.160.1` provisions the sandbox **and persistently saves** `[windows] sandbox="elevated"` in the active Codex `config.toml`, affecting other Codex sessions. Use that entry point only if you intend this persistent change. This behavior was checked in CLI source; the longer verification command above was the command actually executed.

The native host requires a regular setup marker at `CODEX_HOME/.sandbox/setup_marker.json` before starting Codex. An explicit `CODEX_HOME` is honored case-insensitively. Otherwise, the host uses `.codex` under the Windows OS user profile, matching Codex's default; changing `HOME` or `USERPROFILE` does not redirect this check. The usual path is `%USERPROFILE%\.codex\.sandbox\setup_marker.json`. A missing marker produces setup guidance without launching the CLI or hidden administrator provisioning. The marker is a prerequisite check, not a guarantee that Windows policy, sandbox users and logon rights are still healthy.

After updating the host source and completing setup, retry `Alt+S`. Do not use `--dangerously-bypass-approvals-and-sandbox` to work around sandbox errors. If administrator-approved setup is blocked on a managed machine, choose an API summary provider or use a separately configured Claude CLI instead. Use an API summary provider if you need to avoid giving Codex commands read access to other local files.

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
