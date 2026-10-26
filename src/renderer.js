const bar = document.getElementById('bar');
const addBtn = document.getElementById('add');
const empty = document.getElementById('empty');
const pickBtn = document.getElementById('pick');
const restoreBtn = document.getElementById('restore');
const picker = document.getElementById('picker');
const list = picker.querySelector('ul');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings');

const reportBar = () => ws.barHeight(bar.getBoundingClientRect().bottom * devicePixelRatio);
new ResizeObserver(reportBar).observe(bar);
window.addEventListener('resize', reportBar); // 배율이 바뀌는 모니터 이동 대응

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function icon(src) {
  const img = el('img');
  if (src) img.src = src;
  return img;
}

let latest = { tabs: [], saved: 0 }; // tabs: [{ panes: [{ hwnd, title, exe, icon, active }], active }]
let drag = null; // { hwnd, el, x0, moved, out, from, to }. hwnd: 누른 칸의 창
let busy = null; // 지금 여는 묶음: 'restore' | 작업 공간 id | null. 한 번에 하나만 열 수 있음

// 분할 탭은 탭 하나에 칸 2~4개. 칸을 누르면 그 창을 앞에 둠
function render() {
  const { tabs, saved } = latest;
  for (const t of bar.querySelectorAll('.tab')) t.remove();
  tabs.forEach((t, i) => {
    // 창 선택 목록·설정을 연 동안은 탭 창이 가려지므로 어느 탭도 활성으로 표시하지 않음
    const tab = el('div', t.active && overlay === null ? 'tab active' : 'tab');
    if (t.panes.length > 1) { tab.classList.add('split'); tab.style.flexBasis = `${t.panes.length * 170}px`; }
    for (const p of t.panes) {
      const pane = el('div', p.active ? 'pane focus' : 'pane');
      pane.title = p.title;
      pane.append(icon(p.icon), el('span', 'title', p.title));
      pane.addEventListener('pointerdown', (e) => {
        if (e.button === 1) return ws.detach(p.hwnd);
        if (e.button !== 0) return;
        // 활성화는 놓을 때 함: 누르자마자 다른 창을 앞으로 보내면 포인터 캡처가 끊길 수 있음
        tab.setPointerCapture(e.pointerId);
        drag = { hwnd: p.hwnd, el: tab, x0: e.clientX, moved: false, out: false, from: i, to: i };
      });
      pane.addEventListener('contextmenu', (e) => { e.preventDefault(); ws.tabMenu(p.hwnd); });
      tab.append(pane);
    }
    const x = el('button', 'x', '\uE8BB');
    x.title = t.panes.length > 1 ? `탭에서 빼기 (창 ${t.panes.length}개 모두, 창은 닫히지 않음)` : '탭에서 빼기 (창은 닫히지 않음)';
    x.addEventListener('click', () => ws.detachTab(t.panes[0].hwnd));
    tab.append(x);
    bar.insertBefore(tab, addBtn);
  });
  placeBars();
  empty.hidden = tabs.length > 0 || overlay !== null;
  restoreBtn.hidden = !saved;
  restoreBtn.disabled = busy !== null;
  restoreBtn.textContent = busy === 'restore' ? '복원 중… 꺼져 있는 프로그램은 실행해서 기다림' : `이전 작업 공간 복원 (${saved}개)`;
}

// ---- 분할 탭의 창 사이 크기 조절 막대 ----
// 메인이 창 사이에 비워 둔 틈 자리(bars, 작업 영역 기준 물리 픽셀)를 받아 그림. 창(HWND)은 HTML 위에 그려지므로 틈에서만 보임
// 세로 막대(axis 'x')는 열 너비, 가로 막대(axis 'y')는 위아래 칸 높이를 바꿈

const stage = document.getElementById('stage');
const dividers = document.getElementById('dividers');
let layout = { gap: 0, bars: [] };
let resizing = null; // { hwnd, axis, el, ratio } 막대를 끄는 동안. 이때는 다시 그리지 않음(포인터 캡처가 끊김)

const splitTab = () => latest.tabs.find((t) => t.active && t.panes.length > 1);

