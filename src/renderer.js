const bar = document.getElementById('bar');
const addBtn = document.getElementById('add');
const empty = document.getElementById('empty');
const picker = document.getElementById('picker');
const list = picker.querySelector('ul');

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

let latest = { tabs: [], saved: 0 };
let drag = null; // { hwnd, el, x0, moved, out, to }

function render() {
  const { tabs, saved } = latest;
  for (const t of bar.querySelectorAll('.tab')) t.remove();
  tabs.forEach((t, i) => {
    const tab = el('div', t.active ? 'tab active' : 'tab');
    tab.title = t.title;
    const x = el('button', 'x', '✕');
    x.title = '탭에서 분리';
    tab.append(icon(t.icon), el('span', 'title', t.title), x);
    tab.addEventListener('pointerdown', (e) => {
      if (e.button === 1) return ws.detach(t.hwnd);
      if (e.button !== 0 || e.target === x) return;
      // 활성화는 놓을 때 함: 누르자마자 다른 창을 앞으로 보내면 포인터 캡처가 끊길 수 있음
      tab.setPointerCapture(e.pointerId);
      drag = { hwnd: t.hwnd, el: tab, x0: e.clientX, moved: false, out: false, from: i, to: i };
    });
    x.addEventListener('click', () => ws.detach(t.hwnd));
    bar.insertBefore(tab, addBtn);
  });
  empty.replaceChildren();
  empty.style.display = tabs.length ? 'none' : '';
  if (!tabs.length) {
    empty.append(el('div', '', '+ 를 눌러 열려 있는 프로그램 창을 넣거나, 창을 이 탭 바로 끌어다 놓으세요'),
      el('div', '', '탭 가운데 클릭·✕ = 분리, 탭을 바 밖으로 끌면 분리'),
      el('div', '', '단축키: Ctrl+Alt+PageUp/PageDown = 이전/다음 탭, Ctrl+Alt+1~9 = n번째 탭'));
    if (saved) {
      const btn = el('button', 'restore', `이전 작업 공간 복원 (${saved}개)`);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '복원 중… (꺼져 있는 프로그램은 실행해서 기다림)';
        const failed = await ws.restore();
        if (failed.length) alert(`복원하지 못한 프로그램: ${failed.join(', ')}`);
      });
      empty.append(btn);
    }
  }
}

ws.onTabs((state) => {
  latest = state;
  if (!drag) render(); // 끄는 중에 다시 그리면 포인터 캡처가 끊김
});

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

ws.onDropHint((on) => bar.classList.toggle('drop', on));

function closePicker() {
  picker.classList.remove('on');
  addBtn.classList.remove('on');
  ws.picker(false);
}

addBtn.addEventListener('click', async () => {
  if (picker.classList.contains('on')) return closePicker();
  ws.picker(true);
  picker.classList.add('on');
  addBtn.classList.add('on');
  list.replaceChildren(el('li', 'e', '불러오는 중…'));
  const wins = await ws.listWindows();
  list.replaceChildren(...wins.map((w) => {
    const li = el('li');
    li.append(icon(w.icon), el('span', 't', w.title), el('span', 'e', w.exe.split('\\').pop()));
    li.addEventListener('click', () => { closePicker(); ws.add(w.hwnd); });
    return li;
  }));
  if (!wins.length) list.replaceChildren(el('li', 'e', '넣을 수 있는 창이 없음'));
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && picker.classList.contains('on')) closePicker(); });
