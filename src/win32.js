// Win32 API 바인딩 (koffi). HWND는 전부 숫자(intptr_t)로 다룸
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
const WINDOWPLACEMENT = koffi.struct('WINDOWPLACEMENT', { length: 'uint32_t', flags: 'uint32_t', showCmd: 'uint32_t', ptMinPosition: POINT, ptMaxPosition: POINT, rcNormalPosition: RECT });

const api = {
  EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
  GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint16_t *buf, int max)'),
  IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hwnd)'),
  IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
  IsZoomed: user32.func('bool __stdcall IsZoomed(intptr_t hwnd)'),
  IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
  ShowWindowAsync: user32.func('bool __stdcall ShowWindowAsync(intptr_t hwnd, int cmd)'),
  SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
  GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)'),
  GetWindowPlacement: user32.func('bool __stdcall GetWindowPlacement(intptr_t hwnd, _Inout_ WINDOWPLACEMENT *wp)'),
  SetWindowPlacement: user32.func('bool __stdcall SetWindowPlacement(intptr_t hwnd, WINDOWPLACEMENT *wp)'),
  GetClientRect: user32.func('bool __stdcall GetClientRect(intptr_t hwnd, _Out_ RECT *rect)'),
  ClientToScreen: user32.func('bool __stdcall ClientToScreen(intptr_t hwnd, _Inout_ POINT *pt)'),
  GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)'),
  GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
  SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
  GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
  GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
  SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)'),
  GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int key)'),
  GetCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ POINT *pt)'),
  OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
  QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'),
  DwmGetWindowAttribute: dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, void *value, uint32_t size)'),
  DwmSetWindowAttribute: dwmapi.func('long __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, void *value, uint32_t size)'),
  DwmGetRect: dwmapi.func('DwmGetWindowAttribute', 'long', ['intptr_t', 'uint32_t', koffi.out(koffi.pointer(RECT)), 'uint32_t']),
  CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr_t h)'),
};

const SW_HIDE = 0, SW_SHOWNA = 8, SW_RESTORE = 9, SW_SHOW = 5;
const SW_SHOWNORMAL = 1, SW_SHOWMAXIMIZED = 3;
const GWL_EXSTYLE = -20, GWLP_HWNDPARENT = -8;
const WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
const GW_OWNER = 4;
const PARK = -20000; // 비활성 탭 창을 옮겨 둘 화면 밖 좌표. -32000은 최소화 창 좌표라 앱이 최소화로 오해할 수 있어 피함
const DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14, DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWA_BORDER_COLOR = 34;
const DWMWCP_DEFAULT = 0, DWMWCP_DONOTROUND = 1, DWMWA_COLOR_NONE = 0xFFFFFFFE, DWMWA_COLOR_DEFAULT = 0xFFFFFFFF;
const SWP_NOSIZE = 0x1, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_ASYNCWINDOWPOS = 0x4000;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const VK_LBUTTON = 0x01;

function u16(buf, len) {
  return Buffer.from(buf.buffer, buf.byteOffset, len * 2).toString('utf16le');
}

function getTitle(hwnd) {
  const buf = new Uint16Array(512);
  const n = api.GetWindowTextW(hwnd, buf, buf.length);
  return u16(buf, n);
}

function getExePath(hwnd) {
  const pid = [0];
  api.GetWindowThreadProcessId(hwnd, pid);
  const h = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
  if (!h) return '';
  try {
    const buf = new Uint16Array(1024);
    const size = [buf.length];
    return api.QueryFullProcessImageNameW(h, 0, buf, size) ? u16(buf, size[0]) : '';
  } finally {
    api.CloseHandle(h);
  }
}

function isCloaked(hwnd) {
  const v = Buffer.alloc(4);
  return api.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, v, 4) === 0 && v.readUInt32LE(0) !== 0;
}

// 작업 표시줄에 뜨는 일반 최상위 창인지
function isAppWindow(hwnd) {
  return api.IsWindowVisible(hwnd) && !isCloaked(hwnd)
    && api.GetWindow(hwnd, GW_OWNER) === 0
    && !(Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW)
    && getTitle(hwnd) !== '';
}

