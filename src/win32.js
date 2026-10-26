// Win32 API 바인딩 (koffi). HWND는 전부 숫자(intptr_t)로 다룸
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const gdi32 = koffi.load('gdi32.dll');
const shell32 = koffi.load('shell32.dll');
const ole32 = koffi.load('ole32.dll');

const ICONINFO = koffi.struct('ICONINFO', { fIcon: 'int', xHotspot: 'uint32_t', yHotspot: 'uint32_t', hbmMask: 'intptr_t', hbmColor: 'intptr_t' });
const BITMAP = koffi.struct('BITMAP', { bmType: 'long', bmWidth: 'long', bmHeight: 'long', bmWidthBytes: 'long', bmPlanes: 'uint16_t', bmBitsPixel: 'uint16_t', bmBits: 'void *' });
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
const WINDOWPLACEMENT = koffi.struct('WINDOWPLACEMENT', { length: 'uint32_t', flags: 'uint32_t', showCmd: 'uint32_t', ptMinPosition: POINT, ptMaxPosition: POINT, rcNormalPosition: RECT });
// 문자열(VT_LPWSTR) 또는 빈 값(VT_EMPTY)만 담는 PROPVARIANT (x64 기준 24바이트)
const PROPVARIANT_STR = koffi.struct('PROPVARIANT_STR', { vt: 'uint16_t', r1: 'uint16_t', r2: 'uint16_t', r3: 'uint16_t', str: 'str16', pad: 'uint64_t' });
// IPropertyStore 메서드 (vtable 순서: QueryInterface, AddRef, Release, GetCount, GetAt, GetValue, SetValue, Commit)
const ComRelease = koffi.proto('uint32_t __stdcall ComRelease(void *self)');
const PSGetValue = koffi.proto('long __stdcall PSGetValue(void *self, void *key, void *pv)');
const PSSetValue = koffi.proto('long __stdcall PSSetValue(void *self, void *key, PROPVARIANT_STR *pv)');

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
  SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'),
  GetClassLongPtrW: user32.func('uintptr_t __stdcall GetClassLongPtrW(intptr_t hwnd, int index)'),
  GetIconInfo: user32.func('bool __stdcall GetIconInfo(intptr_t hicon, _Out_ ICONINFO *info)'),
  GetDC: user32.func('intptr_t __stdcall GetDC(intptr_t hwnd)'),
  ReleaseDC: user32.func('int __stdcall ReleaseDC(intptr_t hwnd, intptr_t hdc)'),
  GetObjectW: gdi32.func('int __stdcall GetObjectW(intptr_t h, int size, _Out_ BITMAP *out)'),
  GetDIBits: gdi32.func('int __stdcall GetDIBits(intptr_t hdc, intptr_t hbm, uint32_t start, uint32_t lines, _Out_ void *bits, void *bmi, uint32_t usage)'),
  DeleteObject: gdi32.func('bool __stdcall DeleteObject(intptr_t h)'),
  SHGetPropertyStoreForWindow: shell32.func('long __stdcall SHGetPropertyStoreForWindow(intptr_t hwnd, void *riid, _Out_ void **ppv)'),
  CoInitializeEx: ole32.func('long __stdcall CoInitializeEx(void *reserved, uint32_t flags)'),
  PropVariantClear: ole32.func('long __stdcall PropVariantClear(void *pv)'),
};

const SW_HIDE = 0, SW_SHOWNA = 8, SW_RESTORE = 9, SW_SHOW = 5, SW_SHOWMINNOACTIVE = 7;
const SW_SHOWNORMAL = 1, SW_SHOWMAXIMIZED = 3;
const GWL_EXSTYLE = -20, GWLP_HWNDPARENT = -8;
const WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
const GW_OWNER = 4;
const DWMWA_TRANSITIONS_FORCEDISABLED = 3, DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14, DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWA_BORDER_COLOR = 34;
const DWMWCP_DEFAULT = 0, DWMWCP_DONOTROUND = 1, DWMWA_COLOR_NONE = 0xFFFFFFFE, DWMWA_COLOR_DEFAULT = 0xFFFFFFFF;
const SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_ASYNCWINDOWPOS = 0x4000;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const VK_LBUTTON = 0x01;
const WM_GETICON = 0x7F, ICON_BIG = 1, ICON_SMALL2 = 2, GCLP_HICON = -14, GCLP_HICONSM = -34, SMTO_ABORTIFHUNG = 0x2;
const COINIT_APARTMENTTHREADED = 0x2, VT_EMPTY = 0, VT_LPWSTR = 31;

