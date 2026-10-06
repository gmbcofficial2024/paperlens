# PaperLens

영어 논문과 웹 기사의 원문 옆에 한국어 번역을 붙이고, 본문 위에 읽기 쉬운 요약을 표시하는 Chrome 확장 프로그램입니다. 각 사용자는 자신의 API 키를 사용합니다.

PaperLens adds Korean translation beside original English passages and structured inline summaries to scientific papers and ordinary web articles.

## Install PaperLens / AI agent entry point

**AI 에이전트는 [설치 실행 지침](docs/AI_INSTALL.md)을 먼저 읽고 사용자 PC의 설치·업데이트 절차를 진행하세요.** 환경 선택, 검증된 실행 명령, Chrome 적용, API 키 설정과 완료 기준이 한 문서에 들어 있습니다. 별도의 복사할 요청문은 필요하지 않습니다.

For an installation or update task, read [AI_INSTALL.md](https://github.com/gmbcofficial2024/paperlens/blob/main/docs/AI_INSTALL.md) and carry out the supported steps. Use the compiled stable Release; source development is a separate workflow. The default user installation needs no Git, Node, Python or native CLI.

| 진입 문서 | 역할 |
|---|---|
| [AI_INSTALL.md](docs/AI_INSTALL.md) | 에이전트의 설치·업데이트 실행 절차와 명령 |
| [AGENTS.md](AGENTS.md) | 설치와 개발 작업의 분기, 저장소 작업 규칙 |
| [INSTALL.md](docs/INSTALL.md) | 사용자가 직접 설치하는 방법 |

For tools that fetch plain text: [raw installation runbook](https://raw.githubusercontent.com/gmbcofficial2024/paperlens/main/docs/AI_INSTALL.md). Continue with that document when the GitHub page only returns navigation or a truncated preview.

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
