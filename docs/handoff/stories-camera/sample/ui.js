export const $ = (id) => document.getElementById(id);
export const icons = () => window.lucide?.createIcons();
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const face = (n) => `https://i.pravatar.cc/120?img=${n}`;
export const MUSIC = 'https://pingo-music.dubesminecraft.workers.dev/api';

export const ME = { id: 'me', name: 'piuxxh', avatar: 'avatar.jpg' };
export const PEOPLE = [
  { id: 'baani', name: 'baani', avatar: face(47), full: 'Baani' },
  { id: 'eddy', name: 'eddy.exe', avatar: face(15), full: 'Eddy' },
  { id: 'riya', name: 'riya.k', avatar: face(45), full: 'Riya Kapoor' },
  { id: 'luffy', name: 'luffy', avatar: face(33), full: 'Luffy' },
  { id: 'aarav', name: 'aarav_', avatar: face(53), full: 'Aarav' },
  { id: 'kashish', name: 'kashish_', avatar: face(44), full: 'Kashish' },
  { id: 'harsh', name: 'harsh.dev', avatar: face(60), full: 'Harsh' },
  { id: 'sonu', name: 'sonu', avatar: face(68), full: 'Sonu' },
];

let toastT;
export function toast(text, icon = 'check') {
  const t = $('toast'); t.innerHTML = `<i data-lucide="${icon}"></i>${text}`; icons(); t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1900);
}

// One bottom sheet at a time. `onClose` runs however it closes.
let closing;
export function sheet(html, { dark = false, cls = '', onClose } = {}) {
  const sh = $('sheet'), sc = $('scrim');
  sh.className = `sheet ${dark ? 'dark' : ''} ${cls}`;
  sh.innerHTML = `<div class="grab"></div>${html}`;
  icons();
  requestAnimationFrame(() => { sh.classList.add('on'); sc.classList.add('on'); });
  closing = onClose;
  return sh;
}
export function closeSheet() {
  $('sheet').classList.remove('on'); $('scrim').classList.remove('on');
  const f = closing; closing = undefined; f?.();
}
document.addEventListener('DOMContentLoaded', () => {});
queueMicrotask(() => $('scrim').addEventListener('click', closeSheet));

// drag the grab handle down to dismiss, as every iOS sheet does
queueMicrotask(() => {
  const sh = $('sheet'); let y0, dy = 0;
  sh.addEventListener('pointerdown', (e) => { if (!e.target.closest('.grab, h3')) return; y0 = e.clientY; sh.style.transition = 'none'; sh.setPointerCapture(e.pointerId); });
  sh.addEventListener('pointermove', (e) => { if (y0 === undefined) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = `translateY(${dy}px)`; });
  sh.addEventListener('pointerup', () => { if (y0 === undefined) return; y0 = undefined; sh.style.transition = ''; sh.style.transform = ''; if (dy > 90) closeSheet(); dy = 0; });
});

// Icons are drawn wherever they appear, however late they were attached.
let iconQ;
new MutationObserver(() => {
  if (iconQ) return;
  iconQ = requestAnimationFrame(() => { iconQ = 0; if (document.querySelector('#phone i[data-lucide]')) icons(); });
}).observe(document.body, { childList: true, subtree: true });
