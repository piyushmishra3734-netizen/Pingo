// After the shot: edit, then Story or Send To - Snapchat's order in PINGO's glass.
const $ = (id) => document.getElementById(id);
const phone = $('phone'), post = $('post'), layer = $('layer');
const icons = () => lucide.createIcons();

function toast(text, icon = 'check') {
  const t = $('toast'); t.innerHTML = `<i data-lucide="${icon}"></i>${text}`; icons(); t.classList.add('on');
  clearTimeout(t.t); t.t = setTimeout(() => t.classList.remove('on'), 1800);
}

// ---- anything on the snap can be dragged; a double tap removes it ----
function draggable(el) {
  let sx, sy, ox, oy;
  el.addEventListener('pointerdown', (e) => {
    if (el.isContentEditable && document.activeElement === el) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop;
    el.style.cursor = 'grabbing';
  });
  el.addEventListener('pointermove', (e) => {
    if (sx === undefined) return;
    if (!el.classList.contains('cap')) el.style.left = ox + e.clientX - sx + 'px';
    el.style.top = oy + e.clientY - sy + 'px'; el.style.transform = el.classList.contains('chip-link') ? 'none' : el.style.transform;
    el.moved = Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4;
  });
  el.addEventListener('pointerup', () => { sx = undefined; el.style.cursor = ''; });
  el.addEventListener('dblclick', () => el.remove());
}

// ---- text: Snapchat's caption bar; tapping T again changes the style ----
const STYLES = ['bar', 'big', 'brand'];
$('tText').onclick = () => {
  let cap = layer.querySelector('.cap');
  if (cap && document.activeElement === cap) {
    const next = STYLES[(STYLES.indexOf(cap.dataset.s) + 1) % STYLES.length];
    cap.classList.remove(cap.dataset.s); cap.classList.add(next); cap.dataset.s = next; cap.focus(); return;
  }
  if (!cap) {
    cap = document.createElement('div'); cap.className = 'cap bar'; cap.dataset.s = 'bar'; cap.contentEditable = 'true';
    layer.append(cap); draggable(cap);
    cap.addEventListener('click', () => { if (!cap.moved) cap.focus(); cap.moved = false; });
    cap.addEventListener('blur', () => { if (!cap.textContent.trim()) cap.remove(); });
  }
  cap.focus();
};

