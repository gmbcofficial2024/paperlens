## 다운로드와 설치

- 처음 사용하는 Windows 사용자는 아래 Assets에서 `Install-Update-PaperLens.cmd`와 `install-update-paperlens.ps1`을 같은 폴더에 다운로드한 후 `.cmd`를 실행하세요.
- 처음 설치는 `N`, 기존 배포 폴더 업데이트는 `U`를 선택합니다. 도우미는 최신 공개 Release를 내려받고 체크섬을 검사하며 기존 파일을 백업합니다.
- 처음에는 Chrome 개발자 모드에서 설치 폴더를 직접 등록해야 합니다. 업데이트 후에는 PaperLens를 다시 로드하고 기사 탭을 새로고침하세요.
- 직접 설치하거나 macOS/Linux를 사용하는 경우 `paperlens-<version>.zip`을 사용하세요. `Source code` 압축 파일은 개발용 소스입니다.
- 자신의 API 키를 입력해야 합니다. Gemini를 선택한 번역·요약·연결 테스트 모델만 `gemini-flash-latest`로 고정되며, 요청에는 선택한 제공자의 API 요금이 발생할 수 있습니다.

이 버전은 Gemini 모델만 Flash Latest로 고정하며 다른 API 제공자와 모델 선택을 복원합니다. 기존 API 키는 유지됩니다. `1.1.2`에서 설정을 저장하여 제공자가 Gemini로 바뀌었다면 사용할 제공자를 다시 선택하세요. Codex·Claude 로컬 요약도 별도 설치 후 계속 사용할 수 있습니다. Google은 `latest` 별칭의 실제 모델 버전을 갱신할 수 있습니다.

[설치·업데이트 안내](https://github.com/gmbcofficial2024/paperlens/blob/main/docs/INSTALL.md) · [사용법](https://github.com/gmbcofficial2024/paperlens#readme) · [변경 사항](https://github.com/gmbcofficial2024/paperlens/blob/main/CHANGELOG.md)

Chrome Web Store 등록 없이 개발자 모드로 사용하는 배포입니다. 파일 갱신 후에도 Chrome에서 다시 로드해야 합니다. 원문 범위는 현재 로드된 HTML을 기준으로 하며, 접근할 수 없는 논문 본문까지 수집한다는 보증은 아닙니다.
