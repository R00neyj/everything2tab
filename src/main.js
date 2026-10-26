const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain, Menu, globalShortcut, nativeImage, nativeTheme, systemPreferences, dialog, shell } = require('electron');
const w32 = require('./win32');
const updater = require('./updater');

// 작업 표시줄 그룹 기준. 작업 공간 창과 탭 안 창에 같은 값을 줘서 한 그룹으로 묶음. 설치형 바로 가기의 값(package.json의 build.appId)과 같게 둠
// package.json에서 읽지 않음: electron-builder가 패키징할 때 build 항목을 빼서 설치형에서는 없음
const APP_ID = 'com.r00neyj.everything2tab';

let win;
let host = 0; // 작업 공간 창 HWND
let barHeight = 40; // 탭 바 높이 (물리 픽셀, 렌더러가 알려 줌)
let overlay = null; // 탭 줄 아래를 덮은 화면: null | 'picker' | 'settings'. 덮는 동안 활성 탭 창은 숨김
let restoring = false;
// 탭 하나에 창 하나, 또는 창 2~4개(분할 탭). ratio: { x: 왼쪽 열 비율, y: 위 칸 비율 }, focus: 그 탭에서 마지막으로 앞에 둔 창
const tabs = []; // [{ panes: [{ hwnd, title, exe, icon, minW?, minH? }], ratio, focus }]
let active = 0; // 앞에 있는(키 입력을 받는) 탭 창 HWND. 그 창이 든 탭이 보이는 탭
const icons = new Map(); // exe 경로 → data URL
let saveFile;
let saved = []; // 마지막으로 저장한 그룹 [{ exe, title }]
const origPlacement = new Map(); // hwnd -> 탭에 넣기 전 w32.getPlacement 결과 { maximized, normal }

function contentRect() {
  const c = w32.clientRectOnScreen(host);
  return { x: c.x, y: c.y + barHeight, w: c.w, h: Math.max(0, c.h - barHeight) };
}

const inside = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

const panes = () => tabs.flatMap((t) => t.panes);
const tabOf = (hwnd) => tabs.find((t) => t.panes.some((p) => p.hwnd === hwnd));

const GAP = 8; // 분할 탭의 창 사이 틈(물리 픽셀). 렌더러가 이 자리에 크기 조절 막대를 그림
const MAX_PANES = 4;
const clampRatio = (r) => (Number.isFinite(r) ? Math.min(0.85, Math.max(0.15, r)) : 0.5);
// 창 수별 열 구성(열마다 위→아래 칸 번호). 2개 좌우, 3개 왼쪽 전체 + 오른쪽 위아래, 4개 2×2
const COLS = { 1: [[0]], 2: [[0], [1]], 3: [[0], [1, 2]], 4: [[0, 2], [1, 3]] };

// 탭의 창마다 차지할 사각형(rects)과 막대 자리(bars, 작업 영역 기준 좌표)
// 열 너비는 ratio.x, 위아래로 나뉜 열의 위 칸 높이는 ratio.y. 창의 최소 크기(minW·minH, poll이 알아냄)만큼은 칸을 넓혀 줌
function layout(t) {
  const c = contentRect();
  const cols = COLS[t.panes.length];
  if (cols.length < 2) return { rects: [c], bars: [] };
  const most = (ids, k) => Math.max(0, ...ids.map((i) => t.panes[i][k] || 0));
  let lw = Math.round((c.w - GAP) * t.ratio.x);
  lw = Math.max(Math.min(lw, c.w - GAP - most(cols[1], 'minW')), most(cols[0], 'minW'));
  const xs = [{ x: c.x, w: lw }, { x: c.x + lw + GAP, w: c.w - lw - GAP }];
  const split = cols.filter((col) => col.length > 1);
  let th = Math.round((c.h - GAP) * t.ratio.y);
  th = Math.max(Math.min(th, c.h - GAP - most(split.map((col) => col[1]), 'minH')), most(split.map((col) => col[0]), 'minH'));
  const rects = [];
  cols.forEach((col, k) => col.forEach((i, row) => {
    const { x, w } = xs[k];
    if (col.length < 2) rects[i] = { x, y: c.y, w, h: c.h };
    else rects[i] = row ? { x, y: c.y + th + GAP, w, h: c.h - th - GAP } : { x, y: c.y, w, h: th };
  }));
  const bars = [{ axis: 'x', x: lw, y: 0, w: GAP, h: c.h }];
  if (split.length === 2) bars.push({ axis: 'y', x: 0, y: th, w: c.w, h: GAP });
  else if (split.length) bars.push({ axis: 'y', x: xs[1].x - c.x, y: th, w: xs[1].w, h: GAP });
  return { rects, bars };
}

// 보이는 탭을 맞춤. 막대 자리는 렌더러에 알림
function fitTab(t) {
  const { rects, bars } = layout(t);
  // 오버레이가 열려 있으면 창은 최소화해 둔 채로. 복원 중인(아직 최소화된) 창은 테두리 크기를 잴 수 없으므로 복원 뒤 poll이 맞춤
  if (!overlay) rects.forEach((r, i) => { if (!w32.api.IsIconic(t.panes[i].hwnd)) w32.fitVisible(t.panes[i].hwnd, r); });
  win.webContents.send('bars', { gap: GAP, bars });
}

