<#
.SYNOPSIS
Install or update PaperLens from its latest public GitHub release.
.DESCRIPTION
Requires only built-in Windows PowerShell 5.1 and .NET. Download this file
and Install-Update-PaperLens.cmd from the same release into one folder.
Double-click the CMD file. Choose U to select the exact unpacked extension
folder already loaded in Chrome, or N for the first-install default:
the Windows Documents Known Folder\PaperLens\extension. The Documents path
follows Windows folder redirection, including a local OneDrive location.
Keeping the loaded folder path preserves
the unpacked extension identity and its browser-local settings.

The helper downloads paperlens-VERSION.zip and SHA256SUMS from the latest
public release. It verifies SHA-256, validates every ZIP entry against the
browser package allowlist, stages the complete extension, and replaces the
selected folder. A prior installation is retained in a sibling backup.
If replacement fails, the helper restores the prior folder where possible.
It refuses folders containing unrelated files, including source checkouts.

No Git, Node, Python, native host, administrator rights, browser profile
edits, browser policies, scheduled tasks, or persistent execution-policy
changes are installed. First installs still require Chrome Developer mode
and Load unpacked. Updates require Reload and refreshing article tabs.
.PARAMETER InstallDirectory
Explicit dedicated extension folder. Skips the interactive folder prompt.
Use the same absolute folder already loaded in Chrome when updating.
.PARAMETER LocalReleaseDirectory
Offline fixture/release directory containing exactly one versioned ZIP and
SHA256SUMS. Requires InstallDirectory and makes no network requests.
.PARAMETER Repository
Public GitHub owner/repository. Defaults to gmbcofficial2024/paperlens.
.EXAMPLE
.\install-update-paperlens.ps1
.EXAMPLE
.\install-update-paperlens.ps1 -InstallDirectory 'C:\Users\me\PaperLens'
.EXAMPLE
.\install-update-paperlens.ps1 -LocalReleaseDirectory 'C:\offline-release' -InstallDirectory 'C:\test-extension'
#>
[CmdletBinding()]
param(
    [string]$InstallDirectory,
    [string]$LocalReleaseDirectory,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$')]
    [string]$Repository = 'gmbcofficial2024/paperlens'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:AllowedFiles = @(
    'LICENSE', 'INSTALL.md', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md',
    'background.js', 'content.js', 'popup.js', 'options.js', 'manifest.json',
    'popup.html', 'options.html', 'content.css',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
    'licenses/APACHE-2.0.txt', 'licenses/Readability-LICENSE.md',
    'licenses/Zod-LICENSE.txt'
)
$script:AllowedDirectories = @('icons', 'licenses')

function Assert-ContainedPath {
    param([string]$Path, [string]$Parent)
    $absolute = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
    if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path must remain inside the selected directory: $absolute"
    }
}

function Assert-NoReparsePoint {
    param([string]$Path)
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Linked installation paths are not supported: $cursor"
            }
        }
        $next = [IO.Path]::GetDirectoryName($cursor)
        if ($next -eq $cursor) { break }
        $cursor = $next
    }
}

function Resolve-InstallDirectory {
    param([string]$Requested)
    if (-not $Requested) {
        if ($LocalReleaseDirectory) { throw 'Offline mode requires -InstallDirectory.' }
        $documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, [Environment+SpecialFolderOption]::DoNotVerify)
        if (-not $documents) { throw 'Windows Documents folder is unavailable. Specify -InstallDirectory.' }
        $default = Join-Path $documents 'PaperLens\extension'
        Write-Host 'Existing users: choose U and select the same folder already loaded in Chrome.'
        Write-Host 'This keeps the extension identity and browser-local settings.'
        Write-Host "New installation folder: $default"
        $choice = (Read-Host '[U] Update existing folder, [N] New install, [Q] Quit').Trim().ToUpperInvariant()
        if ($choice -eq 'N') { $Requested = $default }
        elseif ($choice -eq 'U') {
            Add-Type -AssemblyName System.Windows.Forms
            $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
            try {
                $dialog.Description = 'Select the exact PaperLens extension folder currently loaded in chrome://extensions.'
                $dialog.ShowNewFolderButton = $false
                if (Test-Path -LiteralPath $default -PathType Container) { $dialog.SelectedPath = $default }
                if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'Installation cancelled. No files changed.' }
                $Requested = $dialog.SelectedPath
            } finally { $dialog.Dispose() }
        } elseif ($choice -eq 'Q') { throw 'Installation cancelled. No files changed.' }
        else { throw 'Choose U, N, or Q. No files changed.' }
    }
    $absolute = [IO.Path]::GetFullPath($Requested).TrimEnd([char[]]'\/')
    if ($Requested -notmatch '^[A-Za-z]:[\\/]' -or $absolute -eq [IO.Path]::GetPathRoot($absolute).TrimEnd([char[]]'\/')) {
        throw 'Choose an absolute extension folder, not a drive root.'
    }
    if ($absolute.StartsWith('\\') -or [IO.Path]::GetFileName($absolute) -match '[. ]$') {
        throw 'Choose a normal local extension folder path.'
    }
    Assert-NoReparsePoint $absolute
    if ((Test-Path -LiteralPath $absolute) -and -not (Test-Path -LiteralPath $absolute -PathType Container)) {
        throw 'The installation path must be a directory.'
    }
    return $absolute
}

