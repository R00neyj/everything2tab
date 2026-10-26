# Repository Guidelines

## Project Overview

everything2tab: Windows 전용 Electron 앱. 열려 있는 외부 프로그램 창을 탭 바가 있는 작업 공간 창(host) 하나에 탭으로 묶음. 파일별 역할 표는 `file-map.md` 참고

## Architecture & Data Flow

- **창 붙이는 방식**: 외부 창을 Electron 안에 넣지 않음. 탭 줄은 HTML(`src/index.html`)이 그림. 외부 창은 Win32로 소유자(owner)를 host로 바꾸고(`setOwner`, GWLP_HWNDPARENT), 탭 줄 아래 영역(`contentRect()`)에 위치·크기를 맞춰 겹쳐 놓음. 소유된 창은 작업 표시줄 버튼이 없으므로 `WS_EX_APPWINDOW`를 붙여(`forceTaskbar`) 버튼을 유지함. 탭 창의 AppUserModelID를 앱 값(`build.appId`)으로 바꿔(`setAppId`) 작업 표시줄에서 host와 한 그룹으로 묶고, 뺄 때 원래 값으로 되돌림. 탭이 있으면 host 버튼은 그룹에서 뺌(`syncHostTaskbar`, 탭이 없거나 최소화된 동안은 다시 보임). 비활성 탭 창은 숨기지 않고 활성화 없이 최소화함(`park`). 숨기면 작업 표시줄 버튼이 사라지고, 화면 밖으로 옮기면 작업 보기(Win+Tab)가 모든 모니터에 띄움. 우리가 최소화한 창은 `parked`에 기억해 두고, 복원이 반영될 때까지 poll의 최소화·위치 검사를 미룸
- **프로세스 구성**
  - `src/main.js`: 상태를 모두 가짐(`tabs[]`, `active`, `overlay`, `restoring`, `workspaces`, `settings`). IPC, 저장 파일, 단축키를 처리함
    - `tabs[]`는 `{panes:[{hwnd,title,exe,icon,minW?,minH?}], ratio:{x,y}, focus}`. 창이 2~4개면 분할 탭(2개 좌우, 3개 왼쪽 + 오른쪽 위아래, 4개 2×2, `COLS`). `active`는 앞에 있는 창 HWND이고, 그 창이 든 탭이 보이는 탭
    - 창 하나를 찾을 때는 `tabOf(hwnd)`, 모든 탭 창은 `panes()`를 씀
  - `src/preload.js`: `contextBridge`로 `window.ws`를 노출함
  - `src/renderer.js`: UI만 그림. 마지막으로 받은 `tabs` 메시지를 `latest`에 보관함
  - `src/win32.js`: koffi로 user32·kernel32·dwmapi를 바인딩함
  - `src/updater.js`: electron-updater 래퍼
- **IPC**
  - 렌더러 → 메인, 응답 없음(`send`): `add`, `activate`, `detach`, `detach-tab`, `detach-drop`, `reorder`, `tab-menu`, `split-ratio`, `overlay`, `bar-height`, `set-setting`, `workspace-update`, `workspace-delete`, `update-*`
  - 렌더러 → 메인, 응답 있음(`invoke`): `list-windows`, `get-settings`, `restore`, `workspace-create`, `workspace-launch`, `pick-programs`, `update-state`
  - 메인 → 렌더러: `tabs`, `bars`(분할 막대 자리), `workspaces`, `drop-hint`, `close-overlay`, `update`
  - 새 채널은 preload의 `ws.*`, `ipcMain`, 렌더러 세 곳을 같이 고침
- **폴링**: `setInterval(poll, 150)`으로 외부 창 쪽 변화를 맞춤
  - 닫힌 창을 탭에서 빼고, 제목 변경을 반영함
  - 단축키를 켜고 끔. host나 탭 창이 앞에 있을 때만 켬
  - 끌어다 놓기를 감지함(`trackDrop`)
  - 탭 창이 최대화·최소화되면 그 상태를 host로 옮김
  - 보이는 탭 창 위치가 1px 넘게 어긋나면 되돌림. 같은 칸에 세 번 맞춰도 더 크게 남는 분할 탭 창은 그 크기를 최소 크기(`minW`·`minH`)로 보고 칸을 넓힘
  - 마우스를 누른 동안 앞에 있는 분할 탭 창의 안쪽 가장자리 크기가 바뀌면 그 크기를 비율로 받아 나머지 창을 따라 맞춤(`followEdge`). 창 사이 틈 대부분을 양옆 창의 보이지 않는 크기 조절 테두리가 덮기 때문
  - 바뀐 게 있으면 `sendTabs()`를 호출함
