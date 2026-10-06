@echo off
setlocal
set "PAPERLENS_SCRIPT=%~dp0install-update-paperlens.ps1"
if not exist "%PAPERLENS_SCRIPT%" (
  echo Download install-update-paperlens.ps1 and this CMD file from the same PaperLens release into one folder.
  pause
  exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%PAPERLENS_SCRIPT%" %*
set "PAPERLENS_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %PAPERLENS_EXIT%
