# PaperLens 설치와 업데이트

최신 Chrome과 자신의 API 키를 준비하세요. 일반 사용에는 Node, npm, Python, Codex 또는 Claude CLI가 필요하지 않습니다.

## Windows 도우미로 처음 설치하기

1. [최신 Release](https://github.com/gmbcofficial2024/paperlens/releases/latest)에서 `Install-Update-PaperLens.cmd`와 `install-update-paperlens.ps1`을 **같은 폴더**에 다운로드합니다.
2. `.cmd`를 실행하고 `N`을 선택합니다. Windows에 포함된 PowerShell로 최신 공개 Release를 다운로드하며 GitHub 로그인이 필요하지 않습니다.
3. 새 설치의 기본 경로는 Windows의 실제 **문서 폴더 아래 `PaperLens\extension`**입니다. 보통 `%USERPROFILE%\Documents\PaperLens\extension`이며, 문서 폴더가 OneDrive 등 다른 로컬 위치에 있으면 그 위치를 사용합니다. 완료 안내에서 실제 경로를 확인합니다.
4. `chrome://extensions`를 열고 **개발자 모드**를 켭니다. **압축해제된 확장 프로그램을 로드합니다**에서 안내된 `extension` 폴더를 선택합니다.
5. Chrome의 확장 프로그램 메뉴에서 PaperLens를 고정하고 팝업의 **Settings**를 엽니다.

Chrome의 로컬 등록은 처음 한 번 직접 해야 합니다. 도우미는 Chrome 설정이나 브라우저 프로필을 수정하지 않습니다. Windows에서 다운로드한 파일의 보안 경고가 표시되면 출처가 이 공개 저장소의 Release인지 확인하세요. 기관 정책이 스크립트 실행이나 개발자 모드를 막는 경우에는 해당 관리자에게 문의하세요.

직접 지정한 `-InstallDirectory` 경로가 있으면 그 경로를 사용합니다. 기존 설치는 문서 폴더로 이동하지 않고 Chrome에 등록된 기존 폴더를 업데이트합니다. 네트워크 공유나 링크로 연결된 문서 폴더는 도우미가 지원하지 않으므로 별도의 로컬 전용 폴더를 지정하세요.

## ZIP으로 직접 설치하기

도우미를 사용하지 않거나 macOS/Linux를 사용하는 경우:

1. Release의 `paperlens-<version>.zip`을 다운로드합니다. GitHub가 자동 생성한 `Source code` ZIP은 설치용이 아닙니다.
2. ZIP 안의 `paperlens-<version>` 폴더에 들어 있는 파일을 **항상 유지할 전용 폴더**에 풀어 둡니다. 예: `PaperLens/extension`.
3. `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드합니다**를 선택합니다.
4. `manifest.json`이 바로 들어 있는 폴더를 선택합니다. ZIP이나 그 상위 폴더를 선택하지 않습니다.

Chrome은 이 폴더의 파일을 계속 읽습니다. 설치 후 폴더를 삭제하거나 이동하지 마세요. [Chrome 공식 설치 안내](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

## API 키 저장하기

1. [Google AI Studio](https://aistudio.google.com/apikey)에서 Gemini API 키를 발급합니다.
2. **Translation Provider**의 **Google Gemini**에서 **API Key**를 입력합니다. 배포판에서 Gemini 모델은 **Gemini Flash Latest (`gemini-flash-latest`)**로 고정됩니다.
3. **Summary Provider**를 **Google Gemini API**로 설정합니다. **Gemini Summary API Key**를 비워 두면 저장된 번역용 키를 재사용합니다. 다른 키를 원하면 별도로 입력합니다.
4. **Save Settings**를 누릅니다. 저장되지 않은 편집 내용은 페이지에서 사용하지 않습니다.
5. 필요하면 **Test saved API connection**을 누릅니다. 저장된 번역 설정으로 짧은 유료 API 요청을 보냅니다. 별도 요약 제공자의 연결까지 검사하는 버튼은 아닙니다.

각 사용자는 자신의 키를 사용합니다. 키와 설정은 해당 Chrome 프로필과 확장 설치에 저장되며 PaperLens가 프로필 간 동기화하지 않습니다. 모델 사용 가능 여부, 요금, 할당량과 제공자의 보관 정책을 확인하세요. [개인정보 안내](PRIVACY.md)

Gemini를 선택한 번역·API 요약·연결 테스트는 `gemini-flash-latest`를 사용합니다. Gemini 모델 선택만 고정되며, Google은 이 `latest` 별칭이 가리키는 실제 버전을 갱신할 수 있습니다. [Google 모델 별칭 안내](https://ai.google.dev/gemini-api/docs/models#latest)

업데이트 후 기존 Gemini Pro·Lite 선택만 Flash Latest로 전환되며, 다른 제공자의 선택·모델·키는 유지됩니다. `1.1.2`에서 설정을 저장하여 Gemini로 전환되었다면 사용할 제공자를 다시 선택하세요.

다른 번역 제공자, Vertex 요약과 사용자 지정 번역 서버도 배포판에서 설정할 수 있습니다. 사용자 지정 HTTPS 서버는 저장 시 해당 서버의 권한을 요청합니다. Codex/Claude 요약에는 [별도 native host 설치](https://github.com/gmbcofficial2024/paperlens/blob/main/docs/NATIVE_INSTALL.md)가 필요합니다.

## 사용하기

- 영어 기사나 논문 페이지에서 `Alt+T`를 누르면 원문 옆에 번역을 표시합니다. 다시 누르면 숨기고 이후 자동 번역을 일시 정지합니다.
- `Alt+S`를 누르면 현재 수집한 문서로 요약을 한 번 요청합니다. 번역 전에 자동 요약하는 설정은 기본적으로 꺼져 있습니다.
- 활성 번역 중 새 본문이 로드되면 추가 API 요청이 발생할 수 있습니다. 요약의 원문이 바뀌면 갱신 버튼으로 새 요약을 요청할 수 있습니다.
- 요약에서 문서 종류를 수정하고, 원문 범위를 확인하고, 요약을 복사하거나 접을 수 있습니다.
- 설정을 저장한 후에는 기사 탭을 새로고침합니다. 탐색이나 새로고침은 현재 읽기 세션을 종료합니다.

단축키가 다른 확장과 충돌하면 `chrome://extensions/shortcuts`에서 변경하거나 팝업 버튼을 사용하세요. Chrome 내부 페이지와 외부 PDF는 지원하지 않습니다. 원문 범위 안내는 로드된 텍스트의 수집 상태이며, 출판사의 전체 논문이 공개되어 있다는 보증이 아닙니다.

## 기존 설치 업데이트하기

**같은 설치 폴더와 Chrome 프로필을 유지하고 확장을 제거하지 마세요.** 설치 경로가 바뀌면 Chrome이 별도 확장으로 취급하여 기존 설정과 API 키를 다시 입력해야 할 수 있습니다.

Windows 도우미에서는 `U`를 선택하고 **현재 Chrome에 등록된 기존 배포 폴더**를 지정합니다. 도우미는 전용 배포 폴더만 갱신하고 소스 저장소나 개인 파일이 섞인 폴더는 거부합니다. 기존 버전 파일은 같은 위치로 갱신하며 옆에 백업 폴더를 보관합니다.

이미 소스 저장소 루트나 `dist/`를 개발용으로 로드한 경우에는 개발 빌드로 계속 갱신하거나 새 전용 배포 설치를 만드세요. 새 설치에는 API 키와 설정을 다시 입력해야 합니다. 기존 개발용 설치를 새 폴더로 자동 이전하지 않습니다.

직접 ZIP을 업데이트할 때는 새 ZIP 내부 파일로 **기존 설치 폴더의 내용**을 교체합니다. 새 버전 폴더를 별도 확장으로 등록하지 마세요.

파일 갱신 후 `chrome://extensions`에서 PaperLens의 **다시 로드**를 누르고 열려 있는 기사 탭을 새로고침합니다. [Chrome 공식 다시 로드 안내](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload-the-extension)

문제가 있으면 확장을 사용하지 않는 동안 설치 폴더의 내용을 도우미가 남긴 백업 파일로 복원한 후 다시 로드하세요. 백업 폴더 자체를 새 확장으로 로드하면 별도 설치로 취급될 수 있습니다. 확인이 끝난 오래된 백업은 직접 지울 수 있습니다.

## 삭제와 데이터 정리

**Clear Cache**는 로컬 번역 캐시를 지웁니다. 키를 지우려면 각 제공자의 API 키와 별도 요약 키를 비우고 **Save Settings**를 누릅니다. 확장을 제거하면 전체 브라우저 로컬 설정이 제거됩니다. 설치·백업 파일은 별도로 삭제할 수 있습니다. 외부 제공자가 이미 받은 요청이나 로그는 로컬 삭제로 지워지지 않습니다.