function placeBars() {
  if (resizing) return;
  const t = splitTab();
  const on = t && overlay === null;
  dividers.replaceChildren(...(on ? layout.bars : []).map((b) => {
    const d = el('div', `divider ${b.axis}`);
    d.title = '끌어서 크기 조절, 두 번 클릭하면 반반';
    Object.assign(d.style, { left: `${b.x / devicePixelRatio}px`, top: `${b.y / devicePixelRatio}px`, width: `${b.w / devicePixelRatio}px`, height: `${b.h / devicePixelRatio}px` });
    d.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      d.setPointerCapture(e.pointerId);
      d.classList.add('drag');
      resizing = { hwnd: t.panes[0].hwnd, axis: b.axis, el: d, ratio: null };
    });
    d.addEventListener('pointermove', (e) => {
      if (resizing?.el !== d) return;
      // 막대 가운데가 포인터에 오도록: 비율 = (위치 - 틈/2) / (전체 - 틈). 메인 layout과 같은 식
      const r = stage.getBoundingClientRect();
      const x = b.axis === 'x';
      const pos = (x ? e.clientX - r.left : e.clientY - r.top) * devicePixelRatio;
      const size = (x ? r.width : r.height) * devicePixelRatio;
      resizing.ratio = Math.min(0.85, Math.max(0.15, (pos - layout.gap / 2) / (size - layout.gap))); // 메인의 clampRatio와 같은 범위
      const at = (resizing.ratio * (size - layout.gap)) / devicePixelRatio;
      d.style[x ? 'left' : 'top'] = `${at}px`;
      ws.splitRatio(resizing.hwnd, b.axis, resizing.ratio, false);
    });
    const end = () => {
      if (resizing?.el !== d) return;
      const { hwnd, axis, ratio } = resizing;
      resizing = null;
      d.classList.remove('drag');
      if (ratio === null) return; // 누르기만 함: 그대로 둬야 두 번 클릭이 같은 막대에 들어감
      ws.splitRatio(hwnd, axis, ratio, true);
      placeBars();
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('dblclick', () => ws.splitRatio(t.panes[0].hwnd, b.axis, 0.5, true));
    return d;
  }));
}

ws.onBars((l) => { layout = l; placeBars(); });

function report(failed) {
  if (failed === null) alert('다른 작업 공간을 여는 중입니다. 끝난 뒤 다시 시도하세요.');
  else if (failed.length) alert(`탭으로 넣지 못한 프로그램: ${failed.join(', ')}`);
}

async function runBusy(key, job) {
  if (busy) return;
  busy = key;
  renderWorkspaces();
  render();
  const failed = await job();
  busy = null;
  renderWorkspaces();
  render();
  report(failed);
}

restoreBtn.addEventListener('click', () => runBusy('restore', ws.restore));

ws.onTabs((state) => {
  latest = state;
  if (!drag) render(); // 끄는 중에 다시 그리면 포인터 캡처가 끊김
  if (overlay === 'settings') renderWorkspaceSettings(); // "열린 탭 추가" 버튼 상태
});

// ---- 작업 공간: 함께 실행할 프로그램 묶음 ----

const emptyLaunch = document.getElementById('empty-launch');
const pickerLaunch = document.getElementById('picker-launch');
const pickerSub = document.getElementById('picker-sub');
const wsList = document.getElementById('ws-list');
let workspaces = [];
let focusWorkspace = null; // 새로 만든 작업 공간: 다음에 그릴 때 이름 칸에 포커스

const baseName = (p) => p.split('\\').pop().replace(/\.(exe|lnk)$/i, '');
const itemLabel = (it) => it.title || baseName(it.launch || it.exe);
const tabWindows = () => latest.tabs.flatMap((t) => t.panes);
const tabItems = () => tabWindows().filter((t) => t.exe).map((t) => ({ exe: t.exe, title: t.title }));
const sameItem = (a, b) => a.exe.toLowerCase() === b.exe.toLowerCase() && a.title === b.title && (a.launch || '') === (b.launch || '');

