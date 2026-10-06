param(
  [ValidateSet("Chrome", "Edge")]
  [string]$Browser = "Chrome"
)

$ErrorActionPreference = "Stop"

$HostName = "com.paperlens.summary_host"

if ($Browser -eq "Chrome") {
  $RegPath = "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName"
} else {
  $RegPath = "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
}

reg.exe delete $RegPath /f | Out-Null
Write-Host "Unregistered $HostName for $Browser."
