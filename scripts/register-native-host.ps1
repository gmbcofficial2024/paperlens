param(
  [Parameter(Mandatory = $true)]
  [string[]]$ExtensionId,

  [ValidateSet("Chrome", "Edge")]
  [string[]]$Browser = @("Chrome"),

  [string]$ManifestPath,

  [ValidateNotNullOrEmpty()]
  [string]$RegistryCommand = "reg.exe",

  [switch]$SkipRegistry
)

$ErrorActionPreference = "Stop"

$HostName = "com.paperlens.summary_host"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$HostCmd = Join-Path $RepoRoot "native-host\paperlens-summary-host.cmd"
if (-not $ManifestPath) {
  $ManifestPath = Join-Path $RepoRoot "native-host\$HostName.json"
}
$ManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)

if (-not (Test-Path -LiteralPath $HostCmd)) {
  throw "Native host command not found: $HostCmd"
}

$ExtensionIds = @($ExtensionId | Select-Object -Unique)
foreach ($Id in $ExtensionIds) {
  if ($Id -cnotmatch "^[a-p]{32}$") {
    throw "Extension ID must be 32 lowercase characters from a through p: $Id"
  }
}

$Browsers = @($Browser | Select-Object -Unique)
$ResolvedHostCmd = (Resolve-Path -LiteralPath $HostCmd).Path
$Manifest = [ordered]@{
  name = $HostName
  description = "PaperLens local summary host for Codex CLI and Claude CLI"
  path = $ResolvedHostCmd
  type = "stdio"
  allowed_origins = @($ExtensionIds | ForEach-Object { "chrome-extension://$_/" })
}

$Manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

foreach ($BrowserName in $Browsers) {
  if ($BrowserName -eq "Chrome") {
    $RegPath = "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName"
  } else {
    $RegPath = "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
  }

  if ($SkipRegistry) {
    Write-Host "Skipped registry registration for $BrowserName."
  } else {
    & $RegistryCommand add $RegPath /ve /t REG_SZ /d $ManifestPath /f | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Registry registration failed for $BrowserName with exit code $LASTEXITCODE."
    }
    Write-Host "Registered $HostName for $BrowserName."
  }
}

Write-Host "Manifest: $ManifestPath"
foreach ($Id in $ExtensionIds) {
  Write-Host "Allowed extension: chrome-extension://$Id/"
}
