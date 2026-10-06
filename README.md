# PaperLens

영어 논문과 웹 기사의 원문 옆에 한국어 번역을 붙이고, 본문 위에 읽기 쉬운 요약을 표시하는 Chrome 확장 프로그램입니다. 각 사용자는 자신의 API 키를 사용합니다.

PaperLens adds Korean translation beside original English passages and structured inline summaries to scientific papers and ordinary web articles.

## AI 에이전트에게 설치 맡기기

Codex, Claude Code 등 컴퓨터에서 명령을 실행할 수 있는 AI 에이전트에 아래 요청과 저장소 링크를 전달하세요.

```text
https://github.com/gmbcofficial2024/paperlens
README의 AI 에이전트 설치 절차를 읽고 이 컴퓨터의 Chrome에 PaperLens를 설치해줘.
일반 사용자용 Release와 Gemini API 설정을 사용해줘.
기존 설치가 있으면 현재 Chrome에 등록된 폴더를 유지해서 업데이트해줘.
Chrome 등록은 가능한 브라우저 도구로 진행하고, 직접 해야 하는 단계는 정확히 안내해줘.
API 키는 내가 Settings에 직접 입력할게. 완료한 단계와 남은 단계를 알려줘.
```

### AI agents: installation contract

이 절차는 **사용자 PC에 확장을 설치하는 작업**입니다. 기본 경로는 빌드된 공개 Release이며 Git, Node, Python, Codex CLI 또는 Claude CLI 설치가 필요하지 않습니다. 설치를 도와주는 에이전트 자체의 실행 환경은 별도로 준비되어 있어야 합니다.