// '{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}' → GUID 16바이트
function guid(s) {
  const h = s.replace(/[{}-]/g, '');
  const b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0);
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4);
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  Buffer.from(h.slice(16), 'hex').copy(b, 8);
  return b;
}
const IID_IPropertyStore = guid('886d8eeb-8cf2-4446-8d02-cdba1dbdcf99');
// PKEY_AppUserModel_ID = { 9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3 }, 5
const PKEY_AppUserModel_ID = Buffer.concat([guid('9f4c2855-9f79-4b39-a8d0-e1d42de1d5f3'), Buffer.from([5, 0, 0, 0])]);

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
// 탭을 바꿀 때마다 최소화·복원(park)하므로 그 애니메이션도 끔
function setEmbedded(hwnd, embed) {
  dwmSetU32(hwnd, DWMWA_BORDER_COLOR, embed ? DWMWA_COLOR_NONE : DWMWA_COLOR_DEFAULT);
  dwmSetU32(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, embed ? DWMWCP_DONOTROUND : DWMWCP_DEFAULT);
  dwmSetU32(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, embed ? 1 : 0);
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

// 창의 속성 저장소(IPropertyStore)를 열어 fn(call)을 실행. call(메서드 번호, 원형, ...인수). 열지 못하면 undefined
let comReady = false;
function withPropStore(hwnd, fn) {
  if (!comReady) { api.CoInitializeEx(null, COINIT_APARTMENTTHREADED); comReady = true; } // 이미 초기화돼 있으면 실패해도 그대로 씀
  const out = [null];
  if (api.SHGetPropertyStoreForWindow(hwnd, IID_IPropertyStore, out) < 0 || !out[0]) return undefined;
  const store = out[0];
  const vtbl = koffi.decode(koffi.decode(store, 'void *'), 'void *', 8);
  try {
    return fn((i, proto, ...args) => koffi.call(vtbl[i], proto, store, ...args));
  } finally {
    koffi.call(vtbl[2], ComRelease, store);
  }
}

// 창에 지정된 AppUserModelID. 없으면 null
function readAppId(call) {
  const pv = Buffer.alloc(24);
  if (call(5, PSGetValue, PKEY_AppUserModel_ID, pv) < 0) return null;
  try {
    return pv.readUInt16LE(0) === VT_LPWSTR ? koffi.decode(pv, 8, 'str16') : null;
  } finally {
    api.PropVariantClear(pv);
  }
}

function getAppId(hwnd) {
  try { return withPropStore(hwnd, readAppId) ?? null; } catch { return null; }
}

// 작업 표시줄은 AppUserModelID가 같은 창을 한 그룹으로 묶음. id를 주면 그 값으로 바꾸고, null이면 바꾸기 전 값으로 되돌림
const origAppId = new Map(); // hwnd → 원래 값(없었으면 null)
function setAppId(hwnd, id) {
  try {
    withPropStore(hwnd, (call) => {
      if (id) {
        if (!origAppId.has(hwnd)) origAppId.set(hwnd, readAppId(call));
        call(6, PSSetValue, PKEY_AppUserModel_ID, { vt: VT_LPWSTR, str: id });
      } else if (origAppId.has(hwnd)) {
        const o = origAppId.get(hwnd);
        origAppId.delete(hwnd);
        call(6, PSSetValue, PKEY_AppUserModel_ID, o ? { vt: VT_LPWSTR, str: o } : { vt: VT_EMPTY, str: null });
      }
    });
  } catch {}
}

// 비활성 탭 창을 활성화하지 않고 최소화함. 숨기면 작업 표시줄 버튼이 사라지고,
// 화면 밖으로 옮기면 어느 모니터에도 속하지 않아 작업 보기(Win+Tab)가 모든 모니터에 띄움
function park(hwnd) {
  return api.ShowWindowAsync(hwnd, SW_SHOWMINNOACTIVE);
}

// 비트맵을 32비트 BGRA 픽셀(위→아래 순서)로 읽음
function bitmapPixels(hdc, hbm, w, h) {
  const bmi = Buffer.alloc(44); // BITMAPINFOHEADER(40) + 색상표 1칸
  bmi.writeUInt32LE(40, 0);
  bmi.writeInt32LE(w, 4);
  bmi.writeInt32LE(-h, 8); // 음수 높이 = 위에서 아래로
  bmi.writeUInt16LE(1, 12);
  bmi.writeUInt16LE(32, 14);
  const px = Buffer.alloc(w * h * 4);
  return api.GetDIBits(hdc, hbm, 0, h, px, bmi, 0) ? px : null;
}

// HICON → { width, height, bgra }. bgra는 알파를 미리 곱한 값(nativeImage.createFromBitmap 형식). 실패하면 null
function iconPixels(hicon) {
  const ii = {};
  if (!api.GetIconInfo(hicon, ii)) return null;
  const hdc = api.GetDC(0);
  try {
    if (!ii.hbmColor) return null; // 흑백 아이콘은 건너뜀
    const bm = {};
    if (!api.GetObjectW(ii.hbmColor, koffi.sizeof(BITMAP), bm)) return null;
    const w = bm.bmWidth, h = bm.bmHeight;
    const px = bitmapPixels(hdc, ii.hbmColor, w, h);
    if (!px) return null;
    let hasAlpha = false;
    for (let i = 3; i < px.length; i += 4) if (px[i]) { hasAlpha = true; break; }
    if (hasAlpha) {
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        px[i] = px[i] * a / 255; px[i + 1] = px[i + 1] * a / 255; px[i + 2] = px[i + 2] * a / 255;
      }
    } else {
      // 알파 없는 옛 아이콘: 마스크가 흰색(1)인 곳이 투명
      const mask = ii.hbmMask && bitmapPixels(hdc, ii.hbmMask, w, h);
      for (let i = 0; i < px.length; i += 4) {
        if (mask && mask[i]) px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
        else px[i + 3] = 255;
      }
    }
    return { width: w, height: h, bgra: px };
  } finally {
    api.ReleaseDC(0, hdc);
    if (ii.hbmColor) api.DeleteObject(ii.hbmColor);
    if (ii.hbmMask) api.DeleteObject(ii.hbmMask);
  }
}

