const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain, Menu, globalShortcut } = require('electron');
const w32 = require('./win32');

let win;
let host = 0; // 작업 공간 창 HWND
let barHeight = 40; // 탭 바 높이 (물리 픽셀, 렌더러가 알려 줌)
let pickerOpen = false;
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
  if (!active || pickerOpen || win.isMinimized()) return;
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

// 저장한 창마다: 열려 있는 같은 프로그램 창(제목이 같으면 우선)을 쓰고, 없으면 실행해서 기다림
async function restore() {
  const items = saved.slice();
  restoring = true;
  const failed = [];
  try {
    for (const item of items) {
      const taken = new Set([host, ...tabs.map((t) => t.hwnd)]);
      const open = w32.listAppWindows(taken).filter((x) => x.exe.toLowerCase() === item.exe.toLowerCase());
      let hwnd = (open.find((x) => x.title === item.title) || open[0] || {}).hwnd || 0;
      if (!hwnd && fs.existsSync(item.exe)) {
        const before = new Set(w32.listAppWindows(new Set()).map((x) => x.hwnd));
        spawn(item.exe, [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
        hwnd = await waitNewWindow(item.exe, before);
      }
      if (hwnd) await addTab(hwnd);
      else failed.push(path.basename(item.exe));
    }
  } finally {
    restoring = false;
  }
  sendTabs();
  return failed;
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
  if (!pickerOpen) w32.showActivate(hwnd);
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
  activate(hwnd);
}

// 탭에서 빼서 원래 독립 창으로 되돌림
function release(hwnd) {
  w32.setOwner(hwnd, 0);
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

// ---- 다른 창을 탭 바로 끌어다 놓기 ----

let drag = null; // { hwnd, start } 마우스를 누른 동안 앞에 있던 일반 창
let dropHint = false;

function setDropHint(on) {
  if (on === dropHint) return;
  dropHint = on;
  win.webContents.send('drop-hint', on);
}

function trackDrop(fg) {
  const down = w32.mouseDown();
  if (down && !drag && fg && fg !== host && !tabs.some((t) => t.hwnd === fg) && w32.isAppWindow(fg)) {
    drag = { hwnd: fg, start: w32.visibleRect(fg) };
  }
  if (!drag) return;
  const r = w32.visibleRect(drag.hwnd);
  const moved = r.x !== drag.start.x || r.y !== drag.start.y;
  const over = moved && !win.isMinimized() && inside(w32.cursorPos(), barRect());
  if (down) return setDropHint(over);
  setDropHint(false);
  const hwnd = drag.hwnd;
  drag = null;
  if (over) addTab(hwnd);
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

  if (active && !pickerOpen && !win.isMinimized()) {
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  saveFile = path.join(app.getPath('userData'), 'workspace.json');
  loadSaved();
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#1e1f22',
    title: 'everything2tab',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  host = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', sendTabs);

  for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'restore']) win.on(ev, fitActive);
  win.on('close', releaseAll);

  ipcMain.on('bar-height', (_e, px) => { barHeight = Math.round(px); fitActive(); });
  ipcMain.handle('list-windows', async () => {
    const exclude = new Set([host, ...tabs.map((t) => t.hwnd)]);
    const list = w32.listAppWindows(exclude);
    return Promise.all(list.map(async (x) => ({ ...x, icon: await iconFor(x.exe) })));
  });
  ipcMain.on('picker', (_e, open) => {
    pickerOpen = open;
    if (!active) return;
    if (open) w32.hide(active);
    else activate(active);
  });
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

  setInterval(poll, 150);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
process.on('exit', releaseAll);