- **탭 흐름**
  - 탭 추가: `addTab` → `setOwner` + `setEmbedded(true)` → `activate`
  - 탭 활성화: `activate` → `fitTab`(칸은 `layout`, 막대 자리는 `bars`로 렌더러에 보냄) → 보여 주기 → 다른 탭 창 모두 최소화(`park`) → `sendTabs`
  - 탭 해제: `release`·`detach`(창 하나)·`detachTab`(탭째), 종료 시 `releaseAll`
  - 분할: 탭 오른쪽 클릭 메뉴(`tabMenu`, 메인이 그리는 네이티브 메뉴)에서 `join`·`popOut`·`unsplitAll`·`swap`. 창 사이 틈(`GAP`)에 렌더러가 막대(`.divider`)를 그림. 막대를 끄는 동안 렌더러는 막대를 다시 그리지 않음(포인터 캡처 유지)
- **저장 파일**: `app.getPath('userData')` 아래 JSON 파일. 읽기는 `try/catch`로 실패하면 기본값을 씀
  - `workspace.json`: 마지막 탭 그룹 `[{exe,title,split?}]`. `split`(`{x,y}` 비율, 옛 형식은 숫자)이 있으면 앞 항목들과 한 분할 탭으로 복원
  - `workspaces.json`: 이름 붙인 작업 공간 `[{id,name,items:[{exe,title,launch?}]}]`. `id`는 `Date.now().toString(36)`
  - `settings.json`: `{theme, autoRestore, autoUpdate}`. `settingChoices`에 있는 값만 받음

## Key Directories

| 경로 | 용도 |
| --- | --- |
| `src/` | 앱 소스 전부. 빌드에 들어가는 파일은 `src/**/*`와 `package.json` |
| `.github/workflows/` | 태그를 push하면 도는 릴리스 CI(`release.yml`) |
| `dist/` | electron-builder 결과물. git 제외 |

## Development Commands

```bash
npm install          # Node >= 22.12 (electron 45 요구), CI는 Node 24
npm start            # electron . (dev:electron도 같은 명령)
npm run dist         # dist/에 NSIS 설치 파일과 portable exe 생성 (win x64)
```

- 릴리스: `git tag v2026.10.24 && git push origin v2026.10.24`. 베타는 `v2026.10.24-beta.1`
- CI가 앞자리 0을 뺀 semver(`2026.10.24`)로 `npm version`을 실행하고 GitHub Release를 만듦
- `package.json`의 `version`은 CI가 덮어쓰므로 손으로 관리하지 않음
- 로컬 빌드도 릴리스 날짜 버전으로 만듦. 그냥 `npm run dist`를 하면 `package.json`의 `0.1.0`이 파일 이름·앱 버전에 들어감. `package.json`은 고치지 않고 이번 빌드에만 버전을 넣음
  - `npm run dist -- -c.extraMetadata.version=2026.10.27-beta.1`
  - 버전은 태그에서 `v`와 앞자리 0을 뺀 값(CI와 같음)

## Code Conventions & Common Patterns

- **형식**: CommonJS, `require('node:fs')`처럼 `node:` 접두사를 붙임. 들여쓰기 2칸, 작은따옴표, 세미콜론. `const`와 화살표 함수를 주로 쓰고, 한 줄 `if`도 허용함
- **이름**: 식별자는 camelCase. 상수는 UPPER_CASE(`REPO`, `TAG`, Win32 상수)
- **주석·문구**: 주석, UI 문구, 메시지는 한국어. `main.js`는 `// ---- 제목 ----` 구분선으로 섹션을 나눔
- **에러 처리**: 예외를 위로 던지지 않음. `try {} catch {}`로 무시하거나 기본값을 씀. 렌더러는 `alert`/`confirm`을 씀
- **비동기**: `async/await`와 `ipcMain.handle`을 씀. 기다릴 때는 `sleep` 헬퍼를 쓰고, `waitNewWindow`는 300ms 간격으로 최대 15초 기다림
- **DOM**: `el(tag, cls, text)`, `icon(src)` 헬퍼와 `textContent`, `replaceChildren`을 씀. `innerHTML`은 쓰지 않음. CSP 때문에 인라인 스크립트를 쓸 수 없음
- **Win32 바인딩**: `win32.js`의 `api` 객체에 koffi 시그니처 문자열로 선언함. `EnumWindows` 콜백은 `koffi.register` 후 `finally`에서 `unregister`함

