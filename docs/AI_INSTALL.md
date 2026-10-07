# Install or update PaperLens with an AI agent

This is the complete installation runbook for a user-requested PaperLens installation or update. Start here when the repository's README routes an installation task to you. Execute the supported steps using the user's available tools and report their actual result. Reading documentation alone does not install the extension.

Canonical repository: https://github.com/gmbcofficial2024/paperlens

Use the latest stable **compiled Release**, Google Gemini API as the default provider with its model fixed to `gemini-flash-latest`, and the user's own API key. Other API providers and their model settings remain available when requested. Normal user installation requires Chrome and a key; it does not require cloning source, Git, Node, Python, Codex CLI or Claude CLI. Native Codex/Claude summaries are an optional, separately requested workflow in [NATIVE_INSTALL.md](NATIVE_INSTALL.md).

## 1. Select the environment and installation folder

- Windows: follow the executable PowerShell procedure below. Use Windows PowerShell 5.1 or PowerShell 7 for the bootstrap; the verified helper runs with the PowerShell included with Windows. No administrator rights or GitHub login are required.
- macOS/Linux: follow the release-ZIP procedure below. The Windows helper is not supported on those systems.
- An agent with only web access cannot write files or register Chrome extensions. Complete the documentation/discovery work and identify the exact local step the user must perform; do not report an installation that did not happen.

For an existing installation, determine the exact unpacked folder already registered in the intended Chrome profile. Use browser controls if available, or the path supplied by the user. If an existing installation is known but its path is unknown, resolve that missing path before updating; downloading and verifying the release can continue meanwhile. Keep the same folder and profile so Chrome preserves the extension identity and local settings.

For a new Windows installation with no target supplied, use the user's actual Windows **Documents Known Folder (MyDocuments)** plus `PaperLens\extension`. Resolve it through Windows as shown below; do not derive it from the current directory, `$env:USERPROFILE` or `$env:LOCALAPPDATA`. This follows a normal local OneDrive or redirected Documents location. Use this default without asking the user to choose a folder. A user-specified absolute installation folder takes precedence, and an update must keep the existing registered folder, including older installations in LocalAppData.

