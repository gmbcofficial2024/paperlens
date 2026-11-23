## 다운로드와 설치

- 처음 사용하는 Windows 사용자는 아래 Assets에서 `Install-Update-PaperLens.cmd`와 `install-update-paperlens.ps1`을 같은 폴더에 다운로드한 후 `.cmd`를 실행하세요.
- 처음 설치는 `N`, 기존 배포 폴더 업데이트는 `U`를 선택합니다. 도우미는 최신 공개 Release를 내려받고 체크섬을 검사하며 기존 파일을 백업합니다.
- 신규 설치 기본 위치는 Windows가 지정한 문서(Documents) 폴더 안의 `PaperLens\extension`입니다. AI agent에 작업 폴더를 지정하지 않아도 이 위치를 사용합니다. 업데이트는 Chrome에 이미 등록된 폴더를 그대로 사용하세요.
- 처음에는 Chrome 개발자 모드에서 설치 폴더를 직접 등록해야 합니다. 업데이트 후에는 PaperLens를 다시 로드하고 기사 탭을 새로고침하세요.
- 직접 설치하거나 macOS/Linux를 사용하는 경우 `paperlens-<version>.zip`을 사용하세요. `Source code` 압축 파일은 개발용 소스입니다.
- 자신의 API 키를 입력해야 합니다. Gemini를 선택한 번역·요약·연결 테스트 모델만 `gemini-flash-latest`로 고정되며, 요청에는 선택한 제공자의 API 요금이 발생할 수 있습니다.

`1.2.1`은 Vertex AI·OpenAI·Anthropic 및 Codex/Claude 요약의 최신 AI 모델 목록과 번역문·요약 카드 글꼴/크기 설정을 추가합니다. Vertex AI에 Gemini 4(`gemini-4-carbon`, `gemini-4-neon`, `gemini-4-hydrogen`)를 `gemini-3.8-flash`·`gemini-3.5-flash-lite`와 함께 제공하고, OpenAI를 `gpt-6.2-astra`·`gpt-6.2-sol`·`gpt-6-luna`(Codex 요약 기본값 `gpt-6.2-sol`)로, Anthropic을 `claude-fable-5-2`·`claude-opus-5-5`·`claude-sonnet-5-5`·`claude-haiku-5-5`로 최신화했으며, 모델별 추론/thinking 파라미터와 기존 프리셋 안전 마이그레이션을 반영했습니다. 또한 설정의 **Reading Appearance**에서 한국어 글꼴 프리셋(Pretendard·맑은 고딕·Noto Sans KR·나눔고딕·명조체·원문 글꼴·설치된 로컬 폰트 직접 입력)과 기본 글자 크기(`A-`/`A`/`A+`)를 실시간 미리보기와 함께 지정할 수 있고, 저장 즉시 열린 탭에도 반영됩니다. 기존 제공자·키 설정은 유지되며 Gemini API 배포 모델은 계속 Flash Latest로 고정됩니다. [모델·전환 안내](https://github.com/gmbcofficial2024/paperlens/blob/main/docs/MODELS.md)

[설치·업데이트 안내](https://github.com/gmbcofficial2024/paperlens/blob/main/docs/INSTALL.md) · [사용법](https://github.com/gmbcofficial2024/paperlens#readme) · [변경 사항](https://github.com/gmbcofficial2024/paperlens/blob/main/CHANGELOG.md)

Chrome Web Store 등록 없이 개발자 모드로 사용하는 배포입니다. 파일 갱신 후에도 Chrome에서 다시 로드해야 합니다. 원문 범위는 현재 로드된 HTML을 기준으로 하며, 접근할 수 없는 논문 본문까지 수집한다는 보증은 아닙니다.