## Pitfalls

- **좌표**: 모두 물리 픽셀. 렌더러는 탭 바 높이에 `devicePixelRatio`를 곱해서 `ws.barHeight`로 보냄
- **HWND**: JS number로 다룸. 64비트 값은 `Number()`로 감쌈
- **show/hide 반영 시점**: `ShowWindowAsync`, `SWP_ASYNCWINDOWPOS`를 쓰므로 호출 직후에는 상태가 반영되지 않았을 수 있음
- **오버레이**: HWND는 HTML 위에 그려지지 않음. 그래서 picker·settings를 열면 메인이 활성 창을 최소화하고, 열려 있는 동안 위치 맞춤을 건너뜀
  - 새 오버레이를 추가하려면 렌더러의 `overlays` 맵과 메인의 `overlay` 처리를 같이 고침
- **동시 실행 잠금**: 메인의 `restoring`이 켜져 있으면 `openItems`는 `null`을 반환하고 저장도 하지 않음. 렌더러는 `busy`와 `runBusy`로 한 번에 하나만 열게 함
- **탭 드래그 중 다시 그리기**: 드래그 중 `render()`를 하면 포인터 캡처가 끊기므로 다시 그리지 않음. 탭 활성화는 `pointerup`에서 함
- **패키징된 package.json**: electron-builder가 `build` 항목을 빼므로 설치형에서는 `require('../package.json').build`가 `undefined`임. 앱 ID는 `main.js`의 `APP_ID` 상수에 따로 적어 두었으니 `build.appId`를 바꾸면 함께 고침
- **태그 규칙 위치**: `vYYYY.MM.DD[-beta.N]` 규칙이 세 곳에 있음. 바꿀 때 함께 고침
  - `.github/workflows/release.yml`의 정규식
  - `release.yml` 상단 주석
  - `src/updater.js`의 `TAG`

## Important Files

- `src/main.js`: 진입점(`package.json`의 `main`)
- `src/index.html`: CSS 내장, CSP 설정. 탭 줄이 제목 표시줄을 겸함(`titleBarOverlay` 높이 30, `-webkit-app-region`)
- `package.json`: 스크립트와 electron-builder 설정(`build`). 배포 대상은 `R00neyj/everything2tab`
- `.github/workflows/release.yml`: `windows-latest`에서 `npm ci` → `npm run dist` → `gh release create` 순서로 실행함. 별도 시크릿 없이 `github.token`을 씀
- `file-map.md`: 파일별 역할 표

## Runtime/Tooling Preferences

- npm을 씀(`package-lock.json` lockfileVersion 3, CI는 `npm ci`). yarn·pnpm은 쓰지 않음
- Windows x64 전용. `process.platform` 검사가 없어서 다른 OS에서는 `require('./win32')`에서 실패할 것으로 추정됨 [INFERENCE]
- koffi는 prebuilt 바이너리를 씀. `electron-rebuild` 설정은 없음
- 자동 업데이트는 설치형에서만 동작함. dev 실행과 portable은 `unsupported` 상태임

## Testing & QA

- 테스트, 린트, 포매터, 타입 검사 설정이 없음. CI에도 검사 단계가 없음
- 검증은 직접 실행해서 확인함
  - `npm start`를 실행함
  - 외부 창(예: 메모장)을 탭 줄에 끌어다 놓거나 `+` 버튼(창 선택 목록)으로 붙여 봄
  - 탭 전환·분리·순서 변경, 최대화, DPI가 다른 모니터로 옮기기, 오버레이 열고 닫기를 확인함
- 패키징이나 업데이트를 바꿨다면 `npm run dist`로 만든 설치형을 실행해 확인함. 업데이트 확인에는 GitHub Release의 `latest.yml`이 필요함