function Assert-ExtensionManifest {
    param([string]$Directory, [string]$ExpectedVersion)
    $manifestPath = Join-Path $Directory 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Missing extension manifest.json.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.name -ne 'PaperLens' -or $manifest.manifest_version -ne 3 -or [string]$manifest.version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {
        throw 'The selected folder is not a supported PaperLens extension.'
    }
    if ($ExpectedVersion -and [string]$manifest.version -ne $ExpectedVersion) { throw 'ZIP manifest version does not match the release version.' }
    if ($manifest.background.service_worker -ne 'background.js' -or $manifest.action.default_popup -ne 'popup.html' -or $manifest.options_page -ne 'options.html') {
        throw 'ZIP manifest contains unexpected runtime paths.'
    }
    foreach ($size in @('16', '48', '128')) {
        if ($manifest.icons.$size -ne "icons/icon$size.png") { throw 'ZIP manifest contains unexpected icon paths.' }
    }
    return $manifest
}

function Assert-ExistingExtensionFolder {
    param([string]$Directory)
    if (-not (Test-Path -LiteralPath $Directory)) { return $false }
    $children = @(Get-ChildItem -LiteralPath $Directory -Force)
    if ($children.Count -eq 0) { return $false }
    $pending = New-Object 'System.Collections.Generic.Queue[string]'
    $pending.Enqueue($Directory)
    $prefix = $Directory.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
    while ($pending.Count -gt 0) {
        foreach ($item in @(Get-ChildItem -LiteralPath $pending.Dequeue() -Force)) {
            Assert-ContainedPath $item.FullName $Directory
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Use a dedicated PaperLens extension folder without links.' }
            $relative = $item.FullName.Substring($prefix.Length).Replace('\', '/')
            if ($item.PSIsContainer) {
                if ($relative -cnotin $script:AllowedDirectories) { throw 'Use a dedicated PaperLens extension folder; unrelated files or directories were found.' }
                $pending.Enqueue($item.FullName)
            } elseif ($relative -cnotin $script:AllowedFiles) {
                throw 'Use a dedicated PaperLens extension folder; unrelated files or directories were found.'
            }
        }
    }
    $null = Assert-ExtensionManifest $Directory
    return $true
}

function Get-ReleaseFiles {
    param([string]$WorkDirectory)
    $checksumPath = Join-Path $WorkDirectory 'SHA256SUMS'
    if ($LocalReleaseDirectory) {
        $local = [IO.Path]::GetFullPath($LocalReleaseDirectory)
        $archives = @(Get-ChildItem -LiteralPath $local -File -Filter 'paperlens-*.zip')
        if ($archives.Count -ne 1 -or $archives[0].Name -cnotmatch '^paperlens-(\d+\.\d+\.\d+(?:\.\d+)?)\.zip$') {
            throw 'Offline release directory must contain exactly one paperlens-VERSION.zip.'
        }
        $version = $Matches[1]
        $assetName = $archives[0].Name
        $zipPath = Join-Path $WorkDirectory $assetName
        Copy-Item -LiteralPath $archives[0].FullName -Destination $zipPath
        Copy-Item -LiteralPath (Join-Path $local 'SHA256SUMS') -Destination $checksumPath
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $headers = @{ 'User-Agent' = 'PaperLens-Windows-Installer'; 'Accept' = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers $headers -TimeoutSec 60
        if ($release.draft -or $release.prerelease -or [string]$release.tag_name -cnotmatch '^v?(\d+\.\d+\.\d+(?:\.\d+)?)$') {
            throw 'The latest public release has an unsupported version tag.'
        }
        $version = $Matches[1]
        $assetName = "paperlens-$version.zip"
        $zipPath = Join-Path $WorkDirectory $assetName
        foreach ($name in @($assetName, 'SHA256SUMS')) {
            $assets = @($release.assets | Where-Object { [string]$_.name -ceq $name })
            if ($assets.Count -ne 1) { throw "The latest release must contain exactly one $name asset." }
            $asset = $assets[0]
            $uri = [Uri]$asset.browser_download_url
            $expectedPrefix = "https://github.com/$Repository/releases/download/"
            if (-not $uri.AbsoluteUri.StartsWith($expectedPrefix, [StringComparison]::Ordinal) -or $asset.size -gt 64MB) { throw 'Unexpected release asset URL or size.' }
            Invoke-WebRequest -Uri $uri.AbsoluteUri -Headers $headers -UseBasicParsing -OutFile (Join-Path $WorkDirectory $name) -TimeoutSec 120
        }
    }
    if ((Get-Item -LiteralPath $zipPath).Length -gt 64MB -or (Get-Item -LiteralPath $checksumPath).Length -gt 1MB) { throw 'Release asset exceeds the supported size limit.' }
    $matchingHashes = @()
    foreach ($line in @(Get-Content -LiteralPath $checksumPath -Encoding ASCII)) {
        if (-not $line.Trim()) { continue }
        if ($line -cnotmatch '^([A-Fa-f0-9]{64})[ \t]+\*?([A-Za-z0-9._-]+)$') { throw 'Invalid SHA256SUMS format.' }
        if ($Matches[2] -ceq $assetName) { $matchingHashes += $Matches[1] }
    }
    if ($matchingHashes.Count -ne 1) { throw 'SHA256SUMS must contain exactly one checksum for the extension ZIP.' }
    $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
    $hashStream = [IO.File]::OpenRead($zipPath)
    try { $actualHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($hashStream)).Replace('-', '') }
    finally { $hashStream.Dispose(); $hashAlgorithm.Dispose() }
    if ($actualHash -ine $matchingHashes[0]) { throw 'SHA-256 checksum mismatch. No extension files were changed.' }
    return [PSCustomObject]@{ ZipPath = $zipPath; Version = $version }
}

function Assert-ZipEntries {
    param([IO.Compression.ZipArchive]$Archive, [string]$Version)
    $prefix = "paperlens-$Version/"
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $files = @()
    $expandedSize = [long]0
    if ($Archive.Entries.Count -gt 128) { throw 'ZIP contains an invalid entry count.' }
    foreach ($entry in $Archive.Entries) {
        $name = $entry.FullName
        if ($name -cmatch '[\\:\x00-\x1f\x7f-\uffff]' -or -not $name.StartsWith($prefix, [StringComparison]::Ordinal)) { throw "ZIP contains an invalid path: $name" }
        foreach ($segment in $name.TrimEnd('/').Split('/')) {
            if (-not $segment -or $segment -eq '.' -or $segment -eq '..' -or $segment -match '[. ]$') { throw "ZIP contains an invalid path: $name" }
        }
        if (-not $seen.Add($name.TrimEnd('/'))) { throw "ZIP contains a duplicate entry: $name" }
        $attributes = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$entry.ExternalAttributes), 0)
        $unixType = ($attributes -shr 16) -band 0xf000
        if (($attributes -band 0x400) -ne 0 -or $unixType -notin @(0, 0x8000, 0x4000)) { throw "ZIP contains a link or special file: $name" }
        $relative = $name.Substring($prefix.Length)
        if ($name.EndsWith('/')) {
            if ($entry.Length -ne 0 -or $relative.TrimEnd('/') -cnotin @('', 'icons', 'licenses')) { throw "ZIP directory is outside the allowlist: $name" }
        } else {
            if ($unixType -eq 0x4000 -or $relative -cnotin $script:AllowedFiles) { throw "ZIP entry is outside the allowlist: $name" }
            $expandedSize += $entry.Length
            if ($entry.Length -gt 64MB -or $expandedSize -gt 128MB) { throw 'ZIP contains an invalid expanded size.' }
            $files += [PSCustomObject]@{ Entry = $entry; Relative = $relative }
        }
    }
    if ($files.Count -ne $script:AllowedFiles.Count) { throw 'ZIP does not contain every required extension allowlist file.' }
    return $files
}

$workDirectory = $null
$stageDirectory = $null
$backupDirectory = $null
$backupCreated = $false
$exitCode = 0
try {
    Write-Host "PaperLens installer - PowerShell $($PSVersionTable.PSVersion.Major).$($PSVersionTable.PSVersion.Minor)"
    $targetDirectory = Resolve-InstallDirectory $InstallDirectory
    $isUpdate = Assert-ExistingExtensionFolder $targetDirectory
    $parentDirectory = [IO.Path]::GetDirectoryName($targetDirectory)
    $leaf = [IO.Path]::GetFileName($targetDirectory)
    $workDirectory = Join-Path ([IO.Path]::GetTempPath()) ('PaperLens-release-' + [Guid]::NewGuid().ToString('N'))
    Assert-ContainedPath $workDirectory ([IO.Path]::GetTempPath())
    $null = [IO.Directory]::CreateDirectory($workDirectory)
    $releaseFiles = Get-ReleaseFiles $workDirectory
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($releaseFiles.ZipPath)
    try {
        $entries = @(Assert-ZipEntries $archive $releaseFiles.Version)
        $stageDirectory = Join-Path $parentDirectory ($leaf + '.staging-' + [Guid]::NewGuid().ToString('N'))
        Assert-ContainedPath $stageDirectory $parentDirectory
        Assert-NoReparsePoint $parentDirectory
        $null = [IO.Directory]::CreateDirectory($stageDirectory)
        foreach ($item in $entries) {
            $filePath = Join-Path $stageDirectory $item.Relative.Replace('/', [IO.Path]::DirectorySeparatorChar)
            Assert-ContainedPath $filePath $stageDirectory
            $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($filePath))
            $inputStream = $item.Entry.Open()
            try {
                $outputStream = [IO.File]::Open($filePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
                try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
            } finally { $inputStream.Dispose() }
        }
    } finally { $archive.Dispose() }
    $null = Assert-ExtensionManifest $stageDirectory $releaseFiles.Version
    # Recheck the selected absolute target before either directory move.
    Assert-NoReparsePoint $targetDirectory
    $null = Assert-ExistingExtensionFolder $targetDirectory
    if (Test-Path -LiteralPath $targetDirectory) {
        $backupDirectory = Join-Path $parentDirectory ($leaf + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N'))
        Assert-ContainedPath $backupDirectory $parentDirectory
        Move-Item -LiteralPath $targetDirectory -Destination $backupDirectory
        $backupCreated = $true
    }
    Move-Item -LiteralPath $stageDirectory -Destination $targetDirectory
    $stageDirectory = $null
    $null = Assert-ExtensionManifest $targetDirectory $releaseFiles.Version
    Write-Host "Installed PaperLens $($releaseFiles.Version): $targetDirectory"
    if ($backupCreated) { Write-Host "Previous folder retained for rollback: $backupDirectory" }
    if ($isUpdate) {
        Write-Host 'In chrome://extensions, click Reload for PaperLens, then refresh article tabs.'
    } else {
        Write-Host 'Open chrome://extensions, enable Developer mode, click Load unpacked, and select this folder:'
        Write-Host $targetDirectory
    }
} catch {
    $exitCode = 1
    $failure = $_.Exception.Message
    if ($backupCreated) {
        try {
            Assert-ContainedPath $backupDirectory $parentDirectory
            Assert-NoReparsePoint $targetDirectory
            if (Test-Path -LiteralPath $targetDirectory) { Remove-Item -LiteralPath $targetDirectory -Recurse -Force }
            Move-Item -LiteralPath $backupDirectory -Destination $targetDirectory
            $backupCreated = $false
            Write-Host 'Restored the previous extension folder after replacement failed.'
        } catch {
            Write-Host "Automatic restore failed. Your previous folder is retained here: $backupDirectory"
            Write-Host "Restore error: $($_.Exception.Message)"
        }
    }
    [Console]::Error.WriteLine("PaperLens installation failed: $failure")
} finally {
    if ($stageDirectory -and (Test-Path -LiteralPath $stageDirectory)) {
        Assert-ContainedPath $stageDirectory $parentDirectory
        Assert-NoReparsePoint $stageDirectory
        Remove-Item -LiteralPath $stageDirectory -Recurse -Force
    }
    if ($workDirectory -and (Test-Path -LiteralPath $workDirectory)) {
        Assert-ContainedPath $workDirectory ([IO.Path]::GetTempPath())
        Remove-Item -LiteralPath $workDirectory -Recurse -Force
    }
}
exit $exitCode