// 창에 지정된 아이콘. 같은 exe로 도는 PWA처럼 창마다 아이콘이 다른 경우를 위함. 없으면 null
function windowIcon(hwnd) {
  const r = [0];
  let hicon = 0;
  for (const type of [ICON_BIG, ICON_SMALL2]) {
    if (api.SendMessageTimeoutW(hwnd, WM_GETICON, type, 0, SMTO_ABORTIFHUNG, 200, r) && r[0]) { hicon = r[0]; break; }
  }
  if (!hicon) hicon = Number(api.GetClassLongPtrW(hwnd, GCLP_HICON)) || Number(api.GetClassLongPtrW(hwnd, GCLP_HICONSM));
  if (!hicon) return null;
  try { return iconPixels(Number(hicon)); } catch { return null; }
}

module.exports = {
  forceTaskbar, refreshTaskbar, getAppId, setAppId, park, windowIcon,
  api, isAppWindow, listAppWindows, cursorPos, getTitle, getExePath, visibleRect, clientRectOnScreen, fitVisible, setEmbedded,
  getPlacement, setPlacement,
  setOwner: (hwnd, owner) => api.SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner),
  show: (hwnd) => api.ShowWindowAsync(hwnd, SW_SHOWNA),
  showActivate: (hwnd) => api.ShowWindowAsync(hwnd, SW_SHOW),
  hide: (hwnd) => api.ShowWindowAsync(hwnd, SW_HIDE),
  restore: (hwnd) => api.ShowWindowAsync(hwnd, SW_RESTORE),
  mouseDown: () => (api.GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0,
};
