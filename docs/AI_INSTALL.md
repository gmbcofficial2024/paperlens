# Install or update PaperLens with an AI agent

This is the complete installation runbook for a user-requested PaperLens installation or update. Start here when the repository's README routes an installation task to you. Execute the supported steps using the user's available tools and report their actual result. Reading documentation alone does not install the extension.

Canonical repository: https://github.com/gmbcofficial2024/paperlens

Use the latest stable **compiled Release**, Google Gemini API fixed to `gemini-flash-latest`, and the user's own API key. Normal user installation requires Chrome and a key; it does not require cloning source, Git, Node, Python, Codex CLI or Claude CLI. Native Codex/Claude summaries are an optional, separately requested workflow in [NATIVE_INSTALL.md](NATIVE_INSTALL.md).

## 1. Select the environment and installation folder

- Windows: follow the executable PowerShell procedure below. Use Windows PowerShell 5.1 or PowerShell 7 for the bootstrap; the verified helper runs with the PowerShell included with Windows. No administrator rights or GitHub login are required.
- macOS/Linux: follow the release-ZIP procedure below. The Windows helper is not supported on those systems.
- An agent with only web access cannot write files or register Chrome extensions. Complete the documentation/discovery work and identify the exact local step the user must perform; do not report an installation that did not happen.

For an existing installation, determine the exact unpacked folder already registered in the intended Chrome profile. Use browser controls if available, or the path supplied by the user. If an existing installation is known but its path is unknown, resolve that missing path before updating; downloading and verifying the release can continue meanwhile. Keep the same folder and profile so Chrome preserves the extension identity and local settings.

For a new Windows installation, use `%LOCALAPPDATA%\PaperLens\extension`. Use an absolute dedicated extension folder. The helper rejects source checkouts, unrelated personal files, drive roots, network shares and linked paths. If the user has a development installation, follow [the existing-installation instructions](INSTALL.md#기존-설치-업데이트하기) instead of bypassing those checks.

## 2. Install or update the files on Windows

Run the following block from a PowerShell terminal. It obtains one stable Release's helper files and SHA256SUMS, validates both helpers, then runs the PS1 directly with an explicit installation path. Do not use the CMD launcher for an agent run: its user menu and `pause` are interactive.

The first path assignment is for a new installation. **For an update, replace that assignment with the exact existing absolute folder before running.** The helper validates the downloaded ZIP, stages all browser files, retains the previous folder as a sibling backup, and restores it if replacement fails.

```powershell
$ErrorActionPreference = 'Stop'
$paperlensInstallDirectory = Join-Path $env:LOCALAPPDATA 'PaperLens\extension'
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

Choose one permanent, dedicated folder for a first install, such as `~/Library/Application Support/PaperLens/extension` on macOS or `~/.local/share/paperlens/extension` on Linux. Use the currently registered folder for an update. Validate the extracted manifest/runtime assets, preserve a backup of an existing dedicated extension directory, and place the ZIP's inner `paperlens-<version>` contents in that permanent folder. Do not load a new versioned folder as a separate extension. Follow [INSTALL.md](INSTALL.md#zip으로-직접-설치하기) if manual archive handling is needed.

## 3. Apply the installation in Chrome

Use the browser-control tools available to this agent, if they can access the intended user's Chrome profile:

1. Open `chrome://extensions`.
2. First install: enable Developer mode, choose **Load unpacked**, and select the exact folder containing `manifest.json`.
3. Update: keep the existing extension registered and choose **Reload** on its card. Refresh open article tabs afterwards.
4. Verify that the PaperLens card is enabled and displays the installed version. Pin its toolbar icon if useful.

If browser controls cannot complete a step, give the user the exact folder and the remaining UI actions. Do not modify browser profile files or system policies to imitate registration. A downloaded/extracted folder is not evidence of a loaded Chrome extension. If an institution restricts script execution or Developer mode, report that actual restriction rather than changing its policies.

## 4. Configure the user's API key

Open PaperLens **Settings** or direct the user there. Guide the user to enter their own key through the Settings UI; do not ask them to paste a key into the chat, logs, a file or the repository.

- **Translation Provider**: Google Gemini and the user's key. The shared Release fixes API translation, API summary and connection tests to `gemini-flash-latest`; do not guide the user to choose a different model or API provider.
- **Summary Provider**: Google Gemini API. A blank separate summary key reuses the saved translation Gemini key.
- Choose **Save Settings**, then refresh the article tab.

On update, old API provider and Pro/Lite selections are normalized to Gemini Flash Latest. Existing Gemini keys and optional native summary choices are retained. Other providers' credentials are never copied to Gemini; if no Gemini translation key exists, key entry is still pending. Google may update the version behind the fixed `latest` alias. Source development builds keep their broader provider choices.

See [INSTALL.md](INSTALL.md#api-키-저장하기) for the detailed UI steps and [PRIVACY.md](PRIVACY.md) for provider destinations and local storage. Do not automatically run a paid connection test, translation or summary as part of installing files. Run it when requested by the user and report its actual result; a translation connection test does not verify a separately configured summary provider.

## 5. Report completion accurately

| Stage | Evidence to report |
|---|---|
| Files | Actual version, permanent folder, successful helper/archive verification, backup location if updated |
| Chrome | Correct profile, enabled PaperLens card/version, or the exact registration/reload step still pending |
| Settings | Provider selection and key saved through UI, or key entry still pending; never include the key value |
| Functional check | Actual requested test result, or not run; do not infer it from file installation |

Installation is ready for use when the files are verified, Chrome has loaded the intended extension, and the user's provider settings are saved. If a stage needs the user's browser access or key input, complete the independent stages and identify the remaining action instead of claiming everything is finished.