function fitActive() {
  const t = tabOf(active);
  if (!t || overlay || win.isMinimized()) return;
  fitTab(t);
}

// ---- 그룹 저장·복원 ----

function loadSaved() {
  try {
    saved = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
  } catch {
    saved = [];
  }
}

function save() {
  // 빈 목록은 저장하지 않음: 시작 직후나 탭을 다 뺐을 때 "이전 작업 공간"이 지워지지 않게
  if (restoring || !tabs.length) return;
  // 분할 탭의 둘째 창부터 split(비율 { x, y })을 달아 저장: 복원할 때 앞 창들과 다시 한 탭으로 묶음
  saved = tabs.flatMap((t) => t.panes.filter((p) => p.exe)
    .map((p, k) => (k ? { exe: p.exe, title: p.title, split: { ...t.ratio } } : { exe: p.exe, title: p.title })));
  fs.writeFileSync(saveFile, JSON.stringify(saved, null, 2));
}

function sendTabs() {
  if (!win || win.isDestroyed()) return;
  save();
  const cur = tabOf(active);
  const pane = (p) => ({ hwnd: p.hwnd, title: p.title, exe: p.exe, icon: p.icon, active: p.hwnd === active });
  win.webContents.send('tabs', {
    tabs: tabs.map((t) => ({ panes: t.panes.map(pane), active: t === cur })),
    saved: tabs.length ? 0 : saved.length,
  });
  const title = cur?.panes.find((p) => p.hwnd === active)?.title;
  win.setTitle(title ? `${title} - everything2tab` : 'everything2tab');
  syncHostTaskbar();
}

// 탭 창 버튼이 있으면 작업 공간 창 버튼은 작업 표시줄 그룹에서 뺌
// 탭이 없을 때와 최소화된 동안(소유된 탭 창도 같이 숨겨져 버튼이 사라짐)에는 다시 보여 줌
let hostSkipped = false;
function syncHostTaskbar() {
  const skip = tabs.length > 0 && !win.isMinimized();
  if (skip === hostSkipped) return;
  hostSkipped = skip;
  win.setSkipTaskbar(skip);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 같은 exe의 새 창이 뜰 때까지 기다림
async function waitNewWindow(exe, before, ms = 15000) {
  for (let t = 0; t < ms; t += 300) {
    await sleep(300);
    const found = w32.listAppWindows(before).find((x) => x.exe.toLowerCase() === exe.toLowerCase());
    if (found) return found.hwnd;
  }
  return 0;
}

// 항목마다: 열려 있는 같은 프로그램 창(제목이 같으면 우선)을 쓰고, 없으면 실행해서 기다림
// items: [{ exe, title, launch?, split? }]. launch는 바로 가기(.lnk) 경로: 인수·작업 폴더까지 바로 가기 그대로 실행
// split({ x, y } 비율)이 있으면 앞 항목들과 한 분할 탭으로 묶음
// 반환: 탭으로 넣지 못한 프로그램 이름 목록. 이미 다른 묶음을 여는 중이면 null
async function openItems(items) {
  if (restoring) return null;
  restoring = true;
  const failed = [];
  let head = 0; // 지금 묶고 있는 분할 탭의 첫 창. split 항목은 이 창의 탭에 붙임
  try {
    for (const item of items) {
      const taken = new Set([host, ...panes().map((p) => p.hwnd)]);
      const open = w32.listAppWindows(taken).filter((x) => x.exe.toLowerCase() === item.exe.toLowerCase());
      let hwnd = (open.find((x) => x.title === item.title) || open[0] || {}).hwnd || 0;
      const launchable = item.launch ? fs.existsSync(item.launch) : fs.existsSync(item.exe);
      if (!hwnd && launchable) {
        const before = new Set(w32.listAppWindows(new Set()).map((x) => x.hwnd));
        if (item.launch) shell.openPath(item.launch);
        else spawn(item.exe, [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
        hwnd = await waitNewWindow(item.exe, before);
      }
      const ratio = typeof item.split === 'number' ? { x: item.split, y: 0.5 } : item.split; // 숫자는 좌우 2칸 시절 형식
      if (hwnd) {
        await addTab(hwnd);
        if (ratio && head) join(head, hwnd, ratio);
        else head = hwnd;
      } else {
        failed.push(path.basename(item.launch || item.exe));
        if (!ratio) head = 0;
      }
    }
  } finally {
    restoring = false;
  }
  sendTabs();
  return failed;
}

const restore = () => openItems(saved.slice());

// ---- 이름 붙인 작업 공간: 함께 실행할 프로그램 묶음 ----

let workspacesFile;
let workspaces = []; // [{ id, name, items: [{ exe, title, launch? }] }]

const str = (v) => (typeof v === 'string' ? v : '');
const cleanItems = (items) => (Array.isArray(items) ? items : [])
  .filter((it) => it && str(it.exe))
  .map((it) => (str(it.launch) ? { exe: it.exe, title: str(it.title), launch: it.launch } : { exe: it.exe, title: str(it.title) }));

function loadWorkspaces() {
  try {
    const list = JSON.parse(fs.readFileSync(workspacesFile, 'utf8'));
    workspaces = list.filter((w) => w && str(w.id)).map((w) => ({ id: w.id, name: str(w.name), items: cleanItems(w.items) }));
  } catch {
    workspaces = [];
  }
}

async function sendWorkspaces() {
  if (!win || win.isDestroyed()) return;
  const list = await Promise.all(workspaces.map(async (w) => ({
    ...w,
    items: await Promise.all(w.items.map(async (it) => ({ ...it, icon: await iconFor(it.exe) }))),
  })));
  win.webContents.send('workspaces', list);
}

function writeWorkspaces() {
  fs.writeFileSync(workspacesFile, JSON.stringify(workspaces, null, 2));
  sendWorkspaces();
}

function createWorkspace(name, items) {
  const id = Date.now().toString(36);
  workspaces.push({ id, name: str(name).trim() || `작업 공간 ${workspaces.length + 1}`, items: cleanItems(items) });
  writeWorkspaces();
  return id;
}

function updateWorkspace(id, patch) {
  const w = workspaces.find((x) => x.id === id);
  if (!w || !patch) return;
  if (typeof patch.name === 'string' && patch.name.trim()) w.name = patch.name.trim();
  if (patch.items) w.items = cleanItems(patch.items);
  writeWorkspaces();
}

function deleteWorkspace(id) {
  workspaces = workspaces.filter((x) => x.id !== id);
  writeWorkspaces();
}

async function launchWorkspace(id) {
  const w = workspaces.find((x) => x.id === id);
  return w ? openItems(w.items) : [];
}

// 파일 고르기: .exe는 그대로, 바로 가기(.lnk)는 대상 exe를 읽어 두고 실행은 바로 가기로 함
async function pickPrograms() {
  const r = await dialog.showOpenDialog(win, {
    title: '작업 공간에 넣을 프로그램',
    defaultPath: path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    filters: [{ name: '프로그램, 바로 가기', extensions: ['exe', 'lnk'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return { items: [], skipped: [] };
  const items = [], skipped = [];
  for (const p of r.filePaths) {
    if (p.toLowerCase().endsWith('.exe')) { items.push({ exe: p, title: '' }); continue; }
    let target = '';
    try { target = shell.readShortcutLink(p).target; } catch {}
    if (target.toLowerCase().endsWith('.exe')) items.push({ exe: target, title: '', launch: p });
    else skipped.push(path.basename(p));
  }
  return { items, skipped };
}

// ---- 탭 조작 ----

// 창에 지정된 아이콘의 data URL. 없으면 ''
function windowIconUrl(hwnd) {
  const ic = w32.windowIcon(hwnd);
  if (!ic) return '';
  try { return nativeImage.createFromBitmap(ic.bgra, { width: ic.width, height: ic.height }).toDataURL(); } catch { return ''; }
}

// hwnd가 있으면 창 아이콘을 먼저 씀(같은 chrome.exe로 도는 PWA마다 아이콘이 다름). 없으면 exe 아이콘
async function iconFor(exe, hwnd) {
  const own = hwnd ? windowIconUrl(hwnd) : '';
  if (own) return own;
  if (!exe) return '';
  if (!icons.has(exe)) {
    try {
      icons.set(exe, (await app.getFileIcon(exe, { size: 'small' })).toDataURL());
    } catch {
      icons.set(exe, '');
    }
  }
  return icons.get(exe);
}

// 우리가 최소화해 둔 탭 창. 복원이 끝나기 전의 최소화 상태를 프로그램의 최소화 버튼으로 오해하지 않으려고 기억함
const parked = new Set();
function park(hwnd) {
  parked.add(hwnd);
  w32.park(hwnd);
}

// hwnd가 든 탭을 보여 주고 hwnd를 앞에 둠. 분할 탭이면 두 창을 함께 보여 줌
function activate(hwnd) {
  const t = tabOf(hwnd);
  if (!t) return;
  active = hwnd;
  t.focus = hwnd;
  // 최소화가 아직 반영되지 않은 창(parked)도 복원 요청: 비동기라 요청한 순서대로 처리됨. 오버레이가 열려 있으면 최소화해 둔 채로
  for (const p of t.panes) {
    if (w32.api.IsZoomed(p.hwnd) || (!overlay && (w32.api.IsIconic(p.hwnd) || parked.has(p.hwnd)))) w32.restore(p.hwnd);
  }
  fitTab(t);
  if (overlay) for (const p of t.panes) park(p.hwnd);
  else for (const p of t.panes) (p.hwnd === hwnd ? w32.showActivate : w32.show)(p.hwnd);
  // 다른 탭 창은 모두 최소화: 숨기면 작업 표시줄 버튼이 사라짐. 분할을 풀거나 합쳐서 창이 다른 탭으로 옮겨 간 경우도 함께 처리
  for (const o of tabs) if (o !== t) for (const p of o.panes) park(p.hwnd);
  w32.api.SetForegroundWindow(hwnd);
  sendTabs();
}

function activateOffset(d) {
  if (!tabs.length) return;
  const i = Math.max(0, tabs.indexOf(tabOf(active)));
  activate(tabs[(i + d + tabs.length) % tabs.length].focus);
}

async function addTab(hwnd) {
  if (tabOf(hwnd) || hwnd === host || !w32.api.IsWindow(hwnd)) return;
  origPlacement.set(hwnd, w32.getPlacement(hwnd)); // activate가 최소화·최대화를 풀기 전에 저장해야 함
  const exe = w32.getExePath(hwnd);
  tabs.push({ panes: [{ hwnd, title: w32.getTitle(hwnd), exe, icon: await iconFor(exe, hwnd) }], ratio: { x: 0.5, y: 0.5 }, focus: hwnd });
  // 소유자를 작업 공간 창으로: 항상 그 위에 그려지고 최소화·복원을 같이 따라감
  w32.setOwner(hwnd, host);
  w32.forceTaskbar(hwnd, true); // 소유된 창도 작업 표시줄 버튼은 그대로
  w32.setAppId(hwnd, APP_ID); // 작업 표시줄에서 작업 공간 창과 한 그룹으로
  w32.setEmbedded(hwnd, true);
  w32.refreshTaskbar(hwnd);
  activate(hwnd);
}

// ---- 분할 탭: 창 2~4개를 한 탭에 나란히 (2개 좌우, 3개 왼쪽 + 오른쪽 위아래, 4개 2×2) ----

// b 창을 a 창 탭의 다음 칸으로 옮김. b는 혼자 있는 탭이어야 하고, a 탭은 4칸 미만이어야 함
// ratio: 복원할 때 쓰는 { x, y }. 없으면 지금 비율 유지
function join(a, b, ratio) {
  const ta = tabOf(a), tb = tabOf(b);
  if (!ta || !tb || ta === tb || ta.panes.length >= MAX_PANES || tb.panes.length > 1) return;
  tabs.splice(tabs.indexOf(tb), 1);
  ta.panes.push(tb.panes[0]);
  if (ratio) ta.ratio = { x: clampRatio(ratio.x), y: clampRatio(ratio.y) };
  activate(b);
}

// hwnd 창 하나만 바로 뒤의 새 탭으로 떼어 냄. 원래 탭을 계속 보여 줌
function popOut(hwnd) {
  const t = tabOf(hwnd);
  if (!t || t.panes.length < 2) return;
  const [p] = t.panes.splice(t.panes.findIndex((x) => x.hwnd === hwnd), 1);
  tabs.splice(tabs.indexOf(t) + 1, 0, { panes: [p], ratio: { x: 0.5, y: 0.5 }, focus: p.hwnd });
  if (t.focus === hwnd) t.focus = t.panes[0].hwnd;
  activate(t.focus);
}

// 모든 창을 각자 탭으로. 순서는 칸 순서대로 원래 탭 뒤에
function unsplitAll(hwnd) {
  const t = tabOf(hwnd);
  if (!t || t.panes.length < 2) return;
  const rest = t.panes.splice(1);
  tabs.splice(tabs.indexOf(t) + 1, 0, ...rest.map((p) => ({ panes: [p], ratio: { x: 0.5, y: 0.5 }, focus: p.hwnd })));
  t.focus = t.panes[0].hwnd;
  activate(hwnd);
}

function swap(a, b) {
  const t = tabOf(a);
  if (!t || t !== tabOf(b)) return;
  const i = t.panes.findIndex((p) => p.hwnd === a), j = t.panes.findIndex((p) => p.hwnd === b);
  [t.panes[i], t.panes[j]] = [t.panes[j], t.panes[i]];
  activate(a);
}

// 렌더러가 막대를 끄는 동안 계속 부름. axis: 'x'(세로 막대, 열 너비) | 'y'(가로 막대, 줄 높이). done이면 놓은 것: 렌더러에 알리고 저장
function setRatio(hwnd, axis, ratio, done) {
  const t = tabOf(hwnd);
  if (!t || t.panes.length < 2 || (axis !== 'x' && axis !== 'y')) return;
  t.ratio[axis] = clampRatio(ratio);
  if (t === tabOf(active)) fitActive();
  if (!done) return;
  if (active) w32.api.SetForegroundWindow(active);
  sendTabs();
}

// 탭 줄에서 탭(칸)을 오른쪽 클릭했을 때 메뉴. 메뉴는 OS가 그려서 탭 창 위에도 보임
function tabMenu(hwnd) {
  const t = tabOf(hwnd);
  if (!t) return;
  const label = (p) => (p.title || path.basename(p.exe) || '(제목 없음)').replaceAll('&', '&&');
  const n = t.panes.length;
  const items = [];
  if (n < MAX_PANES) {
    const others = tabs.filter((o) => o !== t && o.panes.length === 1).map((o) => o.panes[0]);
    items.push(others.length
      ? { label: '이 탭에 나란히 놓기', submenu: others.map((p) => ({ label: label(p), click: () => join(hwnd, p.hwnd) })) }
      : { label: '이 탭에 나란히 놓기 (놓을 다른 탭 없음)', enabled: false });
  }
  if (n > 1) {
    items.push(
      { label: '자리 바꾸기', submenu: t.panes.filter((p) => p.hwnd !== hwnd).map((p) => ({ label: label(p), click: () => swap(hwnd, p.hwnd) })) },
      { label: '이 창을 따로 탭으로', click: () => popOut(hwnd) },
      { label: '분할 모두 해제', click: () => unsplitAll(hwnd) },
      { type: 'separator' },
      { label: '이 창만 탭에서 빼기', click: () => detach(hwnd) },
      { label: `탭에서 빼기 (창 ${n}개 모두)`, click: () => detachTab(hwnd) },
    );
  } else {
    items.push({ type: 'separator' }, { label: '탭에서 빼기', click: () => detachTab(hwnd) });
  }
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ---- 탭에서 빼기 ----

// 탭에서 빼서 원래 독립 창으로 되돌림
function release(hwnd) {
  if (parked.delete(hwnd) || w32.api.IsIconic(hwnd)) w32.restore(hwnd); // 최소화해 둔 뒤쪽 탭 창
  w32.setOwner(hwnd, 0);
  w32.forceTaskbar(hwnd, false);
  w32.setAppId(hwnd, null);
  w32.setEmbedded(hwnd, false);
  // 보이는 채로 소유자만 바꾸면 셸이 작업 표시줄 버튼을 다시 만들지 않으므로 숨겼다 다시 보여 줌
  w32.refreshTaskbar(hwnd);
}

// 창을 탭 목록에서만 뺌. 분할 탭이면 남은 창이 그 탭을 혼자 차지함
// 반환: 보이던 탭에서 뺐으면 이어서 보여 줄 창, 아니면 0
function unlist(hwnd) {
  const t = tabOf(hwnd);
  if (!t) return 0;
  const shown = t === tabOf(active);
  const i = tabs.indexOf(t);
  t.panes = t.panes.filter((p) => p.hwnd !== hwnd);
  if (t.panes.length) t.focus = t.panes[0].hwnd;
  else tabs.splice(i, 1);
  if (active === hwnd) active = 0;
  if (!shown) return 0;
  const next = t.panes.length ? t : tabs[Math.min(i, tabs.length - 1)];
  return next ? next.focus : 0;
}

// r: 탭 안에서 차지하던 칸. at: 왼쪽 위를 둘 화면 좌표. 없으면 그 칸 안쪽으로 살짝 비켜 놓음
function setFree(hwnd, r, at) {
  if (!w32.api.IsWindow(hwnd)) return;
  release(hwnd);
  const o = origPlacement.get(hwnd);
  origPlacement.delete(hwnd);
  const fit = (t) => {
    // 최소화해 둔 뒤쪽 탭 창은 먼저 그 자리로 복원(동기)해야 테두리 크기를 잴 수 있음
    if (w32.api.IsIconic(hwnd)) w32.setPlacement(hwnd, { maximized: false, normal: t });
    w32.fitVisible(hwnd, t);
  };
  if (o && !at) w32.setPlacement(hwnd, o); // 탭에 넣기 전 위치·크기·최대화 여부 그대로
  else if (o) fit({ x: at.x, y: at.y, w: o.normal.w, h: o.normal.h }); // 놓은 자리에 원래 크기
  else {
    const p = at || { x: r.x + 40, y: r.y + 40 };
    fit({ x: p.x, y: p.y, w: Math.round(r.w * 0.8), h: Math.round(r.h * 0.8) });
  }
  w32.api.SetForegroundWindow(hwnd);
}

// 창 하나만 뺌. 분할 탭이면 남은 창이 탭을 차지함
function detach(hwnd, at) {
  const t = tabOf(hwnd);
  if (!t) return;
  const r = layout(t).rects[t.panes.findIndex((p) => p.hwnd === hwnd)];
  const next = unlist(hwnd);
  setFree(hwnd, r, at);
  if (next) activate(next);
  sendTabs();
}

// 탭째로 뺌. 분할 탭이면 두 창이 각자 있던 칸 근처에 놓임
function detachTab(hwnd) {
  const t = tabOf(hwnd);
  if (!t) return;
  const { rects } = layout(t);
  const shown = t === tabOf(active);
  const i = tabs.indexOf(t);
  tabs.splice(i, 1);
  if (shown) active = 0;
  t.panes.forEach((p, k) => setFree(p.hwnd, rects[k]));
  const next = shown && tabs[Math.min(i, tabs.length - 1)];
  if (next) activate(next.focus);
  sendTabs();
}

// hwnd가 든 탭을 to번째 자리로
function reorder(hwnd, to) {
  const t = tabOf(hwnd);
  if (!t) return;
  tabs.splice(tabs.indexOf(t), 1);
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, t);
  sendTabs();
}

// ---- 단축키: 작업 공간이나 그 안의 프로그램이 앞에 있을 때만 등록 ----

const shortcuts = {
  'Control+Alt+PageDown': () => activateOffset(1),
  'Control+Alt+PageUp': () => activateOffset(-1),
  'Control+Alt+Right': () => activateOffset(1),
  'Control+Alt+Left': () => activateOffset(-1),
};
for (let n = 1; n <= 9; n++) {
  shortcuts[`Control+Alt+${n}`] = () => { const t = n === 9 ? tabs.at(-1) : tabs[n - 1]; if (t) activate(t.focus); };
}
let shortcutsOn = false;

function setShortcuts(on) {
  if (on === shortcutsOn) return;
  shortcutsOn = on;
  if (!on) return globalShortcut.unregisterAll();
  for (const [key, fn] of Object.entries(shortcuts)) {
    if (!globalShortcut.register(key, fn)) console.warn(`단축키 등록 실패 (다른 프로그램이 사용 중): ${key}`);
  }
}

// ---- 다른 창을 끌어다 놓기: 평소엔 탭 줄, 창 선택 목록을 열었거나 탭이 없을 땐 창 전체가 놓을 자리 ----

let drag = null; // { hwnd, start, last } 마우스를 누른 동안 앞에 있던 일반 창. start: 누른 시점 위치, last: 직전 틱 위치·크기
let dropHint = false; // false | 'bar' | 'window'
const DROP_REACH = 2; // 탭 줄에 놓을 자리를 탭 줄 아래로 탭 줄 높이의 몇 배만큼 더 넓힐지. 보이는 탭 줄 크기는 그대로

// 탭 줄 + 그 아래 DROP_REACH만큼. 탭 창 영역을 넘지 않음
function barDropRect() {
  const c = w32.clientRectOnScreen(host);
  return { x: c.x, y: c.y, w: c.w, h: Math.min(c.h, barHeight * (1 + DROP_REACH)) };
}

function setDropHint(zone) {
  if (zone === dropHint) return;
  dropHint = zone;
  win.webContents.send('drop-hint', zone);
}

function trackDrop(fg) {
  const down = w32.mouseDown();
  if (down && !drag && fg && fg !== host && !tabOf(fg) && w32.isAppWindow(fg)) {
    drag = { hwnd: fg, start: w32.visibleRect(fg), last: null };
  }
  if (!drag) return;
  const r = w32.visibleRect(drag.hwnd);
  const moved = r.x !== drag.start.x || r.y !== drag.start.y;
  // 끄는 초반의 복원(최대화 창)은 정상 드래그임. 떼는 틱에서 직전 틱과 크기가 다르거나 최대화 상태면(버튼·더블클릭·Aero Snap) 탭에 넣지 않음
  const resized = drag.last && (r.w !== drag.last.w || r.h !== drag.last.h);
  drag.last = r;
  const whole = overlay === 'picker' || !tabs.length;
  const zone = whole ? 'window' : 'bar';
  const area = whole ? w32.clientRectOnScreen(host) : barDropRect();
  const over = moved && !resized && !w32.api.IsZoomed(drag.hwnd) && !win.isMinimized() && inside(w32.cursorPos(), area) ? zone : false;
  if (down) return setDropHint(over);
  setDropHint(false);
  const hwnd = drag.hwnd;
  drag = null;
  if (!over) return;
  // 목록에서 고른 것과 같게: 덮은 화면을 닫고 넣은 창을 보여 줌
  if (overlay) win.webContents.send('close-overlay');
  addTab(hwnd);
}

// ---- 프로그램 쪽에서 일어난 변화(닫힘, 제목 변경, 끌어서 옮김, 최대화)를 주기적으로 맞춤 ----

function poll() {
  if (!win || win.isDestroyed()) return;
  let changed = false;
  for (const p of panes()) {
    if (!w32.api.IsWindow(p.hwnd)) {
      parked.delete(p.hwnd);
      const next = unlist(p.hwnd);
      if (next) activate(next);
      changed = true;
      continue;
    }
    const title = w32.getTitle(p.hwnd);
    if (title !== p.title) {
      p.title = title;
      // 막 뜬 PWA는 창 아이콘을 늦게 지정하므로 제목이 바뀔 때 다시 읽음
      const own = windowIconUrl(p.hwnd);
      if (own) p.icon = own;
      changed = true;
    }
  }
  const fg = w32.api.GetForegroundWindow();
  setShortcuts(fg === host || !!tabOf(fg));
  trackDrop(fg);
  // 숨겨 둔 탭이 다른 경로(작업 표시줄 등)로 앞에 나오면 그 탭으로 전환. 분할 탭에서 다른 쪽 창을 누른 경우도 여기서 앞 창을 바꿈
  if (fg && fg !== active && tabOf(fg)) {
    if (overlay) win.webContents.send('close-overlay'); // 열린 목록·설정은 닫고 그 탭을 보여 줌
    activate(fg);
  }

  const t = tabOf(active);
  // 우리가 최소화해 둔 창은 복원이 반영될 때까지 아래 검사(최소화 버튼, 위치 맞춤)를 미룸
  if (t && !overlay) for (const p of t.panes) if (parked.has(p.hwnd) && !w32.api.IsIconic(p.hwnd)) parked.delete(p.hwnd);
  if (t && !overlay && !win.isMinimized() && !t.panes.some((p) => parked.has(p.hwnd))) {
    const zoomed = t.panes.find((p) => w32.api.IsZoomed(p.hwnd));
    const iconic = t.panes.find((p) => w32.api.IsIconic(p.hwnd));
    if (zoomed) {
      // 프로그램의 최대화 버튼 → 작업 공간을 최대화
      w32.restore(zoomed.hwnd);
      win.maximize();
    } else if (iconic) {
      // 프로그램의 최소화 버튼 → 작업 공간을 최소화
      w32.restore(iconic.hwnd);
      win.minimize();
    } else if (w32.mouseDown()) {
      followEdge(t, fg);
    } else {
      downSize = null;
      if (edgeDrag) {
        edgeDrag = false;
        changed = true; // 바뀐 비율 저장, 렌더러에 알림
      }
      // 제목 표시줄로 끌어서 옮겼거나 크기를 바꿨으면, 마우스를 놓은 뒤 제자리로
      let minChanged = false;
      layout(t).rects.forEach((c, i) => {
        const p = t.panes[i];
        const v = w32.visibleRect(p.hwnd);
        if (Math.abs(v.x - c.x) <= 1 && Math.abs(v.y - c.y) <= 1 && Math.abs(v.w - c.w) <= 1 && Math.abs(v.h - c.h) <= 1) {
          p.miss = null;
          return;
        }
        // 같은 칸에 거듭 맞춰도 더 넓게 남으면 프로그램의 최소 너비로 봄. 분할 탭은 그만큼 칸을 넓혀 겹치지 않게 함
        const key = `${c.x},${c.y},${c.w},${c.h}`;
        p.miss = p.miss?.key === key ? { key, n: p.miss.n + 1 } : { key, n: 1 };
        if (t.panes.length > 1 && p.miss.n >= 3 && (v.w > c.w + 1 || v.h > c.h + 1)) {
          if (v.w > c.w + 1) p.minW = v.w;
          if (v.h > c.h + 1) p.minH = v.h;
          minChanged = true;
        }
        w32.fitVisible(p.hwnd, c);
      });
      if (minChanged) {
        fitTab(t);
        changed = true;
      }
    }
  }
  if (changed) sendTabs();
}

// 분할 탭 창의 안쪽 가장자리를 끌어 크기를 바꾸는 중이면, 그 크기를 비율로 받아 나머지 창을 따라 맞춤
// 창 사이 틈은 좁고 양옆 창의 보이지 않는 크기 조절 테두리가 틈을 거의 덮어서, 렌더러 막대보다 이쪽에 잡히는 경우가 많음
// 바깥 가장자리나 제목 표시줄로 옮긴 것은 무시: 마우스를 놓으면 poll이 제자리로 되돌림
let edgeDrag = false;
let downSize = null; // 마우스를 누를 때 앞에 있던 탭 창의 크기 { hwnd, w, h }. 그 뒤에 바뀐 것만 끌기로 봄
function followEdge(t, fg) {
  if (t.panes.length < 2) return;
  // 끄는 창은 누르는 순간 앞으로 옴. 렌더러 막대를 끄는 중이면 host가 앞이라 여기서는 건드리지 않음
  const i = t.panes.findIndex((p) => p.hwnd === fg);
  if (i < 0) return;
  const p = t.panes[i], v = w32.visibleRect(p.hwnd);
  if (downSize?.hwnd !== p.hwnd) downSize = { hwnd: p.hwnd, w: v.w, h: v.h };
  if (v.w === downSize.w && v.h === downSize.h) return;
  const c = contentRect();
  const r = layout(t).rects[i];
  const cols = COLS[t.panes.length];
  const near = (a, b) => Math.abs(a - b) <= 1;
  const left = cols[0].includes(i);
  const col = cols[left ? 0 : 1];
  let moved = false;
  if (!near(v.w, r.w)) {
    // 왼쪽 열은 오른쪽 가장자리, 오른쪽 열은 왼쪽 가장자리가 안쪽
    if (left && near(v.x, r.x)) { t.ratio.x = clampRatio(v.w / (c.w - GAP)); moved = true; }
    if (!left && near(v.x + v.w, r.x + r.w)) { t.ratio.x = clampRatio((v.x - c.x - GAP) / (c.w - GAP)); moved = true; }
  }
  if (!near(v.h, r.h) && col.length > 1) {
    // 위 칸은 아래 가장자리, 아래 칸은 위 가장자리가 안쪽
    if (col[0] === i && near(v.y, r.y)) { t.ratio.y = clampRatio(v.h / (c.h - GAP)); moved = true; }
    if (col[1] === i && near(v.y + v.h, r.y + r.h)) { t.ratio.y = clampRatio((v.y - c.y - GAP) / (c.h - GAP)); moved = true; }
  }
  if (!moved) return;
  edgeDrag = true;
  // 끌고 있는 창은 OS가 크기를 바꾸는 중이라 건드리지 않음
  const next = layout(t);
  next.rects.forEach((nr, k) => { if (k !== i) w32.fitVisible(t.panes[k].hwnd, nr); });
  win.webContents.send('bars', { gap: GAP, bars: next.bars });
}

function releaseAll() {
  for (const p of panes()) if (w32.api.IsWindow(p.hwnd)) {
    release(p.hwnd);
    const o = origPlacement.get(p.hwnd);
    origPlacement.delete(p.hwnd);
    if (o) w32.setPlacement(p.hwnd, o); // 없으면 release가 복원한 마지막 칸 자리에 둠
  }
  tabs.length = 0;
  active = 0;
}

// 탭 줄이 곧 제목 표시줄. 최소화·최대화·닫기 버튼만 OS가 오른쪽 위에 그려 줌
// height는 index.html에서 env(titlebar-area-height)로 그대로 받아 씀
function captionOverlay() {
  return { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1a1a1a', height: 30 };
}

// Windows 강조 색을 --sys-accent로 넘김
let accentCss;
async function applyAccent() {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (accentCss) wc.removeInsertedCSS(accentCss);
  accentCss = await wc.insertCSS(`:root { --sys-accent: #${systemPreferences.getAccentColor().slice(0, 6)}; }`);
}

// ---- 설정 ----

let settingsFile;
const settings = { theme: 'system', autoRestore: false, autoUpdate: true };
const settingChoices = { theme: ['system', 'light', 'dark'], autoRestore: [true, false], autoUpdate: [true, false] };

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    for (const k of Object.keys(settingChoices)) if (settingChoices[k].includes(s[k])) settings[k] = s[k];
  } catch {}
  nativeTheme.themeSource = settings.theme;
}

function setSetting(key, value) {
  if (!settingChoices[key]?.includes(value)) return;
  settings[key] = value;
  if (key === 'theme') nativeTheme.themeSource = value;
  if (key === 'autoUpdate') updater.setEnabled(value);
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

app.setAppUserModelId(APP_ID); // 창을 만들기 전에 정해야 작업 공간 창에 적용됨

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  saveFile = path.join(app.getPath('userData'), 'workspace.json');
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  workspacesFile = path.join(app.getPath('userData'), 'workspaces.json');
  loadSaved();
  loadSettings();
  loadWorkspaces();
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
    titleBarStyle: 'hidden',
    titleBarOverlay: captionOverlay(),
    title: 'everything2tab',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  host = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  win.loadFile(path.join(__dirname, 'index.html'));
  let started = false;
  win.webContents.on('did-finish-load', () => {
    accentCss = null;
    applyAccent();
    sendTabs();
    sendWorkspaces();
    if (started) return;
    started = true;
    if (settings.autoRestore && saved.length) restore();
  });
  nativeTheme.on('updated', () => win.setTitleBarOverlay(captionOverlay()));
  systemPreferences.on('accent-color-changed', applyAccent);

  for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'restore']) win.on(ev, fitActive);
  for (const ev of ['minimize', 'restore']) win.on(ev, syncHostTaskbar);
  win.on('close', releaseAll);

  ipcMain.on('bar-height', (_e, px) => { barHeight = Math.round(px); fitActive(); });
  ipcMain.handle('list-windows', async () => {
    const exclude = new Set([host, ...panes().map((p) => p.hwnd)]);
    const list = w32.listAppWindows(exclude);
    return Promise.all(list.map(async (x) => ({ ...x, icon: await iconFor(x.exe, x.hwnd) })));
  });
  ipcMain.on('overlay', (_e, name) => {
    overlay = name;
    const t = tabOf(active);
    if (!t) return;
    if (name) for (const p of t.panes) park(p.hwnd);
    else activate(active);
  });
  ipcMain.handle('get-settings', () => settings);
  ipcMain.on('set-setting', (_e, key, value) => setSetting(key, value));
  ipcMain.on('add', (_e, hwnd) => addTab(hwnd));
  ipcMain.on('activate', (_e, hwnd) => activate(hwnd));
  ipcMain.on('detach', (_e, hwnd) => detach(hwnd));
  ipcMain.on('detach-tab', (_e, hwnd) => detachTab(hwnd));
  // 탭을 바 밖으로 끌어 놓음 → 마우스 위치에 독립 창으로
  ipcMain.on('detach-drop', (_e, hwnd) => {
    const p = w32.cursorPos();
    detach(hwnd, { x: p.x - 120, y: p.y - 15 });
  });
  ipcMain.on('reorder', (_e, hwnd, to) => reorder(hwnd, to));
  ipcMain.on('tab-menu', (_e, hwnd) => tabMenu(hwnd));
  ipcMain.on('split-ratio', (_e, hwnd, axis, ratio, done) => setRatio(hwnd, axis, ratio, done));
  ipcMain.handle('restore', restore);
  ipcMain.handle('workspace-create', (_e, name, items) => createWorkspace(name, items));
  ipcMain.on('workspace-update', (_e, id, patch) => updateWorkspace(id, patch));
  ipcMain.on('workspace-delete', (_e, id) => deleteWorkspace(id));
  ipcMain.handle('workspace-launch', (_e, id) => launchWorkspace(id));
  ipcMain.handle('pick-programs', pickPrograms);
  ipcMain.handle('update-state', () => updater.getState());
  ipcMain.on('update-check', () => updater.check());
  ipcMain.on('update-install', () => updater.install());
  updater.init(settings.autoUpdate, (state) => { if (!win.isDestroyed()) win.webContents.send('update', state); });

  setInterval(poll, 150);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
process.on('exit', releaseAll);
