// GitHub 릴리즈 자동 업데이트. 설치형에서만 동작 (포터블·개발 실행은 설치 프로그램이 없어서 못 바꿈)
//
// 태그(v2026.01.05-beta.1)는 앞자리 0 때문에 semver가 아니라서 electron-updater의 github 공급자가
// 프리 릴리즈 목록에서 건너뜀. 그래서 받을 릴리즈는 여기서 고르고, 그 릴리즈의 latest.yml을 generic 공급자로 읽음
// - 정식 버전 사용자: 최신 정식 릴리즈만
// - 베타 버전 사용자: 정식·베타 중 가장 새 버전
const { app, net } = require('electron');
const { autoUpdater } = require('electron-updater');

const REPO = 'R00neyj/everything2tab';
const CHECK_EVERY = 6 * 60 * 60 * 1000;
const TAG = /^v(\d{4})\.(\d{2})\.(\d{2})(?:-beta\.([1-9]\d*))?$/;

const unsupported = !app.isPackaged ? 'dev' : process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : null;
const isBeta = app.getVersion().includes('-beta.');

let state = { version: app.getVersion(), status: unsupported ? 'unsupported' : 'idle', reason: unsupported };
let onState = () => {};
let timer = null;

function set(patch) {
  state = { version: state.version, ...patch };
  onState(state);
}

// 태그 → 비교용 숫자 [연, 월, 일, 베타 번호(정식은 무한대)]. 규칙에 안 맞으면 null
function tagKey(tag) {
  const m = TAG.exec(tag);
  return m && [+m[1], +m[2], +m[3], m[4] ? +m[4] : Infinity];
}

function newer(a, b) {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function github(pathname) {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}${pathname}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub 응답 ${res.status}`);
  return res.json();
}

async function pickRelease() {
  if (!isBeta) return github('/releases/latest');
  const list = (await github('/releases?per_page=30')) || [];
  let best = null;
  for (const r of list) {
    const key = !r.draft && tagKey(r.tag_name);
    if (key && (!best || newer(key, best.key))) best = { key, release: r };
  }
  return best && best.release;
}

async function check() {
  if (unsupported || ['checking', 'downloading', 'ready'].includes(state.status)) return;
  set({ status: 'checking' });
  try {
    const release = await pickRelease();
    if (!release) return set({ status: 'error', message: isBeta ? '공개된 릴리즈가 없습니다' : '공개된 정식 릴리즈가 없습니다' });
    autoUpdater.setFeedURL({ provider: 'generic', url: `https://github.com/${REPO}/releases/download/${release.tag_name}` });
    await autoUpdater.checkForUpdates();
  } catch (e) {
    set({ status: 'error', message: e.message.split('\n')[0] });
  }
}

function setEnabled(on) {
  if (unsupported) return;
  clearInterval(timer);
  timer = null;
  if (!on) return;
  timer = setInterval(check, CHECK_EVERY);
  check();
}

function init(enabled, listener) {
  onState = listener;
  if (unsupported) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // 받아 둔 업데이트는 종료할 때 설치
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', next: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', next: state.next, percent: Math.floor(p.percent) }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest' }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', next: info.version }));
  autoUpdater.on('error', (e) => set({ status: 'error', message: (e?.message || String(e)).split('\n')[0] }));
  setEnabled(enabled);
}

// 조용히 설치하고 다시 실행
function install() {
  if (state.status === 'ready') autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, setEnabled, check, install, getState: () => state };