Use an absolute dedicated extension folder. The helper rejects source checkouts, unrelated personal files, drive roots, network shares and linked paths. If Windows Documents resolves to a network share or linked path, report that unsupported path and obtain a dedicated local target rather than falling back silently. If the user has a development installation, follow [the existing-installation instructions](INSTALL.md#기존-설치-업데이트하기) instead of bypassing those checks.

## 2. Install or update the files on Windows

Run the following block from a PowerShell terminal. It obtains one stable Release's helper files and SHA256SUMS, validates both helpers, then runs the PS1 directly with an explicit installation path. Do not use the CMD launcher for an agent run: its user menu and `pause` are interactive.

The first three Documents/path lines are for a new installation. **For an update or a user-specified target, replace all three lines with `$paperlensInstallDirectory = 'the exact absolute folder'` before running.** An update uses the existing registered folder. The helper validates the downloaded ZIP, stages all browser files, retains the previous folder as a sibling backup, and restores it if replacement fails.

```powershell
$ErrorActionPreference = 'Stop'
$paperlensDocumentsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, [Environment+SpecialFolderOption]::DoNotVerify)
if (-not $paperlensDocumentsDirectory) { throw 'Windows Documents folder is unavailable. Specify an absolute installation folder.' }
$paperlensInstallDirectory = Join-Path $paperlensDocumentsDirectory 'PaperLens\extension'
$paperlensDownloadDirectory = Join-Path ([IO.Path]::GetTempPath()) ('PaperLens-agent-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $paperlensDownloadDirectory | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$paperlensHeaders = @{ 'User-Agent' = 'PaperLens-Agent-Installer'; 'Accept' = 'application/vnd.github+json' }
$paperlensRelease = Invoke-RestMethod -Uri 'https://api.github.com/repos/gmbcofficial2024/paperlens/releases/latest' -Headers $paperlensHeaders
if ($paperlensRelease.draft -or $paperlensRelease.prerelease -or $paperlensRelease.tag_name -cnotmatch '^v\d+\.\d+\.\d+(?:\.\d+)?$') {
    throw 'Expected a stable versioned PaperLens release.'
}
$paperlensHelpers = @('install-update-paperlens.ps1', 'Install-Update-PaperLens.cmd')
foreach ($paperlensFile in @('SHA256SUMS') + $paperlensHelpers) {
    $paperlensAssets = @($paperlensRelease.assets | Where-Object { $_.name -ceq $paperlensFile })
    if ($paperlensAssets.Count -ne 1) { throw "Missing or duplicate release asset: $paperlensFile" }
    $paperlensAssetUrl = [string]$paperlensAssets[0].browser_download_url
    $paperlensExpectedPrefix = 'https://github.com/gmbcofficial2024/paperlens/releases/download/' + $paperlensRelease.tag_name + '/'
    if (-not $paperlensAssetUrl.StartsWith($paperlensExpectedPrefix, [StringComparison]::Ordinal)) { throw 'Unexpected asset origin.' }
    Invoke-WebRequest -UseBasicParsing -Uri $paperlensAssetUrl -OutFile (Join-Path $paperlensDownloadDirectory $paperlensFile)
}
$paperlensChecksumLines = Get-Content -LiteralPath (Join-Path $paperlensDownloadDirectory 'SHA256SUMS') -Encoding ASCII
foreach ($paperlensFile in $paperlensHelpers) {
    $paperlensPattern = '^([A-Fa-f0-9]{64})[ \t]+\*?' + [regex]::Escape($paperlensFile) + '$'
    $paperlensExpectedHashes = @($paperlensChecksumLines | ForEach-Object {
        $paperlensMatch = [regex]::Match($_, $paperlensPattern)
        if ($paperlensMatch.Success) { $paperlensMatch.Groups[1].Value }
    })
    if ($paperlensExpectedHashes.Count -ne 1) { throw "Missing or duplicate helper checksum: $paperlensFile" }
    $paperlensHasher = [Security.Cryptography.SHA256]::Create()
    $paperlensStream = [IO.File]::OpenRead((Join-Path $paperlensDownloadDirectory $paperlensFile))
    try { $paperlensHash = [BitConverter]::ToString($paperlensHasher.ComputeHash($paperlensStream)).Replace('-', '') }
    finally { $paperlensStream.Dispose(); $paperlensHasher.Dispose() }
    if ($paperlensHash -ine $paperlensExpectedHashes[0]) { throw "Checksum mismatch: $paperlensFile" }
}
$paperlensHelper = Join-Path $paperlensDownloadDirectory 'install-update-paperlens.ps1'
$paperlensPowerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
& $paperlensPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $paperlensHelper -InstallDirectory $paperlensInstallDirectory
if ($LASTEXITCODE -ne 0) { throw 'PaperLens file installation failed.' }
$paperlensManifest = Get-Content -LiteralPath (Join-Path $paperlensInstallDirectory 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ('v' + $paperlensManifest.version -cne $paperlensRelease.tag_name) { throw 'Installed version differs from the selected release; inspect before continuing.' }
Write-Host "Installed PaperLens $($paperlensManifest.version): $paperlensInstallDirectory"
Write-Host 'Next: Chrome registration/reload, then save the user API key in Settings.'
```

The helper itself resolves the latest Release when it runs. If a new version is published during bootstrap and the final version comparison fails, inspect the installed version and retained backup, then refresh release metadata/assets before continuing. This command does not pin a ZIP version.

Before continuing, verify exit code `0`, `manifest.json` version, and the manifest's referenced service worker, popup, options page and icons. Record the actual installation path and the helper's backup path for an update. A failed checksum or helper exit is a failed file installation; preserve the existing folder and report the concrete error.

## 2a. Install or update the files on macOS/Linux

Read `https://api.github.com/repos/gmbcofficial2024/paperlens/releases/latest` and use that response's assets to download `paperlens-<version>.zip` and `SHA256SUMS`. Select the tag-matching ZIP, verify its SHA-256, and extract with the available archive tools into a staging directory. GitHub's automatically generated Source code ZIP is not a loadable browser release.

For a first install without an explicit target, use the user's Documents folder plus `PaperLens/extension`, independently of the agent's current directory. On macOS this is normally `~/Documents/PaperLens/extension`; on Linux use the configured Documents directory (`xdg-user-dir DOCUMENTS` when available), or `~/Documents` if none is configured. Resolve it to an absolute dedicated folder. A user-specified target takes precedence; updates use the currently registered folder. Validate the extracted manifest/runtime assets, preserve a backup of an existing dedicated extension directory, and place the ZIP's inner `paperlens-<version>` contents in that permanent folder. Do not load a new versioned folder as a separate extension. Follow [INSTALL.md](INSTALL.md#zip으로-직접-설치하기) if manual archive handling is needed.

## 3. Apply the installation in Chrome

Use the browser-control tools available to this agent, if they can access the intended user's Chrome profile:

1. Open `chrome://extensions`.
2. First install: enable Developer mode, choose **Load unpacked**, and select the exact folder containing `manifest.json`.
3. Update: keep the existing extension registered and choose **Reload** on its card. Refresh open article tabs afterwards.
4. Verify that the PaperLens card is enabled and displays the installed version. Pin its toolbar icon if useful.

If browser controls cannot complete a step, give the user the exact folder and the remaining UI actions. Do not modify browser profile files or system policies to imitate registration. A downloaded/extracted folder is not evidence of a loaded Chrome extension. If an institution restricts script execution or Developer mode, report that actual restriction rather than changing its policies.

## 4. Configure the user's API key

Open PaperLens **Settings** or direct the user there. Guide the user to enter their own key through the Settings UI; do not ask them to paste a key into the chat, logs, a file or the repository.

- **Translation Provider**: Google Gemini and the user's key by default. The shared Release fixes only Gemini requests to `gemini-flash-latest`. If the user requests another provider, keep that provider and its supported model; do not replace it with Gemini.
- **Summary Provider**: Google Gemini API by default. Vertex, OpenAI and Anthropic API summaries are also supported when requested. A blank summary key or model reuses that same provider's saved translation setting; an unset translation model uses the provider default. Never use a different provider's key. API summaries do not require a native CLI.
- Choose **Save Settings**, then refresh the article tab.

On update, old Gemini Pro/Lite selections are normalized to Gemini Flash Latest. Other provider choices and keys are retained; recognized older model presets migrate to their current counterparts. The former native Codex default `gpt-5.5` migrates to `gpt-6.1-sol`; other explicit native model choices and custom-server models/endpoints are retained. See [current models and migrations](MODELS.md). If version 1.1.2 was used to save settings and switched the provider to Gemini, the intended provider must be selected again. Never copy credentials between providers. Google may update the version behind the fixed `latest` alias. Source development builds also retain Gemini model selection.

See [INSTALL.md](INSTALL.md#api-키-저장하기) for the detailed UI steps and [PRIVACY.md](PRIVACY.md) for provider destinations and local storage. Do not automatically run a paid connection test, translation or summary as part of installing files. Run it when requested by the user and report its actual result; a translation connection test does not verify a separately configured summary provider.

## 5. Report completion accurately

| Stage | Evidence to report |
|---|---|
| Files | Actual version, permanent folder, successful helper/archive verification, backup location if updated |
| Chrome | Correct profile, enabled PaperLens card/version, or the exact registration/reload step still pending |
| Settings | Provider selection and key saved through UI, or key entry still pending; never include the key value |
| Functional check | Actual requested test result, or not run; do not infer it from file installation |

Installation is ready for use when the files are verified, Chrome has loaded the intended extension, and the user's provider settings are saved. If a stage needs the user's browser access or key input, complete the independent stages and identify the remaining action instead of claiming everything is finished.