function addItems(w, items) {
  const add = items.filter((it) => !w.items.some((x) => sameItem(x, it)));
  if (add.length) ws.updateWorkspace(w.id, { items: [...w.items, ...add] });
}

function launch(id) {
  closeOverlay();
  runBusy(id, () => ws.launchWorkspace(id));
}

function launchButton(w) {
  const b = el('button', 'launch-btn');
  const stack = el('span', 'stack');
  for (const it of w.items.slice(0, 4)) stack.append(icon(it.icon));
  b.append(stack, el('span', 'name', busy === w.id ? `${w.name} 여는 중…` : w.name), el('span', 'count', `${w.items.length}개`));
  b.title = w.items.map(itemLabel).join('\n');
  b.disabled = busy !== null || !w.items.length;
  b.addEventListener('click', () => launch(w.id));
  return b;
}

function renderWorkspaceSettings() {
  // 이름을 고치는 중에 다시 그리면 입력이 끊김
  if (wsList.contains(document.activeElement) && document.activeElement.classList.contains('wsp-name')) return;
  wsList.replaceChildren(...workspaces.map((w) => {
    const name = el('input', 'wsp-name');
    name.value = w.name;
    name.setAttribute('aria-label', '작업 공간 이름');
    name.addEventListener('change', () => ws.updateWorkspace(w.id, { name: name.value }));
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
      if (e.key === 'Escape') { e.stopPropagation(); name.value = w.name; name.blur(); }
    });
    name.addEventListener('blur', () => setTimeout(renderWorkspaceSettings));

    const open = el('button', 'btn primary small', busy === w.id ? '여는 중…' : '열기');
    open.disabled = busy !== null || !w.items.length;
    open.addEventListener('click', () => launch(w.id));
    const del = el('button', 'icon-btn', '\uE74D');
    del.title = '작업 공간 삭제';
    del.addEventListener('click', () => {
      if (confirm(`"${w.name}" 작업 공간을 삭제할까요? 실행 중인 프로그램은 닫히지 않습니다.`)) ws.deleteWorkspace(w.id);
    });
    const head = el('div', 'wsp-head');
    head.append(name, open, del);

    const chips = el('div', 'chips');
    if (!w.items.length) chips.append(el('span', 'none', '프로그램이 없습니다. 아래 버튼으로 추가하세요.'));
    w.items.forEach((it, i) => {
      const chip = el('span', 'chip');
      chip.title = it.launch || it.exe;
      const x = el('button', 'icon-btn', '\uE8BB');
      x.title = '이 작업 공간에서 빼기';
      x.addEventListener('click', () => ws.updateWorkspace(w.id, { items: w.items.filter((_, j) => j !== i) }));
      chip.append(icon(it.icon), el('span', '', itemLabel(it)), x);
      chips.append(chip);
    });

    const fromTabs = el('button', 'btn small', '열린 탭 추가');
    fromTabs.title = '지금 탭에 있는 프로그램을 이 작업 공간에 넣습니다';
    fromTabs.disabled = !latest.tabs.length;
    fromTabs.addEventListener('click', () => addItems(w, tabItems()));
    const files = el('button', 'btn small', '프로그램 파일 추가…');
    files.addEventListener('click', async () => {
      const r = await ws.pickPrograms();
      addItems(w, r.items);
      if (r.skipped.length) alert(`바로 가기 대상이 프로그램(.exe)이 아니라서 넣지 못함: ${r.skipped.join(', ')}`);
    });
    const foot = el('div', 'wsp-foot');
    foot.append(fromTabs, files);

    const card = el('div', 'wsp');
    card.append(head, chips, foot);
    if (w.id === focusWorkspace) {
      focusWorkspace = null;
      queueMicrotask(() => { name.focus(); name.select(); });
    }
    return card;
  }));
}

function renderWorkspaces() {
  const has = workspaces.length > 0;
  emptyLaunch.hidden = !has;
  pickerLaunch.hidden = !has;
  pickerSub.hidden = !has;
  emptyLaunch.querySelector('.launch-list').replaceChildren(...workspaces.map(launchButton));
  pickerLaunch.querySelector('.launch-list').replaceChildren(...workspaces.map(launchButton));
  renderWorkspaceSettings();
}