function listAppWindows(exclude) {
  const out = [];
  const cb = koffi.register((hwnd) => {
    if (!exclude.has(hwnd) && isAppWindow(hwnd)) {
      out.push({ hwnd, title: getTitle(hwnd), exe: getExePath(hwnd) });
    }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try {
    api.EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  return out;
}

function cursorPos() {
  const pt = {};
  api.GetCursorPos(pt);
  return pt;
}

function rectOf(r) {
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}

// 보이는 테두리 기준 사각형 (Win10/11의 투명 크기 조절 테두리 제외)
function visibleRect(hwnd) {
  const r = {};
  const ok = api.DwmGetRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, koffi.sizeof(RECT)) === 0;
  if (ok) return rectOf(r);
  api.GetWindowRect(hwnd, r);
  return rectOf(r);
}

// 최대화 여부와 최대화 전 일반 위치(작업 영역 좌표, 작업 표시줄 제외). 최소화된 창도 일반 위치를 돌려줌
function getPlacement(hwnd) {
  const wp = { length: koffi.sizeof(WINDOWPLACEMENT) };
  if (!api.GetWindowPlacement(hwnd, wp)) return null;
  return { maximized: wp.showCmd === SW_SHOWMAXIMIZED, normal: rectOf(wp.rcNormalPosition) };
}

// getPlacement로 저장한 값을 그대로 되돌림
function setPlacement(hwnd, pl) {
  const n = pl.normal;
  api.SetWindowPlacement(hwnd, {
    length: koffi.sizeof(WINDOWPLACEMENT), flags: 0, showCmd: pl.maximized ? SW_SHOWMAXIMIZED : SW_SHOWNORMAL,
    ptMinPosition: { x: -1, y: -1 }, ptMaxPosition: { x: -1, y: -1 },
    rcNormalPosition: { left: n.x, top: n.y, right: n.x + n.w, bottom: n.y + n.h },
  });
}

// 작업 공간 창의 클라이언트 영역(화면 좌표, 물리 픽셀)
function clientRectOnScreen(hwnd) {
  const r = {};
  api.GetClientRect(hwnd, r);
  const pt = { x: 0, y: 0 };
  api.ClientToScreen(hwnd, pt);
  return { x: pt.x, y: pt.y, w: r.right, h: r.bottom };
}

// 보이는 테두리가 target에 딱 맞도록 창 위치·크기 지정
function fitVisible(hwnd, t) {
  const outer = {};
  api.GetWindowRect(hwnd, outer);
  const o = rectOf(outer);
  const v = visibleRect(hwnd);
  const l = v.x - o.x, top = v.y - o.y;
  const r = (o.x + o.w) - (v.x + v.w), b = (o.y + o.h) - (v.y + v.h);
  return api.SetWindowPos(hwnd, 0, t.x - l, t.y - top, t.w + l + r, t.h + top + b,
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
}

function dwmSetU32(hwnd, attr, value) {
  const v = Buffer.alloc(4);
  v.writeUInt32LE(value);
  return api.DwmSetWindowAttribute(hwnd, attr, v, 4);
}

// Windows 11이 창마다 그리는 1px 테두리와 둥근 모서리를 끄거나(embed=true) 되돌림
// 탭 안에 넣은 창이 활성 탭과 이음매 없이 붙어 보이게 하려는 것. Windows 10에서는 실패해도 무시
function setEmbedded(hwnd, embed) {
  dwmSetU32(hwnd, DWMWA_BORDER_COLOR, embed ? DWMWA_COLOR_NONE : DWMWA_COLOR_DEFAULT);
  dwmSetU32(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, embed ? DWMWCP_DONOTROUND : DWMWCP_DEFAULT);
}

// 소유된 창은 작업 표시줄에 버튼이 없으므로 WS_EX_APPWINDOW로 강제로 띄움(on=true). 우리가 붙인 경우에만 되돌림
const forcedTaskbar = new Set();
function forceTaskbar(hwnd, on) {
  const ex = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  if (on && !(ex & WS_EX_APPWINDOW)) {
    forcedTaskbar.add(hwnd);
    api.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex | WS_EX_APPWINDOW) >>> 0);
  } else if (!on && forcedTaskbar.delete(hwnd)) {
    api.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex & ~WS_EX_APPWINDOW) >>> 0);
  }
}

// 소유자·확장 스타일을 바꾼 창을 숨겼다 다시 보여 줌: 셸은 창이 보이게 될 때 작업 표시줄 버튼 여부를 정함
function refreshTaskbar(hwnd) {
  if (api.IsWindowVisible(hwnd)) api.ShowWindowAsync(hwnd, SW_HIDE);
  api.ShowWindowAsync(hwnd, SW_SHOWNA);
}

// 비활성 탭 창을 화면 밖으로 옮김. 숨기지 않아야 작업 표시줄 버튼이 남음
function park(hwnd) {
  return api.SetWindowPos(hwnd, 0, PARK, PARK, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
}

module.exports = {
  forceTaskbar, refreshTaskbar, park,
  api, isAppWindow, listAppWindows, cursorPos, getTitle, getExePath, visibleRect, clientRectOnScreen, fitVisible, setEmbedded,
  getPlacement, setPlacement,
  setOwner: (hwnd, owner) => api.SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner),
  show: (hwnd) => api.ShowWindowAsync(hwnd, SW_SHOWNA),
  showActivate: (hwnd) => api.ShowWindowAsync(hwnd, SW_SHOW),
  hide: (hwnd) => api.ShowWindowAsync(hwnd, SW_HIDE),
  restore: (hwnd) => api.ShowWindowAsync(hwnd, SW_RESTORE),
  mouseDown: () => (api.GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0,
};
