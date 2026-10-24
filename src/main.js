const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain, Menu, globalShortcut, nativeTheme, systemPreferences, dialog, shell } = require('electron');
const w32 = require('./win32');

let win;
let host = 0; // 작업 공간 창 HWND
let barHeight = 40; // 탭 바 높이 (물리 픽셀, 렌더러가 알려 줌)
let overlay = null; // 탭 줄 아래를 덮은 화면: null | 'picker' | 'settings'. 덮는 동안 활성 탭 창은 숨김
let restoring = false;
const tabs = []; // { hwnd, title, exe, icon }
let active = 0;
const icons = new Map(); // exe 경로 → data URL
let saveFile;
let saved = []; // 마지막으로 저장한 그룹 [{ exe, title }]

function contentRect() {
  const c = w32.clientRectOnScreen(host);
  return { x: c.x, y: c.y + barHeight, w: c.w, h: Math.max(0, c.h - barHeight) };
}

function barRect() {
  const c = w32.clientRectOnScreen(host);
  return { x: c.x, y: c.y, w: c.w, h: barHeight };
}

const inside = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

function fitActive() {
  if (!active || overlay || win.isMinimized()) return;
  w32.fitVisible(active, contentRect());
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
  saved = tabs.filter((t) => t.exe).map((t) => ({ exe: t.exe, title: t.title }));
  fs.writeFileSync(saveFile, JSON.stringify(saved, null, 2));
}

function sendTabs() {
  if (!win || win.isDestroyed()) return;
  save();
  win.webContents.send('tabs', {
    tabs: tabs.map((t) => ({ ...t, active: t.hwnd === active })),
    saved: tabs.length ? 0 : saved.length,
  });
  const cur = tabs.find((t) => t.hwnd === active);
  win.setTitle(cur ? `${cur.title} - everything2tab` : 'everything2tab');
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
// items: [{ exe, title, launch? }]. launch는 바로 가기(.lnk) 경로: 인수·작업 폴더까지 바로 가기 그대로 실행
// 반환: 탭으로 넣지 못한 프로그램 이름 목록. 이미 다른 묶음을 여는 중이면 null
async function openItems(items) {
  if (restoring) return null;
  restoring = true;
  const failed = [];
  try {
    for (const item of items) {
      const taken = new Set([host, ...tabs.map((t) => t.hwnd)]);
      const open = w32.listAppWindows(taken).filter((x) => x.exe.toLowerCase() === item.exe.toLowerCase());
      let hwnd = (open.find((x) => x.title === item.title) || open[0] || {}).hwnd || 0;
      const launchable = item.launch ? fs.existsSync(item.launch) : fs.existsSync(item.exe);
      if (!hwnd && launchable) {
        const before = new Set(w32.listAppWindows(new Set()).map((x) => x.hwnd));
        if (item.launch) shell.openPath(item.launch);
        else spawn(item.exe, [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
        hwnd = await waitNewWindow(item.exe, before);
      }
      if (hwnd) await addTab(hwnd);
      else failed.push(path.basename(item.launch || item.exe));
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

async function iconFor(exe) {
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

function activate(hwnd) {
  if (!tabs.some((t) => t.hwnd === hwnd)) return;
  const prev = active;
  active = hwnd;
  if (w32.api.IsZoomed(hwnd) || w32.api.IsIconic(hwnd)) w32.restore(hwnd);
  w32.fitVisible(hwnd, contentRect());
  if (!overlay) w32.showActivate(hwnd);
  if (prev && prev !== hwnd) w32.hide(prev);
  w32.api.SetForegroundWindow(hwnd);
  sendTabs();
}

function activateOffset(d) {
  if (!tabs.length) return;
  const i = Math.max(0, tabs.findIndex((t) => t.hwnd === active));
  activate(tabs[(i + d + tabs.length) % tabs.length].hwnd);
}

async function addTab(hwnd) {
  if (tabs.some((t) => t.hwnd === hwnd) || hwnd === host || !w32.api.IsWindow(hwnd)) return;
  const exe = w32.getExePath(hwnd);
  tabs.push({ hwnd, title: w32.getTitle(hwnd), exe, icon: await iconFor(exe) });
  // 소유자를 작업 공간 창으로: 항상 그 위에 그려지고 최소화·복원을 같이 따라감
  w32.setOwner(hwnd, host);
  w32.setEmbedded(hwnd, true);
  activate(hwnd);
}

// 탭에서 빼서 원래 독립 창으로 되돌림
function release(hwnd) {
  w32.setOwner(hwnd, 0);
  w32.setEmbedded(hwnd, false);
  w32.show(hwnd);
}

// at: 분리한 창의 왼쪽 위를 둘 화면 좌표. 없으면 작업 공간 안쪽으로 살짝 비켜 놓음
function detach(hwnd, at) {
  const i = tabs.findIndex((t) => t.hwnd === hwnd);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (w32.api.IsWindow(hwnd)) {
    release(hwnd);
    const c = contentRect();
    const w = Math.round(c.w * 0.8), h = Math.round(c.h * 0.8);
    const p = at || { x: c.x + 40, y: c.y + 40 };
    w32.fitVisible(hwnd, { x: p.x, y: p.y, w, h });
    w32.api.SetForegroundWindow(hwnd);
  }
  if (active === hwnd) {
    active = 0;
    const next = tabs[Math.min(i, tabs.length - 1)];
    if (next) activate(next.hwnd);
  }
  sendTabs();
}

function reorder(hwnd, to) {
  const i = tabs.findIndex((t) => t.hwnd === hwnd);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, t);
  sendTabs();
}

// ---- 단축키: 작업 공간이나 그 안의 프로그램이 앞에 있을 때만 등록 ----

const shortcuts = {
  'Control+Alt+PageDown': () => activateOffset(1),
  'Control+Alt+PageUp': () => activateOffset(-1),
};
for (let n = 1; n <= 9; n++) {
  shortcuts[`Control+Alt+${n}`] = () => { const t = n === 9 ? tabs.at(-1) : tabs[n - 1]; if (t) activate(t.hwnd); };
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

let drag = null; // { hwnd, start } 마우스를 누른 동안 앞에 있던 일반 창
let dropHint = false; // false | 'bar' | 'window'

function setDropHint(zone) {
  if (zone === dropHint) return;
  dropHint = zone;
  win.webContents.send('drop-hint', zone);
}

function trackDrop(fg) {
  const down = w32.mouseDown();
  if (down && !drag && fg && fg !== host && !tabs.some((t) => t.hwnd === fg) && w32.isAppWindow(fg)) {
    drag = { hwnd: fg, start: w32.visibleRect(fg) };
  }
  if (!drag) return;
  const r = w32.visibleRect(drag.hwnd);
  const moved = r.x !== drag.start.x || r.y !== drag.start.y;
  const whole = overlay === 'picker' || !tabs.length;
  const zone = whole ? 'window' : 'bar';
  const area = whole ? w32.clientRectOnScreen(host) : barRect();
  const over = moved && !win.isMinimized() && inside(w32.cursorPos(), area) ? zone : false;
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
  for (let i = tabs.length - 1; i >= 0; i--) {
    const t = tabs[i];
    if (!w32.api.IsWindow(t.hwnd)) {
      tabs.splice(i, 1);
      if (active === t.hwnd) {
        active = 0;
        const next = tabs[Math.min(i, tabs.length - 1)];
        if (next) activate(next.hwnd);
      }
      changed = true;
      continue;
    }
    const title = w32.getTitle(t.hwnd);
    if (title !== t.title) { t.title = title; changed = true; }
  }
  const fg = w32.api.GetForegroundWindow();
  setShortcuts(fg === host || tabs.some((t) => t.hwnd === fg));
  trackDrop(fg);
  // 숨겨 둔 탭이 다른 경로(작업 표시줄 등)로 앞에 나오면 그 탭으로 전환
  if (fg && fg !== active && tabs.some((t) => t.hwnd === fg)) activate(fg);

  if (active && !overlay && !win.isMinimized()) {
    if (w32.api.IsZoomed(active)) {
      // 프로그램의 최대화 버튼 → 작업 공간을 최대화
      w32.restore(active);
      win.maximize();
    } else if (w32.api.IsIconic(active)) {
      // 프로그램의 최소화 버튼 → 작업 공간을 최소화
      w32.restore(active);
      win.minimize();
    } else if (!w32.mouseDown()) {
      // 제목 표시줄로 끌어서 옮겼거나 크기를 바꿨으면, 마우스를 놓은 뒤 제자리로
      const v = w32.visibleRect(active);
      const c = contentRect();
      if (Math.abs(v.x - c.x) > 1 || Math.abs(v.y - c.y) > 1 || Math.abs(v.w - c.w) > 1 || Math.abs(v.h - c.h) > 1) {
        w32.fitVisible(active, c);
      }
    }
  }
  if (changed) sendTabs();
}

function releaseAll() {
  for (const t of tabs) if (w32.api.IsWindow(t.hwnd)) release(t.hwnd);
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
const settings = { theme: 'system', autoRestore: false };
const settingChoices = { theme: ['system', 'light', 'dark'], autoRestore: [true, false] };

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
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

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
  win.on('close', releaseAll);

  ipcMain.on('bar-height', (_e, px) => { barHeight = Math.round(px); fitActive(); });
  ipcMain.handle('list-windows', async () => {
    const exclude = new Set([host, ...tabs.map((t) => t.hwnd)]);
    const list = w32.listAppWindows(exclude);
    return Promise.all(list.map(async (x) => ({ ...x, icon: await iconFor(x.exe) })));
  });
  ipcMain.on('overlay', (_e, name) => {
    overlay = name;
    if (!active) return;
    if (name) w32.hide(active);
    else activate(active);
  });
  ipcMain.handle('get-settings', () => settings);
  ipcMain.on('set-setting', (_e, key, value) => setSetting(key, value));
  ipcMain.on('add', (_e, hwnd) => addTab(hwnd));
  ipcMain.on('activate', (_e, hwnd) => activate(hwnd));
  ipcMain.on('detach', (_e, hwnd) => detach(hwnd));
  // 탭을 바 밖으로 끌어 놓음 → 마우스 위치에 독립 창으로
  ipcMain.on('detach-drop', (_e, hwnd) => {
    const p = w32.cursorPos();
    detach(hwnd, { x: p.x - 120, y: p.y - 15 });
  });
  ipcMain.on('reorder', (_e, hwnd, to) => reorder(hwnd, to));
  ipcMain.handle('restore', restore);
  ipcMain.handle('workspace-create', (_e, name, items) => createWorkspace(name, items));
  ipcMain.on('workspace-update', (_e, id, patch) => updateWorkspace(id, patch));
  ipcMain.on('workspace-delete', (_e, id) => deleteWorkspace(id));
  ipcMain.handle('workspace-launch', (_e, id) => launchWorkspace(id));
  ipcMain.handle('pick-programs', pickPrograms);

  setInterval(poll, 150);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
process.on('exit', releaseAll);