ws.onWorkspaces((list) => {
  workspaces = list;
  renderWorkspaces();
});

document.getElementById('ws-new').addEventListener('click', async () => {
  // 탭이 열려 있으면 그 프로그램들로 시작
  focusWorkspace = await ws.createWorkspace('', tabItems());
  renderWorkspaceSettings();
});

// ---- 실행 중인 프로그램(탭 + 열려 있는 창)을 골라 작업 공간 만들기 ----

const wsRunning = document.getElementById('ws-running');
let running = []; // [{ exe, title, icon, tab, on }]

function closeRunning() {
  running = [];
  wsRunning.hidden = true;
  wsRunning.replaceChildren();
}

async function openRunning() {
  const wins = await ws.listWindows();
  if (overlay !== 'settings') return;
  const seen = new Set();
  running = [...tabWindows().map((t) => ({ ...t, tab: true })), ...wins.map((w) => ({ ...w, tab: false }))]
    .filter((x) => {
      if (!x.exe) return false;
      const key = `${x.exe.toLowerCase()}\n${x.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((x) => ({ exe: x.exe, title: x.title, icon: x.icon, tab: x.tab, on: true }));

  const count = el('span', 'count');
  const create = el('button', 'btn primary small', '만들기');
  const toggle = el('button', 'btn small');
  const sync = () => {
    const n = running.filter((x) => x.on).length;
    count.textContent = `${running.length}개 중 ${n}개 선택`;
    create.disabled = !n;
    toggle.textContent = n === running.length ? '모두 해제' : '모두 선택';
    toggle.disabled = !running.length;
  };

  const rows = el('ul', 'run-list');
  if (!running.length) rows.append(el('li', 'none', '넣을 수 있는 실행 중인 프로그램 창이 없습니다.'));
  const boxes = running.map((x) => {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => { x.on = box.checked; sync(); });
    const row = el('label', 'run-row');
    row.title = x.exe;
    row.append(box, icon(x.icon), el('span', 't', x.title || baseName(x.exe)), el('span', 'e', `${baseName(x.exe)}${x.tab ? ' · 탭' : ''}`));
    const li = el('li');
    li.append(row);
    rows.append(li);
    return box;
  });

  toggle.addEventListener('click', () => {
    const on = running.some((x) => !x.on);
    running.forEach((x, i) => { x.on = on; boxes[i].checked = on; });
    sync();
  });
  create.addEventListener('click', async () => {
    const items = running.filter((x) => x.on).map((x) => ({ exe: x.exe, title: x.title }));
    closeRunning();
    focusWorkspace = await ws.createWorkspace('', items);
    renderWorkspaceSettings();
  });
  const cancel = el('button', 'btn small', '취소');
  cancel.addEventListener('click', closeRunning);

  const head = el('div', 'wsp-head');
  head.append(el('span', 'wsp-title', '실행 중인 프로그램으로 만들기'), count);
  const foot = el('div', 'wsp-foot');
  foot.append(create, toggle, cancel);
  wsRunning.replaceChildren(head, rows, foot);
  wsRunning.hidden = false;
  sync();
  (boxes[0] || create).focus();
}

document.getElementById('ws-from-running').addEventListener('click', openRunning);

bar.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0;
  if (!drag.moved && Math.abs(dx) < 5 && e.clientY >= 0 && e.clientY <= bar.offsetHeight) return;
  drag.moved = true;
  drag.el.classList.add('dragging');
  drag.el.style.transform = `translateX(${dx}px)`;
  drag.out = e.clientY < -10 || e.clientY > bar.offsetHeight + 30 || e.clientX < 0 || e.clientX > innerWidth;
  drag.el.classList.toggle('out', drag.out);
  const others = [...bar.querySelectorAll('.tab')].filter((t) => t !== drag.el);
  drag.to = others.filter((t) => { const r = t.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; }).length;
});

bar.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) ws.activate(d.hwnd);
  else if (d.out) ws.detachDrop(d.hwnd);
  else if (d.moved && d.to !== d.from) ws.reorder(d.hwnd, d.to);
  render();
});
bar.addEventListener('pointercancel', () => { drag = null; render(); });

ws.onDropHint((zone) => {
  bar.classList.toggle('drop', zone === 'bar');
  stage.classList.toggle('drop', zone === 'window');
});
ws.onCloseOverlay(closeOverlay);

// ---- 탭 줄 아래를 덮는 화면(창 선택 목록, 설정). 한 번에 하나만 ----

const overlays = { picker: [picker, addBtn], settings: [settingsPanel, settingsBtn] };
let overlay = null;

function setOverlay(name) {
  if (overlay) {
    const [panel, btn] = overlays[overlay];
    panel.hidden = true;
    btn.classList.remove('on');
  }
  overlay = name;
  if (name) {
    const [panel, btn] = overlays[name];
    panel.hidden = false;
    btn.classList.add('on');
  }
  ws.overlay(name);
  render();
}

function closeOverlay() {
  if (overlay) setOverlay(null);
}

async function openPicker() {
  setOverlay('picker');
  list.replaceChildren(el('li', 'note', '불러오는 중…'));
  const wins = await ws.listWindows();
  if (overlay !== 'picker') return;
  if (!wins.length) return list.replaceChildren(el('li', 'note', '넣을 수 있는 창이 없음'));
  list.replaceChildren(...wins.map((w) => {
    const row = el('button', 'row');
    row.append(icon(w.icon), el('span', 't', w.title), el('span', 'e', w.exe.split('\\').pop()));
    row.addEventListener('click', () => { closeOverlay(); ws.add(w.hwnd); });
    const li = el('li');
    li.append(row);
    return li;
  }));
  list.querySelector('.row').focus();
}

async function openSettings() {
  setOverlay('settings');
  closeRunning();
  const s = await ws.getSettings();
  for (const input of settingsPanel.querySelectorAll('input[name="theme"]')) input.checked = input.value === s.theme;
  settingsPanel.querySelector('#auto-restore').checked = s.autoRestore;
  settingsPanel.querySelector('#auto-update').checked = s.autoUpdate;
  renderUpdate(await ws.updateState());
}

settingsPanel.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'theme') ws.setSetting('theme', t.value);
  else if (t.id === 'auto-restore') ws.setSetting('autoRestore', t.checked);
  else if (t.id === 'auto-update') ws.setSetting('autoUpdate', t.checked);
});

// ---- 자동 업데이트 상태 ----

const updateStatus = document.getElementById('update-status');
const updateBtn = document.getElementById('update-btn');
let update = null;

function renderUpdate(s) {
  update = s;
  const v = `현재 버전 ${s.version}`;
  const text = {
    unsupported: s.reason === 'portable' ? `${v} · 포터블 버전은 자동 업데이트를 지원하지 않습니다. 설치형을 쓰세요.` : `${v} · 개발 실행에서는 업데이트를 확인하지 않습니다.`,
    idle: v,
    checking: `${v} · 새 버전 확인 중…`,
    latest: `${v} · 최신 버전입니다.`,
    downloading: `${v} · ${s.next} 받는 중… ${s.percent}%`,
    ready: `${v} · ${s.next} 준비됨. 다시 시작하거나 종료하면 설치됩니다.`,
    error: `${v} · 업데이트 확인 실패: ${s.message}`,
  }[s.status];
  updateStatus.textContent = text;
  const ready = s.status === 'ready';
  updateBtn.textContent = ready ? '다시 시작해 설치' : '지금 확인';
  updateBtn.classList.toggle('primary', ready);
  updateBtn.disabled = ['unsupported', 'checking', 'downloading'].includes(s.status);
  settingsPanel.querySelector('#auto-update').disabled = s.status === 'unsupported';
}

ws.onUpdate(renderUpdate);
updateBtn.addEventListener('click', () => (update?.status === 'ready' ? ws.installUpdate() : ws.checkUpdate()));

addBtn.addEventListener('click', () => (overlay === 'picker' ? closeOverlay() : openPicker()));
settingsBtn.addEventListener('click', () => (overlay === 'settings' ? closeOverlay() : openSettings()));
pickBtn.addEventListener('click', openPicker);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });
