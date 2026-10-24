# everything2tab

열려 있는 Windows 프로그램 창을 탭 바가 있는 작업 공간 창 하나에 묶는 프로그램

## 기능

- **탭으로 묶기**: 다른 프로그램 창을 탭 줄로 끌어다 놓거나, `+` 버튼의 창 목록에서 골라 탭으로 붙임
- **탭 조작**: 탭을 끌어서 순서를 바꾸거나, 탭 줄 밖으로 끌어 다시 독립 창으로 분리함
- **분할 탭**: 탭을 오른쪽 클릭해 "이 탭에 나란히 놓기"로 다른 탭 창을 붙임. 최대 4개(2개 좌우, 3개 왼쪽 + 오른쪽 위아래, 4개 2×2). 창 사이 막대를 끌어 크기를 바꾸고, 두 번 클릭하면 반반이 됨. 같은 메뉴에서 자리 바꾸기·따로 탭으로·분할 모두 해제를 함
- **그룹 복원**: 마지막 탭 묶음을 저장해 두고 다음 실행 때 다시 엶. 설정에서 자동 복원을 켤 수 있음
- **작업 공간**: 함께 실행할 프로그램 묶음에 이름을 붙여 저장하고 한 번에 실행함. `.exe`와 바로 가기(`.lnk`)를 쓸 수 있음
- **테마**: 시스템·라이트·다크. Windows 강조 색을 따름
- **자동 업데이트**: 설치형만 GitHub 릴리스로 업데이트함. portable은 지원하지 않음

## 단축키

작업 공간 창이나 그 안의 프로그램이 앞에 있을 때만 동작함

| 키 | 동작 |
| --- | --- |
| `Ctrl+Alt+PageDown` / `Ctrl+Alt+→` | 다음 탭 |
| `Ctrl+Alt+PageUp` / `Ctrl+Alt+←` | 이전 탭 |
| `Ctrl+Alt+1`~`8` | n번째 탭 |
| `Ctrl+Alt+9` | 마지막 탭 |

## 설치

[Releases](https://github.com/R00neyj/everything2tab/releases)에서 받음

- `everything2tab-<버전>-setup.exe`: 설치형. 자동 업데이트 지원
- `everything2tab-<버전>-portable.exe`: 설치 없이 실행

Windows x64 전용

## 개발

Node.js 22.12 이상과 npm이 필요함

```bash
npm install
npm start        # 개발 실행
npm run dist     # dist/에 설치형·portable 빌드
```

### 릴리스

날짜 태그를 push하면 GitHub Actions가 빌드하고 릴리스를 만듦

```bash
git tag v2026.10.24          # 정식
git tag v2026.10.24-beta.1   # 베타
git push origin <태그>
```

## 문서

- `AGENTS.md`: 구조, 코드 규칙, 주의점
- `file-map.md`: 파일별 역할