// ---- draw ----
const ink = $('ink'), g = ink.getContext('2d');
let strokes = [], colour = '#ffffff';
function sizeInk() { const r = layer.getBoundingClientRect(); ink.width = r.width * 2; ink.height = r.height * 2; redraw(); }
function redraw() {
  g.clearRect(0, 0, ink.width, ink.height); g.lineCap = g.lineJoin = 'round'; g.lineWidth = 10;
  for (const s of strokes) { g.strokeStyle = s.c; g.beginPath(); s.p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
}
let drawing = false;
ink.addEventListener('pointerdown', (e) => {
  if (!post.classList.contains('drawing')) return;
  const r = ink.getBoundingClientRect(); drawing = true; ink.setPointerCapture(e.pointerId);
  strokes.push({ c: colour, p: [[(e.clientX - r.left) * 2, (e.clientY - r.top) * 2]] });
});
ink.addEventListener('pointermove', (e) => {
  if (!drawing) return; const r = ink.getBoundingClientRect();
  strokes.at(-1).p.push([(e.clientX - r.left) * 2, (e.clientY - r.top) * 2]); redraw();
});
ink.addEventListener('pointerup', () => (drawing = false));
$('tDraw').onclick = () => { sizeInk(); post.classList.add('drawing', 'busy'); layer.style.zIndex = 3; };
$('penDone').onclick = () => { post.classList.remove('drawing', 'busy'); layer.style.zIndex = ''; };
$('penUndo').onclick = () => { strokes.pop(); redraw(); };
const hue = $('hue');
function pickHue(e) {
  const r = hue.getBoundingClientRect(), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
  const c = document.createElement('canvas'); c.width = 1; c.height = 100; const cg = c.getContext('2d');
  const grad = cg.createLinearGradient(0, 0, 0, 100);
  ['#fff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#bf5af2', '#e0559b', '#000'].forEach((col, i, a) => grad.addColorStop(i / (a.length - 1), col));
  cg.fillStyle = grad; cg.fillRect(0, 0, 1, 100);
  const [R, G, B] = cg.getImageData(0, Math.min(99, Math.round(y * 100)), 1, 1).data;
  colour = `rgb(${R},${G},${B})`; $('penDot').style.top = y * 100 + '%'; $('penDot').style.background = colour;
}
hue.addEventListener('pointerdown', (e) => { hue.setPointerCapture(e.pointerId); pickHue(e); hue.onpointermove = pickHue; });
hue.addEventListener('pointerup', () => (hue.onpointermove = null));
$('penDot').style.top = '0%'; $('penDot').style.background = colour;

// ---- stickers: PINGO's own Fluent 3D pack ----
const mini = (id, on) => { $(id).classList.toggle('on', on); $('scrim').style.opacity = on ? 1 : ''; $('scrim').style.pointerEvents = on ? 'auto' : ''; };
let pack;
$('tStick').onclick = async () => {
  mini('stickers', true);
  if (!pack) {
    pack = (await (await fetch('fluent-3d.json')).json()).stickers;
    $('sgrid').innerHTML = pack.slice(0, 64).map((s, i) => `<button data-i="${i}"><img loading="lazy" src="${s.url}" alt="${s.name}"></button>`).join('');
  }
};
$('sgrid').onclick = (e) => {
  const b = e.target.closest('[data-i]'); if (!b) return;
  const st = document.createElement('div'); st.className = 'stk';
  st.innerHTML = `<img src="${pack[+b.dataset.i].url}" alt="">`;
  st.style.left = layer.clientWidth / 2 - 55 + 'px'; st.style.top = layer.clientHeight * 0.3 + 'px';
  layer.append(st); draggable(st); mini('stickers', false);
};

// ---- link ----
$('tLink').onclick = () => { mini('linker', true); setTimeout(() => $('lurl').focus(), 300); };
$('lform').onsubmit = (e) => {
  e.preventDefault(); const url = $('lurl').value.trim(); if (!url) return;
  const chip = document.createElement('div'); chip.className = 'chip-link glass';
  chip.innerHTML = `<i data-lucide="link"></i><span>${url.replace(/^https?:\/\//, '')}</span>`;
  layer.append(chip); icons(); draggable(chip); $('lurl').value = ''; mini('linker', false);
};
$('scrim').addEventListener('click', () => { mini('stickers', false); mini('linker', false); });

// ---- view limit: PINGO's Ping, 1, 2 or unlimited ----
const VIEWS = ['1', '2', '∞']; let vi = 1;
$('tViews').onclick = () => { vi = (vi + 1) % 3; $('viewsN').textContent = VIEWS[vi]; toast(vi === 2 ? 'Unlimited views' : `${VIEWS[vi]} view${vi ? 's' : ''}, then it's gone`, 'timer'); };

// ---- filters on the snap, swiped from the bottom ----
const now = new Date();
const PF = [
  { k: 'none', label: '<i data-lucide="circle-off"></i>' },
  { k: 'time', label: now.toTimeString().slice(0, 5) },
  { k: 'day', label: `<span class="serif">${now.toLocaleDateString('en', { weekday: 'short' })}</span>` },
  { k: 'vivid', css: 'saturate(1.5) contrast(1.08)' },
  { k: 'warm', css: 'sepia(.3) saturate(1.3) hue-rotate(-12deg)' },
  { k: 'mono', css: 'grayscale(1) contrast(1.2)' },
  { k: 'fade', css: 'contrast(.82) brightness(1.08) saturate(.8)' },
];
let stamp;
function buildPF() {
  const src = $('still').src;
  $('pf').innerHTML = PF.map((f, i) => `<button data-i="${i}" class="${i ? '' : 'on'}">${f.css ? `<img src="${src}" style="filter:${f.css}" alt="">` : f.label}</button>`).join('');
  icons();
}
$('pf').onclick = (e) => {
  const b = e.target.closest('[data-i]'); if (!b) return; const f = PF[+b.dataset.i];
  $('pf').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  [$('still'), $('clipVid')].forEach((el) => (el.style.filter = f.css || ''));
  stamp?.remove(); stamp = undefined;
  if (f.k === 'time' || f.k === 'day') {
    stamp = document.createElement('div'); stamp.className = 'stamp ' + f.k;
    stamp.innerHTML = f.k === 'time' ? `<b>${now.toTimeString().slice(0, 5)}</b>`
      : `<b>${now.toLocaleDateString('en', { weekday: 'long' })}</b><small>${now.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}</small>`;
    layer.prepend(stamp);
  }
};

function reset() {
  layer.querySelectorAll('.cap, .stk, .chip-link, .stamp').forEach((n) => n.remove());
  strokes = []; redraw(); stamp = undefined; $('still').style.filter = ''; $('clipVid').style.filter = '';
  post.classList.remove('drawing', 'busy'); layer.style.zIndex = '';
}
document.addEventListener('snapped', () => { reset(); setTimeout(() => { sizeInk(); buildPF(); }); });
$('retake').onclick = () => { reset(); phone.classList.remove('shot'); $('still').hidden = true; };

// ---- save / story ----
$('pSave').onclick = () => {
  const video = phone.dataset.kind === 'video', v = $('clipVid'), a = document.createElement('a');
  a.href = video ? v.src : $('still').src; a.download = video ? `pingo-snap.${(v.dataset.type || '').includes('mp4') ? 'mp4' : 'webm'}` : 'pingo-snap.jpg';
  a.click(); toast('Saved');
};
$('pStory').onclick = () => { toast('Added to your story'); setTimeout(() => $('retake').click(), 900); };

// ---- Send To ----
const face = (n) => `https://i.pravatar.cc/120?img=${n}`;
const PEOPLE = [
  { id: 'g1', name: 'Chichora gang', sub: 'Luffy, Axhxxh, Baani +7', img: face(12), group: true },
  { id: 'eddy', name: 'Eddy', sub: '12-day streak · last Ping 2h ago', img: face(15) },
  { id: 'baani', name: 'Baani', sub: 'Indore', img: face(47) },
  { id: 'g2', name: 'Design Crew', sub: 'Riya, Aarav, Kashish +5', img: face(66), group: true },
  { id: 'luffy', name: 'Luffy', sub: '', img: face(33) },
  { id: 'riya', name: 'Riya', sub: 'last Ping yesterday', img: face(45) },
  { id: 'aarav', name: 'Aarav', sub: '', img: face(53) },
  { id: 'kashish', name: 'Kashish', sub: 'Pune', img: face(44) },
  { id: 'harsh', name: 'Harsh', sub: 'Unpaid Intern', img: face(60) },
  { id: 'sonu', name: 'Sonu', sub: '', img: face(68) },
];
const picked = new Map(); let stab = 'all';
const sendUse = (() => { try { return JSON.parse(localStorage.getItem('pingo.sendUse')) || {}; } catch { return {}; } })();
const byUse = (a, b) => (sendUse[b.id]?.n || 0) - (sendUse[a.id]?.n || 0) || (sendUse[b.id]?.t || 0) - (sendUse[a.id]?.t || 0);
const tick = '<span class="tick"><i data-lucide="check"></i></span>';
function row(id, name, sub, av) {
  return `<button class="who ${picked.has(id) ? 'on' : ''}" data-id="${id}" data-name="${name}">${av}<span class="t"><b>${name}</b>${sub ? `<span>${sub}</span>` : ''}</span>${tick}</button>`;
}
function renderSend() {
  const q = $('sq').value.trim().toLowerCase();
  const list = [...PEOPLE].sort(byUse).filter((p) => (stab !== 'groups' || p.group) && (!q || p.name.toLowerCase().includes(q)));
  const postTo = stab === 'all' && !q ? `
    <div class="shd"><h4>Post to…</h4><button><i data-lucide="plus"></i>New story</button></div>
    <div class="card">
      ${row('story', 'My story · Friends', 'Your friends on PINGO', '<img class="av ring" src="avatar.jpg" alt="">')}
      ${row('close', 'Close friends', '6 people', '<img class="av cf" src="avatar.jpg" alt="">')}
    </div>` : '';
  $('sbody').innerHTML = postTo + `<div class="shd"><h4>${q ? 'Results' : 'Recents & suggested'}</h4></div>` +
    (list.length ? `<div class="card">${list.map((p) => row(p.id, p.name, p.sub, `<img class="av" src="${p.img}" alt="">`)).join('')}</div>` : '<p style="text-align:center;color:rgba(255,255,255,.5);padding:20px">Nobody by that name</p>');
  icons(); renderBar();
}
function renderBar() {
  $('snames').innerHTML = [...picked.values()].map((n) => `<span>${n}</span>`).join('');
  $('sviews').innerHTML = `<i data-lucide="timer"></i>${VIEWS[vi]}`; icons();
  $('sbar').classList.toggle('on', picked.size > 0);
}
$('sbody').onclick = (e) => {
  const b = e.target.closest('.who'); if (!b) return;
  picked.has(b.dataset.id) ? picked.delete(b.dataset.id) : picked.set(b.dataset.id, b.dataset.name);
  b.classList.toggle('on'); renderBar();
};
$('stabs').onclick = (e) => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  if (b.dataset.t === 'new') return toast('New group', 'users-round');
  stab = b.dataset.t; $('stabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderSend();
};
$('sq').oninput = renderSend;
$('pSend').onclick = () => { picked.clear(); $('sq').value = ''; renderSend(); phone.classList.add('sending'); };
$('sBack').onclick = () => phone.classList.remove('sending');
$('sGo').onclick = () => {
  const n = picked.size;
  for (const id of picked.keys()) { const u = (sendUse[id] ||= { n: 0, t: 0 }); u.n++; u.t = Date.now(); }
  try { localStorage.setItem('pingo.sendUse', JSON.stringify(sendUse)); } catch { /* order resets */ }
  phone.classList.remove('sending'); $('retake').click();
  toast(`Sent to ${n === 1 ? [...picked.values()][0] : n + ' chats'}`, 'send');
};

icons();