1. **환경과 기존 설치를 확인합니다.** 아래 자동 명령은 Windows용입니다. macOS/Linux에서는 [ZIP 직접 설치](#zip-직접-설치)를 따릅니다. 기존 PaperLens가 있으면 Chrome에 등록된 정확한 폴더를 사용합니다. 경로를 확인할 수 없다면 사용자에게 확인한 뒤 업데이트합니다. 신규 설치의 기본값은 `%LOCALAPPDATA%\PaperLens\extension`입니다.
2. **같은 Release의 파일을 받습니다.** 공개 API `https://api.github.com/repos/gmbcofficial2024/paperlens/releases/latest`의 `assets`에서 `install-update-paperlens.ps1`, `Install-Update-PaperLens.cmd`, `SHA256SUMS`를 받습니다. 두 도우미의 SHA-256을 먼저 확인하고 실행합니다. GitHub 로그인이나 토큰은 필요하지 않습니다.
3. **명시적인 경로로 실행합니다.** `.cmd`의 대화형 메뉴 대신 `.ps1`에 `-InstallDirectory`를 전달합니다. 도우미가 최신 ZIP 다운로드, ZIP 체크섬·파일 검증, 기존 폴더 백업과 갱신을 수행합니다. 소스 저장소처럼 다른 파일이 섞인 폴더가 거부되면 그 검사를 우회하지 말고 [기존 설치 업데이트 안내](docs/INSTALL.md#기존-설치-업데이트하기)를 따릅니다.
4. **파일 설치를 확인합니다.** 프로세스 종료 코드가 `0`인지, 설치된 `manifest.json`의 버전이 선택한 Release 태그와 같은지, manifest가 참조하는 런타임 파일이 존재하는지 확인합니다. 업데이트의 백업 위치도 기록합니다.
5. **Chrome에 적용합니다.** 사용 가능한 브라우저 도구가 있으면 사용자가 사용할 Chrome 프로필에서 `chrome://extensions`를 열어 개발자 모드와 **Load unpacked**를 진행합니다. 도구가 없으면 설치 경로와 이 두 동작을 사용자에게 안내합니다. 기존 설치는 제거하지 않고 **Reload**한 뒤 기사 탭을 새로고침합니다. 도우미만 실행했다고 Chrome 등록까지 완료한 것으로 보고하지 않습니다.
6. **키 입력과 최종 상태를 안내합니다.** 사용자가 Settings에서 자신의 키를 입력하고 저장하도록 안내합니다. API 키를 채팅, 로그, 파일 또는 저장소에 기록하지 않습니다. 유료 API 연결 테스트나 요약은 사용자가 요청했을 때 실행합니다. 마지막에는 버전, 설치 경로, Chrome 등록·다시 로드 상태, API 키 설정 상태와 남은 사용자 동작을 보고합니다.

<details>
<summary>Windows 에이전트용 PowerShell 명령 예시</summary>

Windows PowerShell 5.1과 PowerShell 7에서 사용할 수 있습니다. 아래는 **신규 설치** 예시입니다. 업데이트에서는 첫 번째 설치 경로를 기존 Chrome에 등록된 폴더의 절대 경로로 바꿉니다. 다운로드한 코드는 같은 Release의 체크섬이 일치할 때 실행합니다.

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

도우미는 실행할 때 최신 Release를 다시 조회합니다. 다운로드 도중 새 버전이 게시되어 마지막 버전 비교가 실패하면 실제 설치 버전과 백업을 확인하고, 최신 자산을 다시 받아 상태를 확인합니다. 위 명령이 특정 버전의 ZIP을 고정해서 설치하는 방식은 아닙니다.

Windows 파일 설치 명령은 Chrome 등록과 API 키 저장을 수행하지 않습니다. 기관 정책이 스크립트 실행이나 개발자 모드를 제한하면 해당 관리자에게 필요한 설정을 확인합니다. 시스템 정책을 바꾸거나 브라우저 프로필 파일을 직접 편집하는 설치 방식은 사용하지 않습니다.

</details>

## 다운로드와 설치

**[최신 Release 다운로드](https://github.com/gmbcofficial2024/paperlens/releases/latest)**

Chrome Web Store 등록 없이 사용할 수 있는 공개 배포입니다. GitHub의 `Source code (zip)` 대신 Release의 `paperlens-<version>.zip`을 사용하세요. 이 ZIP에는 빌드가 끝난 확장 프로그램이 들어 있습니다.

### Windows 설치·업데이트 도우미

1. 같은 Release에서 `Install-Update-PaperLens.cmd`와 `install-update-paperlens.ps1`을 한 폴더에 다운로드합니다.
2. `.cmd` 파일을 실행합니다. 처음 설치하면 `N`, 기존 배포 폴더를 업데이트하면 `U`를 선택합니다.
3. 처음 설치 시 안내된 폴더를 `chrome://extensions`의 **개발자 모드 → 압축해제된 확장 프로그램을 로드합니다**에서 선택합니다.
4. 업데이트 후에는 같은 페이지에서 PaperLens의 **다시 로드**를 누르고, 열려 있는 기사 탭을 새로고침합니다.

도우미는 공개 Release의 ZIP과 SHA-256 체크섬을 내려받고 기존 파일을 백업합니다. Git, Node, Python 또는 GitHub 로그인이 필요하지 않습니다. 기존 개발용 소스 폴더는 도우미의 업데이트 대상으로 사용할 수 없습니다. 자세한 이전·설치 방법은 [설치 안내](docs/INSTALL.md)를 참고하세요.

### ZIP 직접 설치

Windows, macOS, Linux에서는 ZIP을 고정된 폴더에 풀어 Chrome 개발자 모드에서 직접 로드할 수도 있습니다. Chrome은 설치 폴더의 파일을 계속 읽으므로 폴더를 보관해야 합니다. 새 버전은 **기존 폴더의 내용을 교체**하고 확장을 다시 로드하세요.

GitHub 배포는 Chrome의 스토어 자동 업데이트를 제공하지 않습니다. 확장을 제거하거나 매번 새 버전 폴더를 등록하면 설정과 API 키가 별도의 설치에 남을 수 있습니다.

## 처음 사용하기

1. [Google AI Studio](https://aistudio.google.com/apikey)에서 자신의 Gemini API 키를 발급합니다.
2. PaperLens의 **Settings**에서 **Translation Provider → Google Gemini**를 선택하고 키와 계정에서 사용할 수 있는 모델을 저장합니다.
3. **Summary Provider → Google Gemini API**를 선택합니다. 별도 요약 키를 비워 두면 번역용 Gemini 키를 재사용합니다.
4. **Save Settings**를 누른 뒤 영어 기사나 논문 페이지를 엽니다.

| 기능 | 사용 방법 |
|---|---|
| 원문 옆 번역 표시·숨기기 | `Alt+T` 또는 팝업의 번역 버튼 |
| 현재 문서 요약 | `Alt+S` 또는 팝업의 요약 버튼 |
| 설정 변경 후 적용 | 저장 후 기사 탭 새로고침 |

**Test saved API connection**은 저장된 번역 설정으로 짧은 요청을 보냅니다. 번역·요약·연결 테스트에는 선택한 제공자의 API 요금이 발생할 수 있습니다. 번역 시작 전 자동 요약은 기본적으로 꺼져 있습니다. 다른 번역 제공자와 Vertex 요약도 설정에서 선택할 수 있습니다.

API 키는 해당 브라우저 프로필의 로컬 저장소에 보관됩니다. PaperLens 계정이나 공용 API 키는 없습니다. 사용 전 [개인정보 안내](docs/PRIVACY.md)를 확인하세요.

## 처리 범위

PaperLens는 **현재 로드된 HTML에서 접근 가능한 본문**을 처리합니다. 논문과 일반 기사에 맞는 요약 형식을 사용하고, 캡처한 원문의 범위와 부분 수집 상태를 표시합니다. 새 본문이 로드되면 활성 번역에 반영하고, 요약은 사용자가 갱신할 수 있습니다.

출판사 전체의 모든 페이지에 대한 완전 수집을 보장하지 않습니다. 초록만 공개된 페이지, 유료·미로딩 본문 등은 범위 안내를 확인하세요. 외부 PDF, OCR, 이미지 분석, Q&A는 이 배포의 처리 범위에 포함되지 않습니다.

문제가 있는 공개 페이지는 [Issues](https://github.com/gmbcofficial2024/paperlens/issues)에 URL, PaperLens·Chrome 버전, 빠진 문단과 화면의 원문 범위 안내를 남겨 주세요. API 키와 비공개 자료는 첨부하지 마세요.

## 개발과 새 버전 배포

Node 22 이상을 사용합니다. 전체 개발 테스트는 Windows와 PowerShell 7 환경에서 실행합니다.

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run package:share
```

`build`는 `dist/`와 기존 개발용 루트 JavaScript 번들을 생성합니다. 확장을 다시 로드하고 기사 탭을 새로고침해 변경을 확인하세요. `package:share`는 `release/`에 설치 ZIP, 체크섬과 Windows 도우미를 생성합니다.

`main`에 push하거나 Pull Request를 열면 CI가 검증합니다. 버전 파일을 맞추고 `v<version>` 태그를 push하면 검증 후 GitHub Release가 생성됩니다. [배포 절차](docs/RELEASING.md)와 [기여 안내](CONTRIBUTING.md)를 참고하세요.

## 선택 사항: Codex·Claude 요약

Codex CLI 또는 Claude CLI 요약은 전체 소스, Node, 인증된 CLI와 별도의 native host 등록이 필요합니다. 일반 API 키 설치에는 필요하지 않습니다. [Windows native 설치 안내](docs/NATIVE_INSTALL.md)를 참고하세요.

## 라이선스

PaperLens 프로젝트 코드는 [MIT](LICENSE) 라이선스로 배포합니다. Mozilla Readability와 Zod는 각각의 라이선스와 고지를 유지합니다. [외부 라이브러리 고지](THIRD_PARTY_NOTICES.md)를 참고하세요.
