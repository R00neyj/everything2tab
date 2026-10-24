# file-map

everything2tab: 열려 있는 Windows 프로그램 창을 고정 탭 바가 있는 작업 공간 창 하나에 묶는 Electron 앱

## 파일 역할

| 경로 | 프로세스 | 역할 |
| --- | --- | --- |
| `package.json` | - | 진입점(`src/main.js`), 실행 스크립트(`start`, `dist`), electron-builder 설정(NSIS 설치형 + portable, GitHub 배포), 의존성(`koffi`, `electron-updater`) |
| `src/main.js` | 메인 | 앱 본체. 작업 공간 창 생성, 탭 목록(`tabs`) 관리, 외부 창 붙이기·분리·순서 변경, 활성 탭 창을 탭 바 아래 영역에 맞춤(`fitActive`), 주기적 상태 동기화(`poll`), 다른 창 끌어다 놓기(`trackDrop`), 단축키, 그룹 저장·복원, 이름 붙인 작업 공간(프로그램 묶음) CRUD·실행, 설정(테마·자동 복원·자동 업데이트), IPC 핸들러 |
| `src/win32.js` | 메인 | koffi로 만든 Win32 API 바인딩(user32·kernel32·dwmapi). 창 제목·exe 경로 조회, 일반 앱 창 열거, 커서 위치, 보이는 테두리 기준 사각형 계산·맞춤(`fitVisible`), Win11 테두리·둥근 모서리 끄기(`setEmbedded`). HWND는 숫자로 다룸 |
| `src/updater.js` | 메인 | GitHub 릴리스 기반 자동 업데이트. 날짜형 태그(`vYYYY.MM.DD[-beta.N]`)를 직접 비교해 받을 릴리스 선택. 설치형에서만 동작(dev·portable 제외). API: `init`, `setEnabled`, `check`, `install`, `getState` |
| `src/preload.js` | 프리로드 | `contextBridge`로 렌더러에 `ws` 객체 노출. 메인 ↔ 렌더러 IPC 통로 |
| `src/index.html` | 렌더러 | UI 마크업과 CSS. 탭 바(제목 표시줄 겸용), 빈 화면, 창 선택 목록(picker), 설정 패널, 작업 공간 목록 |
| `src/renderer.js` | 렌더러 | UI 로직. 탭 그리기·끌어서 순서 변경/분리, 탭 바 높이를 메인에 보고, 오버레이(picker·settings) 전환, 작업 공간 편집·실행, 실행 중 프로그램으로 작업 공간 만들기, 업데이트 상태 표시 |
| `src/icon.ico` | - | 앱·설치 파일 아이콘 |
| `.github/workflows/release.yml` | CI | 릴리스 빌드·배포 워크플로 |
| `.gitignore` | - | git 제외 목록 |

## 구조 메모

- 외부 프로그램 창은 Electron 안에 들어오는 게 아니라 Win32 API로 위치·크기를 탭 바 아래 영역에 맞춰 겹쳐 놓는 방식. 비활성 탭 창은 숨김
- 오버레이(picker·settings)가 열려 있으면 활성 탭 창을 숨김(`main.js`의 `overlay`)
- 좌표는 물리 픽셀 기준. 렌더러가 `devicePixelRatio`를 곱해 탭 바 높이를 보냄
- 저장 데이터(그룹, 작업 공간, 설정)는 `main.js`에서 JSON 파일로 읽고 씀
