// Instagram's stories, in PINGO: the tray, the viewer, your viewers, and "Add to story" from a post.
import { $, icons, wait, face, ME, PEOPLE, toast, sheet, closeSheet } from './ui.js?v=2';
import { render } from './stickers.js?v=2';
import { openEditor } from './editor.js?v=12';

const pic = (id) => `https://picsum.photos/id/${id}/540/960`;
const inDays = (d) => new Date(Date.now() + d * 864e5).toISOString();
const KESARIYA = {
  name: 'Kesariya', artist: 'Pritam, Arijit Singh', start: 62,
  url: 'https://aac.saavncdn.com/871/c2febd353f3a076a406fa37510f31f9f_160.mp4',
  img: 'https://c.saavncdn.com/871/Brahmastra-Original-Motion-Picture-Soundtrack-Hindi-2022-20221006155213-150x150.jpg',
};
const P = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
let uid = 0; const sid = () => 's' + ++uid;

// ---------------- stories ----------------
const users = [
  { ...ME, mine: true, items: [] },
  { ...P.baani, items: [
    { id: sid(), type: 'image', src: pic(1062), ago: '2h', stickers: [
      { type: 'poll', x: .5, y: .6, d: { q: 'Chai ya coffee?', opts: ['CHAI', 'COFFEE'], votes: [34, 12] } },
      { type: 'loc', x: .5, y: .8, r: -4, d: { text: 'Indore' } }] },
    { id: sid(), type: 'image', src: pic(1043), ago: '1h', music: KESARIYA, stickers: [
      { type: 'countdown', x: .5, y: .34, d: { q: "Baani's birthday", to: inDays(2.4) } },
      { type: 'music', x: .5, y: .72, r: 3, d: KESARIYA }] },
  ] },
  { ...P.eddy, items: [
    { id: sid(), type: 'image', src: pic(1015), ago: '4h', cf: true, stickers: [
      { type: 'text', x: .5, y: .2, d: { text: 'late night drive', font: 'neon', color: '#ff7eb6', size: 40, anim: 'flicker' } },
      { type: 'question', x: .5, y: .62, d: { q: 'Ask me anything' } }] },
    { id: sid(), type: 'image', src: pic(1016), ago: '3h', cf: true, stickers: [
      { type: 'slider', x: .5, y: .55, d: { q: 'How hyped for the trip?', emoji: '😍', avg: .82 } }] },
  ] },
  { ...P.riya, items: [
    { id: sid(), type: 'video', src: 'beach.mp4', rev: 'beach-rev.mp4', boom: 'classic', ago: '32m', stickers: [
      { type: 'text', x: .5, y: .78, d: { text: 'golden hour', font: 'elegant', color: '#ffffff', size: 42, anim: 'type' } }] },
    { id: sid(), type: 'image', src: pic(1039), ago: '20m', stickers: [
      { type: 'quiz', x: .5, y: .55, d: { q: 'Where was this?', opts: ['Goa', 'Manali', 'Kerala'], right: 2 } }] },
  ] },
  { ...P.luffy, items: [
    { id: sid(), type: 'image', src: pic(1050), ago: '5h', stickers: [
      { type: 'clock', x: .5, y: .22, d: { at: Date.now() - 5 * 36e5 } },
      { type: 'men', x: .35, y: .7, r: -6, d: { text: 'baani' } },
      { type: 'link', x: .62, y: .8, d: { text: 'pingochat.xyz' } }] },
  ] },
  { ...P.kashish, items: [
    { id: sid(), type: 'image', src: pic(1044), ago: '8h', stickers: [
      { type: 'text', x: .5, y: .5, d: { text: 'new blog\nout now', font: 'type', color: '#ffffff', size: 30, bg: 'none', anim: 'type' } },
      { type: 'tag', x: .5, y: .66, r: 4, d: { text: 'weekendread' } }] },
  ] },
  { ...P.aarav, items: [{ id: sid(), type: 'image', src: pic(1018), ago: '9h', stickers: [] }] },
];
for (const u of users) u.seen = u.id === 'aarav' ? u.items.length : 0; // aarav's is already watched
const unseen = (u) => u.seen < u.items.length;
const cfOnly = (u) => u.items.length && u.items.every((i) => i.cf);

// who has looked at your story
const VIEWERS = PEOPLE.slice(0, 7).map((p, i) => ({ ...p, liked: i === 0 || i === 3 }));

// ---------------- the tray ----------------
function ringClass(u) {
  if (u.mine) return u.items.length ? (unseen(u) ? 'unseen' : 'seen') : 'none';
  if (!unseen(u)) return 'seen';
  return cfOnly(u) ? 'cf' : 'unseen';
}
function renderTray() {
  const me = users[0];
  const others = users.slice(1).sort((a, b) => unseen(b) - unseen(a));
  $('tray').innerHTML = [me, ...others].map((u) => `
    <button class="tr" data-u="${u.id}">
      <span class="ring ${ringClass(u)}" data-ring="${u.id}"><img src="${u.avatar}" alt="">${u.mine ? '<span class="plus" data-plus><i data-lucide="plus"></i></span>' : ''}</span>
      <span class="n">${u.mine ? 'Your story' : u.name}</span>
    </button>`).join('');
  icons();
}
$('tray').onclick = async (e) => {
  const b = e.target.closest('.tr'); if (!b) return;
  const u = users.find((x) => x.id === b.dataset.u);
  if (u.mine && (e.target.closest('[data-plus]') || !u.items.length)) return pickMedia();
  const ring = b.querySelector('.ring');
  // Instagram's dashed ring spins while the first story loads
  const was = ring.className; ring.className = 'ring loading';
  await Promise.race([preload(u.items[Math.min(u.seen, u.items.length - 1)]), wait(1000)]);
  await wait(260);
  ring.className = was;
  openViewer(users.indexOf(u), ring);
};
function preload(item) {
  if (!item || item.type !== 'image') return Promise.resolve();
  return new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = item.src; });
}

// ---------------- the viewer ----------------
const viewer = $('viewer'), cube = $('cube');
let order = [];      // user indexes in tray order
let pos = 0;         // position in `order`
let face1;           // the face on screen
let run;             // playback state for that face
const audio = new Audio(); audio.crossOrigin = 'anonymous';

function openViewer(ui, ring) {
  order = [0, ...users.slice(1).map((u, i) => i + 1).sort((a, b) => unseen(users[b]) - unseen(users[a]))].filter((i) => users[i].items.length);
  pos = order.indexOf(ui);
  viewer.classList.add('on');
  cube.style.transition = 'none'; cube.style.transform = cubeAt(0);
  face1 = buildFace(ui); cube.replaceChildren(face1); placeFace(face1, 0);
  start(face1, Math.min(users[ui].seen, users[ui].items.length - 1));
  // grow out of the ring
  const r = ring.getBoundingClientRect(), p = $('phone').getBoundingClientRect();
  const cx = r.left - p.left + r.width / 2, cy = r.top - p.top + r.height / 2, R = Math.hypot(p.width, p.height);
  viewer.animate([
    { clipPath: `circle(${r.width / 2}px at ${cx}px ${cy}px)` },
    { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  cube.animate([{ transform: `${cubeAt(0)} scale(.35)`, transformOrigin: `${cx}px ${cy}px` }, { transform: `${cubeAt(0)} scale(1)`, transformOrigin: `${cx}px ${cy}px` }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
async function closeViewer() {
  stop();
  const u = users[order[pos]];
  renderTray(); renderChats(); if (who) openProfileRing();
  // back into the ring it came from: the profile's when that is open, the tray's otherwise
  const ring = document.querySelector(`#profile.on [data-ring="${u.id}"]`) || document.querySelector(`#tray [data-ring="${u.id}"]`), p = $('phone').getBoundingClientRect();
  const r = ring?.getBoundingClientRect() || { left: p.left + p.width / 2 - 35, top: p.top + 60, width: 70, height: 70 };
  const cx = r.left - p.left + r.width / 2, cy = r.top - p.top + r.height / 2, R = Math.hypot(p.width, p.height);
  const cur = getComputedStyle(cube).transform;
  const a = viewer.animate([{ clipPath: `circle(${R}px at ${cx}px ${cy}px)`, opacity: 1 }, { clipPath: `circle(${r.width / 2}px at ${cx}px ${cy}px)`, opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.4,0,.2,1)' });
  cube.animate([{ transform: cur === 'none' ? cubeAt(0) : cur }, { transform: `${cubeAt(0)} scale(.3)`, transformOrigin: `${cx}px ${cy}px` }], { duration: 340, easing: 'cubic-bezier(.4,0,.2,1)' });
  await a.finished;
  viewer.classList.remove('on'); viewer.style.background = ''; cube.replaceChildren();
}

const W = () => viewer.clientWidth;
const cubeAt = (deg) => `translateZ(${-W() / 2}px) rotateY(${deg}deg)`;
function placeFace(f, side) { f.style.transform = `rotateY(${side * 90}deg) translateZ(${W() / 2}px)`; }

function buildFace(ui) {
  const u = users[ui], mine = !!u.mine;
  const f = document.createElement('div'); f.className = 'face'; f._u = ui;
  f.innerHTML = `
    <div class="stage"><div class="layer"></div><div class="grad-top"></div></div>
    <div class="bars">${u.items.map(() => '<i><b></b></i>').join('')}</div>
    <div class="vhead">
      <img src="${u.avatar}" alt="">
      <div class="who"><div class="l1">${mine ? 'Your story' : u.name} <span class="ago"></span><span class="cfb" hidden><i data-lucide="star"></i>Close friends</span></div><div class="song" hidden><i data-lucide="music-2"></i><span class="mq"></span></div></div>
      <span class="sp"></span>
      <button class="vb" data-act="more" aria-label="More"><i data-lucide="more-horizontal"></i></button>
      <button class="vb" data-act="close" aria-label="Close"><i data-lucide="x"></i></button>
    </div>
    <div class="zones"><div data-z="prev"></div><div data-z="next"></div></div>
    <div class="quick"><h5>Quick reactions</h5><div class="qg">${['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'].map((e) => `<button data-q="${e}">${e}</button>`).join('')}</div></div>
    <div class="vfoot">${mine
      ? `<button class="act" data-act="activity"><span class="faces">${VIEWERS.slice(0, 3).map((v) => `<img src="${v.avatar}" alt="">`).join('')}</span>Activity</button><span class="sp"></span>
         <button class="fb" data-act="highlight" aria-label="Highlight"><i data-lucide="circle-plus"></i></button><button class="fb" data-act="send" aria-label="Send"><i data-lucide="send"></i></button><button class="fb" data-act="more" aria-label="More"><i data-lucide="more-vertical"></i></button>`
      : `<label class="reply"><input placeholder="Send message" enterkeyhint="send"></label>
         <button class="fb" data-act="like" aria-label="Like"><i data-lucide="heart"></i></button><button class="fb" data-act="send" aria-label="Send"><i data-lucide="send"></i></button>`}</div>`;
  icons();
  const input = f.querySelector('.reply input');
  if (input) {
    input.onfocus = () => { f.classList.add('typing'); pause(true, 'typing'); };
    input.onblur = () => setTimeout(() => { if (!input.value) { f.classList.remove('typing'); pause(false, 'typing'); } }, 120);
    input.onkeydown = (e) => { if (e.key === 'Enter') sendReply(f); };
  }
  return f;
}

function showItem(f, ii) {
  const u = users[f._u], item = u.items[ii];
  const stage = f.querySelector('.stage');
  stage.querySelectorAll('.media, .ink').forEach((n) => n.remove());
  let media;
  if (item.type === 'video') {
    media = document.createElement('video'); media.playsInline = true; media.muted = !!item.music; media.src = item.src;
    boomerang(media, item);
  } else { media = document.createElement('img'); media.src = item.src; }
  media.className = 'media'; if (item.filter) media.style.filter = item.filter;
  if (item.bg) stage.style.background = item.bg; else stage.style.background = '';
  stage.prepend(media);
  if (item.ink) { const ink = document.createElement('img'); ink.className = 'ink'; ink.src = item.ink; stage.querySelector('.layer').before(ink); }
  const layer = stage.querySelector('.layer'); layer.replaceChildren(...item.stickers.map((s) => { s.state ||= {}; const el = render(s, 'view'); wire(el, s, f); return el; }));
  f.querySelector('.ago').textContent = item.ago || 'now';
  f.querySelector('.cfb').hidden = !item.cf;
  const song = f.querySelector('.song');
  song.hidden = !item.music;
  if (item.music) song.querySelector('.mq').textContent = `${item.music.name} · ${item.music.artist}`;
  f.querySelectorAll('.bars b').forEach((b, i) => { b.style.width = i < ii ? '100%' : '0%'; });
  if (item.caption) { let c = stage.querySelector('.vcap'); if (!c) { c = document.createElement('div'); c.className = 'vcap caption'; c.style.bottom = '12px'; stage.append(c); } c.textContent = item.caption; }
  else stage.querySelector('.vcap')?.remove();
  return media;
}

// Boomerang modes, as recorded: classic plays forwards then back, slow-mo at half speed,
// echo leaves a trail, duo ramps the speed.
function boomerang(v, item) {
  const mode = item.boom || 'off';
  v.loop = mode === 'off';
  v.playbackRate = mode === 'slowmo' ? 0.5 : 1;
  const a = item.trim?.[0] || 0, b = item.trim?.[1];
  let back = false;
  v.addEventListener('loadedmetadata', () => { v.currentTime = a * v.duration; });
  v.addEventListener('timeupdate', () => {
    const end = (b ?? 1) * v.duration;
    if (mode === 'duo') v.playbackRate = 0.4 + 1.6 * Math.abs(Math.sin(v.currentTime * 2));
    if (v.currentTime >= end - 0.05) {
      if (mode === 'off' || !item.rev) { v.currentTime = a * v.duration; v.play().catch(() => {}); return; }
      // swap to the reversed file for the way back, like a real boomerang
      back = !back; const t = v.currentTime;
      v.src = back ? item.rev : item.src;
      v.addEventListener('loadedmetadata', () => { v.currentTime = back ? v.duration - t : a * v.duration; v.play().catch(() => {}); }, { once: true });
    }
  });
  if (mode === 'echo') {
    const e2 = document.createElement('video'); e2.className = 'media'; e2.src = item.src; e2.muted = true; e2.loop = true; e2.playsInline = true;
    e2.style.cssText = 'opacity:.4;mix-blend-mode:screen;transform:scale(1.02)';
    v.addEventListener('play', () => { setTimeout(() => e2.play().catch(() => {}), 140); });
    v.after(e2);
  }
}

// ---------------- playback ----------------
const holds = new Set();
function start(f, ii) {
  stop();
  const u = users[f._u];
  const media = showItem(f, ii);
  run = { f, ii, t: 0, dur: window.__storyDur || 5000, last: performance.now(), media };
  // the clock waits for the picture, as Instagram's does
  const stageEl = f.querySelector('.stage');
  const ready = () => { stageEl.classList.remove('loading'); if (run?.media === media) { run.loading = false; run.last = performance.now(); } };
  if (media.tagName === 'IMG' ? !media.complete : media.readyState < 3) {
    run.loading = true; stageEl.classList.add('loading');
    media.addEventListener(media.tagName === 'IMG' ? 'load' : 'canplay', ready, { once: true });
    media.addEventListener('error', ready, { once: true });
  }
  if (media.tagName === 'VIDEO') {
    media.addEventListener('loadedmetadata', () => { if (run?.media === media) run.dur = Math.min(15000, Math.max(3000, (media.duration || 5) * (media.loop ? 1000 : 2000))); });
    media.play().catch(() => {});
  }
  const item = u.items[ii];
  if (item.music) { audio.src = item.music.url; audio.currentTime = item.music.start || 0; audio.play().catch(() => {}); }
  else audio.pause();
  u.seen = Math.max(u.seen, ii + 1);
  requestAnimationFrame(tick);
}
function stop() { run = undefined; audio.pause(); }
function tick(now) {
  if (!run) return;
  const r = run;
  if (!holds.size && !r.loading) r.t += now - r.last;
  r.last = now;
  const bar = r.f.querySelectorAll('.bars b')[r.ii];
  if (bar) bar.style.width = `${Math.min(100, (r.t / r.dur) * 100)}%`;
  if (r.t >= r.dur) return next();
  requestAnimationFrame(tick);
}
function pause(on, why) {
  on ? holds.add(why) : holds.delete(why);
  const v = run?.media;
  if (holds.size) { v?.pause?.(); audio.pause(); }
  else { if (v?.tagName === 'VIDEO') v.play().catch(() => {}); if (users[run?.f._u]?.items[run.ii]?.music) audio.play().catch(() => {}); }
}
function next() {
  if (!run) return;
  const u = users[run.f._u];
  if (run.ii < u.items.length - 1) return start(run.f, run.ii + 1);
  if (pos < order.length - 1) return turn(1);
  closeViewer();
}
function prev() {
  if (!run) return;
  if (run.ii > 0) return start(run.f, run.ii - 1);
  if (pos > 0) return turn(-1);
  start(run.f, 0);
}

// the cube: the next person's stories come round the corner
async function turn(dir, fromDeg = 0) {
  stop();
  const ui = order[pos + dir];
  const nf = buildFace(ui); placeFace(nf, dir); cube.append(nf);
  showItem(nf, Math.min(users[ui].seen, users[ui].items.length - 1));
  cube.style.transition = 'none'; cube.style.transform = cubeAt(fromDeg); void cube.offsetWidth;
  cube.style.transition = 'transform .42s cubic-bezier(.3,.7,.2,1)'; cube.style.transform = cubeAt(-dir * 90);
  await wait(430);
  face1.remove(); face1 = nf; pos += dir;
  cube.style.transition = 'none'; placeFace(nf, 0); cube.style.transform = cubeAt(0);
  start(nf, Math.min(users[ui].seen, users[ui].items.length - 1));
}

// ---------------- gestures ----------------
let g;
viewer.addEventListener('pointerdown', (e) => {
  if (!run || e.target.closest('.vfoot, .vhead button, .quick, .tipb, .knob')) return;
  if (!e.target.closest('.tipb')) document.querySelector('.tipb')?.remove();
  // Holding or swiping works from anywhere, stickers included. On a sticker the pointer is not
  // captured, so a plain tap still reaches the sticker's own click.
  const onSticker = !!e.target.closest('.stk');
  g = { x: e.clientX, y: e.clientY, t: performance.now(), axis: null, dx: 0, dy: 0, onSticker };
  g.hold = setTimeout(() => { if (!g) return; g.held = true; run.f.classList.add('paused'); pause(true, 'hold'); }, 200);
  if (!onSticker) viewer.setPointerCapture(e.pointerId);
});
viewer.addEventListener('pointermove', (e) => {
  if (!g) return;
  g.dx = e.clientX - g.x; g.dy = e.clientY - g.y;
  if (!g.axis && Math.hypot(g.dx, g.dy) > 10) { g.axis = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y'; clearTimeout(g.hold); pause(true, 'drag'); }
  if (g.axis === 'x') {
    const dir = g.dx < 0 ? 1 : -1;
    if (pos + dir < 0 || pos + dir >= order.length) { cube.style.transform = cubeAt(-g.dx / W() * 20); return; }
    if (!g.nf || g.dir !== dir) { g.nf?.remove(); g.dir = dir; g.nf = buildFace(order[pos + dir]); placeFace(g.nf, dir); cube.append(g.nf); showItem(g.nf, Math.min(users[order[pos + dir]].seen, users[order[pos + dir]].items.length - 1)); }
    cube.style.transition = 'none'; cube.style.transform = cubeAt(Math.max(-90, Math.min(90, (g.dx / W()) * 90)));
  } else if (g.axis === 'y' && g.dy > 0) {
    const k = Math.min(1, g.dy / 500);
    cube.style.transition = 'none'; cube.style.transform = `${cubeAt(0)} translateY(${g.dy}px) scale(${1 - k * 0.35})`;
    viewer.style.background = `rgba(0,0,0,${1 - k})`;
  }
});
// a hold or a swipe is not also a tap on whatever sticker it started on
let swallow = false;
viewer.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); swallow = false; } }, true);
viewer.addEventListener('pointerup', async (e) => {
  if (!g) return; const s = g; g = undefined; clearTimeout(s.hold);
  if (s.held || s.axis) { swallow = true; setTimeout(() => (swallow = false), 60); }
  if (s.held && !s.axis) { run?.f.classList.remove('paused'); pause(false, 'hold'); return; }
  if (!s.axis) {
    pause(false, 'drag');
    if (s.onSticker) return; // the sticker's own tap
    const r = viewer.getBoundingClientRect();
    return (e.clientX - r.left) < r.width * 0.3 ? prev() : next();
  }
  if (s.axis === 'x') {
    if (s.nf && Math.abs(s.dx) > W() * 0.25) { s.nf.remove(); pause(false, 'drag'); return turn(s.dir, (s.dx / W()) * 90); }
    cube.style.transition = 'transform .3s ease'; cube.style.transform = cubeAt(0);
    await wait(300); s.nf?.remove(); pause(false, 'drag'); return;
  }
  // vertical: down closes, up opens activity (yours) or the reply (theirs)
  if (s.dy > 120) { pause(false, 'drag'); return closeViewer(); }
  cube.style.transition = 'transform .3s ease'; cube.style.transform = cubeAt(0); viewer.style.background = '';
  pause(false, 'drag');
  if (s.dy < -70) { users[order[pos]].mine ? openActivity() : run?.f.querySelector('.reply input')?.focus({ preventScroll: true }); }
});

// ---------------- footer and header actions ----------------
viewer.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act], [data-q]'); if (!b || !run) return;
  const f = run.f;
  if (b.dataset.q) return react(f, b.dataset.q);
  switch (b.dataset.act) {
    case 'close': return closeViewer();
    case 'like': {
      b.classList.toggle('liked');
      if (b.classList.contains('liked')) for (let i = 0; i < 6; i++) {
        const h = document.createElement('span'); h.className = 'mini-heart'; h.innerHTML = '♥';
        h.style.setProperty('--dx', `${(Math.random() - .5) * 60}px`); h.style.animationDelay = `${i * 60}ms`; b.append(h); setTimeout(() => h.remove(), 1200);
      }
      return;
    }
    case 'send': return shareStory();
    case 'activity': return openActivity();
    case 'highlight': return toast('Added to highlight "Weekend"', 'circle-plus');
    case 'more': return moreMenu();
  }
});
function sendReply(f) {
  const i = f.querySelector('.reply input'); if (!i.value.trim()) return;
  i.value = ''; i.blur(); f.classList.remove('typing'); pause(false, 'typing'); toast(`Reply sent to ${users[f._u].name}`, 'send');
}
function react(f, emo) {
  for (let k = 0; k < 9; k++) {
    const n = document.createElement('span'); n.className = 'burst'; n.textContent = emo;
    n.style.left = `${10 + Math.random() * 75}%`; n.style.setProperty('--dx', `${(Math.random() - .5) * 120}px`); n.style.setProperty('--rot', `${(Math.random() - .5) * 60}deg`);
    n.style.animationDelay = `${k * 70}ms`; $('phone').append(n); setTimeout(() => n.remove(), 2400);
  }
  const i = f.querySelector('.reply input'); i.value = ''; i.blur(); f.classList.remove('typing'); pause(false, 'typing');
  toast('Reaction sent', 'send');
}
function moreMenu() {
  pause(true, 'sheet');
  const mine = users[order[pos]].mine;
  const rows = mine ? [['trash-2', 'Delete', 'del'], ['download', 'Save', 'save'], ['circle-plus', 'Highlight', 'hl'], ['send', 'Send to…', 'send'], ['sliders-horizontal', 'Story settings', 'set']]
    : [['flag', 'Report', 'r'], ['bell-off', 'Mute', 'mute'], ['user-round', 'About this account', 'about'], ['link', 'Copy link', 'copy']];
  const sh = sheet(`<div class="sbody">${rows.map(([ic, t, k]) => `<button class="row" data-k="${k}" style="width:100%"><span class="rb"><i data-lucide="${ic}"></i></span><span class="t"><b style="font-weight:600;${k === 'del' || k === 'r' ? 'color:#ff3040' : ''}">${t}</b></span></button>`).join('')}</div>`,
    { dark: true, onClose: () => pause(false, 'sheet') });
  sh.querySelector('.sbody').onclick = (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
    closeSheet();
    if (k === 'del') return deleteCurrent();
    if (k === 'send') return shareStory();
    toast({ save: 'Saved to your phone', hl: 'Added to highlight', mute: `Muted ${users[order[pos]].name}'s story`, r: 'Thanks for letting us know', copy: 'Link copied', about: 'Joined PINGO in 2026', set: 'Story settings' }[k] || 'Done');
  };
}
function deleteCurrent() {
  const u = users[order[pos]]; u.items.splice(run.ii, 1); u.seen = Math.min(u.seen, u.items.length);
  toast('Story deleted', 'trash-2');
  if (!u.items.length) return closeViewer();
  const f = buildFace(order[pos]); face1.replaceWith(f); face1 = f; placeFace(f, 0); start(f, Math.min(run?.ii ?? 0, u.items.length - 1));
}
function shareStory() {
  pause(true, 'sheet');
  const sh = sheet(`<h3>Send to</h3><label class="ssearch"><i data-lucide="search"></i><input placeholder="Search"></label>
    <div class="sbody">${PEOPLE.map((p) => `<div class="row"><img class="av" src="${p.avatar}" alt=""><span class="t"><b>${p.full}</b><span>${p.name}</span></span><button class="btn" data-p="${p.id}">Send</button></div>`).join('')}</div>`,
    { dark: true, onClose: () => pause(false, 'sheet') });
  sh.querySelector('.sbody').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b || b.classList.contains('sent')) return; b.classList.add('sent'); b.textContent = 'Sent'; };
}

// ---------------- your viewers (image 2) ----------------
function openActivity() {
  pause(true, 'sheet');
  const u = users[0];
  const sh = sheet(`
    <div class="thumbs">${u.items.map((it, i) => `<img src="${it.poster || it.src}" class="${i === run.ii ? 'cur' : ''}" data-i="${i}" alt="">`).join('')}<span class="cam"><i data-lucide="camera"></i></span></div>
    <div class="stats"><span class="eye"><i data-lucide="eye"></i>${VIEWERS.length}</span>
      <button aria-label="Insights"><i data-lucide="chart-no-axes-column"></i></button><button aria-label="Share"><i data-lucide="send"></i></button><button aria-label="Save"><i data-lucide="download"></i></button><button aria-label="Delete" data-del><i data-lucide="trash-2"></i></button></div>
    <div class="sbody"><div class="vh"><span>Viewers</span><span style="font-weight:500;color:#a1a1a6">${VIEWERS.filter((v) => v.liked).length} likes</span></div>
      ${VIEWERS.map((v) => `<div class="row"><span class="avw"><img class="av" src="${v.avatar}" alt="">${v.liked ? '<span class="lk"><i data-lucide="heart"></i></span>' : ''}</span><span class="t"><b>${v.name}</b><span>${v.full}</span></span><button class="rb" aria-label="More"><i data-lucide="more-vertical"></i></button><button class="rb" aria-label="Message"><i data-lucide="send"></i></button></div>`).join('')}</div>`,
    { dark: true, cls: 'actsheet', onClose: () => pause(false, 'sheet') });
  sh.querySelector('.thumbs').onclick = (e) => { const t = e.target.closest('[data-i]'); if (!t) return; closeSheet(); start(run.f, +t.dataset.i); };
  sh.querySelector('[data-del]').onclick = () => { closeSheet(); deleteCurrent(); };
}

// ---------------- sticker taps in the viewer ----------------
function tipAt(el, html) {
  document.querySelector('.tipb')?.remove();
  const r = el.getBoundingClientRect(), p = $('phone').getBoundingClientRect();
  const t = document.createElement('div'); t.className = 'tipb'; t.innerHTML = html;
  t.style.left = `${r.left - p.left + r.width / 2}px`; t.style.top = `${r.top - p.top - 8}px`;
  $('phone').append(t); icons(); setTimeout(() => t.remove(), 2400);
}
function wire(el, s, f) {
  const d = s.d;
  el.addEventListener('click', (e) => {
    switch (s.type) {
      case 'poll': {
        const o = e.target.closest('.opt'); if (!o || s.state.vote !== undefined) return;
        s.state.vote = +o.dataset.i; el.innerHTML = render(s, 'view').innerHTML;
        requestAnimationFrame(() => { const tot = d.votes[0] + d.votes[1] + 1; el.querySelectorAll('.fill').forEach((fl, i) => { fl.style.width = '0%'; requestAnimationFrame(() => { fl.style.width = `${Math.round(((d.votes[i] + (s.state.vote === i)) / tot) * 100)}%`; }); }); });
        return;
      }
      case 'quiz': {
        const o = e.target.closest('.o'); if (!o || s.state.pick !== undefined) return;
        s.state.pick = +o.dataset.i; el.innerHTML = render(s, 'view').innerHTML;
        if (s.state.pick === d.right) confetti(el);
        return;
      }
      case 'countdown': if (e.target.closest('.remind')) { s.state.remind = !s.state.remind; el.innerHTML = render(s, 'view').innerHTML; toast(s.state.remind ? "We'll remind you" : 'Reminder off', 'bell'); } return;
      case 'question': {
        pause(true, 'sheet');
        const sh = sheet(`<div class="sbody" style="padding-top:4px"><div class="card question" style="width:100%"><div class="q">${d.q}</div><div class="ans" style="background:#fff;padding:0"><input id="qa" placeholder="Type something…" style="width:100%;border:0;outline:0;padding:14px;border-radius:12px;color:#111;font-size:15px;text-align:center"></div></div><button class="btn" id="qs" style="margin-top:14px;width:100%;padding:12px;border-radius:12px;background:#0a84ff;color:#fff;font-weight:700">Send</button></div>`, { onClose: () => pause(false, 'sheet') });
        setTimeout(() => sh.querySelector('#qa').focus({ preventScroll: true }), 300);
        sh.querySelector('#qs').onclick = () => { closeSheet(); toast('Response sent', 'send'); };
        return;
      }
      case 'loc': return tipAt(el, `<i data-lucide="map-pin"></i>See ${d.text} on the map`);
      case 'men': return tipAt(el, `<img src="${P[d.text]?.avatar || face(1)}" style="width:22px;height:22px;border-radius:50%">View profile`);
      case 'link': return tipAt(el, `<i data-lucide="external-link"></i>Open ${d.text}`);
      case 'tag': return tipAt(el, `<i data-lucide="hash"></i>See #${d.text}`);
      case 'music': return tipAt(el, `<i data-lucide="music-2"></i>${d.name} · Play full song`);
      case 'post': return tipAt(el, `<i data-lucide="image"></i>View post`);
    }
  });
  if (s.type === 'slider') {
    const track = el.querySelector('.track'), knob = el.querySelector('.knob'), done = el.querySelector('.done');
    knob.addEventListener('pointerdown', (e) => {
      if (s.state.v !== undefined) return;
      e.stopPropagation(); knob.setPointerCapture(e.pointerId); pause(true, 'slide');
      const move = (ev) => { const r = track.getBoundingClientRect(); const v = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); knob.style.left = done.style.width = `${v * 100}%`; knob.style.fontSize = `${34 + v * 26}px`; knob._v = v; };
      knob.onpointermove = move; move(e);
      knob.onpointerup = () => {
        knob.onpointermove = knob.onpointerup = null; s.state.v = knob._v ?? 0; pause(false, 'slide');
        el.querySelector('.slider').classList.add('answered'); knob.style.fontSize = '';
        const fly = document.createElement('span'); fly.className = 'burst'; fly.textContent = d.emoji; const r = knob.getBoundingClientRect(), p = $('phone').getBoundingClientRect();
        fly.style.left = `${r.left - p.left}px`; fly.style.bottom = `${p.bottom - r.top}px`; fly.style.setProperty('--dx', '0px'); fly.style.setProperty('--rot', '0deg'); $('phone').append(fly); setTimeout(() => fly.remove(), 1700);
      };
    });
  }
}
function confetti(el) {
  const r = el.getBoundingClientRect(), p = $('phone').getBoundingClientRect();
  for (let i = 0; i < 26; i++) {
    const c = document.createElement('span');
    c.style.cssText = `position:absolute;z-index:30;left:${r.left - p.left + r.width / 2}px;top:${r.top - p.top + 20}px;width:8px;height:12px;border-radius:2px;background:hsl(${Math.random() * 360} 90% 60%);pointer-events:none`;
    $('phone').append(c);
    c.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${(Math.random() - .5) * 320}px, ${-120 - Math.random() * 200}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' }).finished.then(() => c.remove());
  }
}

// ---------------- making one ----------------
const GALLERY = [1025, 1011, 1062, 1043, 1015, 1039, 1050, 1016, 1044, 1018, 1036, 1027];
function pickMedia() {
  let gal = document.querySelector('.gal');
  if (!gal) {
    gal = document.createElement('section'); gal.className = 'gal';
    gal.innerHTML = `<header><button data-x aria-label="Close"><i data-lucide="x"></i></button><span>Add to story</span><span class="sp"></span><i data-lucide="settings"></i></header>
      <div class="gtabs"><button><i data-lucide="layout-template"></i>Templates</button><button><i data-lucide="music-2"></i>Music</button><button><i data-lucide="images"></i>Collage</button></div>
      <div class="ggrid"><a class="cam" href="camera.html" style="display:grid;place-items:center;background:#1c1c1e;aspect-ratio:9/16;color:#fff;font-size:30px"><i data-lucide="camera"></i></a>
        <button data-v><video src="beach.mp4#t=1" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover"></video><span class="dur">0:04</span></button>
        ${GALLERY.map((id) => `<button data-id="${id}"><img src="https://picsum.photos/id/${id}/240/426" alt="" loading="lazy"></button>`).join('')}</div>`;
    $('phone').append(gal); icons();
    gal.onclick = (e) => {
      if (e.target.closest('[data-x]')) return gal.classList.remove('on');
      const v = e.target.closest('[data-v]'), p = e.target.closest('[data-id]');
      if (!v && !p) return;
      gal.classList.remove('on');
      openEditor(v ? { type: 'video', src: 'beach.mp4', rev: 'beach-rev.mp4', poster: 'beach.jpg' } : { type: 'image', src: pic(+p.dataset.id) }, { onShare: postStory });
    };
  }
  gal.classList.add('on');
}

// The finished story flies into your ring, which spins while it "uploads".
async function postStory(item, cf, rect) {
  const me = users[0];
  item.id = sid(); item.ago = 'now'; item.cf = cf;
  const ring = document.querySelector('[data-ring="me"]'), p = $('phone').getBoundingClientRect();
  const fly = document.createElement('div'); fly.className = 'fly';
  fly.innerHTML = `<img src="${item.poster || item.src}" alt="" style="${item.filter ? `filter:${item.filter}` : ''}">`;
  Object.assign(fly.style, { left: `${rect.left - p.left}px`, top: `${rect.top - p.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  $('phone').append(fly); await wait(30);
  const r = ring.getBoundingClientRect();
  Object.assign(fly.style, { left: `${r.left - p.left}px`, top: `${r.top - p.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '50%', opacity: '.4' });
  await wait(560); fly.remove();
  ring.className = 'ring loading';
  await wait(1400);
  me.items.push(item); me.seen = me.items.length - 1;
  renderTray(); renderChats();
  toast(cf ? 'Shared with close friends' : 'Shared to your story', 'circle-check');
}

// ---------------- the chat list, a profile, a post ----------------
const PREVIEW = { baani: ['Kal milte hai phir', '8:37 PM'], eddy: ['Khao bhai khao', '8:12 PM'], riya: ['sent a photo', '7:40 PM'], luffy: ['Mere ko aapki game khelni h', '1:33 PM'],
  kashish: ['haha yes', 'Yesterday'], aarav: ['manali pakka', 'Yesterday'], harsh: ['Unpaid Intern', 'Aug 3'], sonu: ['ok', 'Aug 1'] };
function renderChats() {
  $('chats').innerHTML = PEOPLE.map((p) => {
    const u = users.find((x) => x.id === p.id);
    const ring = !u?.items.length ? '' : !unseen(u) ? 'seenring' : cfOnly(u) ? 'cfring' : 'story';
    const [msg, at] = PREVIEW[p.id] || ['', ''];
    return `<button class="crow" data-p="${p.id}"><span class="cav ${ring}"><img src="${p.avatar}" alt=""></span><span class="ct"><span class="l1">${p.full}<span>${at}</span></span><p>${msg}</p></span></button>`;
  }).join('');
}
$('chats').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) openProfile(b.dataset.p); };

const POSTS = { baani: [1025, 1062, 1043, 1080, 1084, 1074, 1069, 1060, 1070], eddy: [1015, 1016, 1036, 1039], riya: [1011, 1039, 1044, 1050, 1018, 1027] };
let who;
function openProfile(id) {
  who = PEOPLE.find((p) => p.id === id);
  const u = users.find((x) => x.id === id), posts = POSTS[id] || [1018, 1036, 1043, 1050, 1062, 1025];
  $('profile').innerHTML = `
    <div class="phead"><button data-pa="back" aria-label="Back"><i data-lucide="chevron-left"></i></button><b>${who.name}</b><button aria-label="More"><i data-lucide="more-horizontal"></i></button></div>
    <div class="pcover" style="background-image:url(https://picsum.photos/id/${posts[1]}/800/300)"></div>
    <div class="ptop"><span class="ring ${u ? ringClass(u) : 'none'}" data-ring="${id}" data-pa="story"><img src="${who.avatar}" alt=""></span></div>
    <div class="pname"><b>${who.full}</b><span>@${who.name}</span><p>chai, code and long drives</p></div>
    <div class="pstats"><div><b>${posts.length}</b><span>Posts</span></div><div><b>182</b><span>Friends</span></div><div><b>6</b><span>Groups</span></div></div>
    <div class="pbtns"><button class="pri">Message</button><button>Friends</button></div>
    <div class="pgrid">${posts.map((n, k) => `<button data-post="${k}"><img src="https://picsum.photos/id/${n}/360/450" alt=""></button>`).join('')}</div>`;
  $('profile').classList.add('on'); icons();
  $('profile').onclick = (e) => {
    const a = e.target.closest('[data-pa]')?.dataset.pa;
    if (a === 'back') return $('profile').classList.remove('on');
    if (a === 'story' && u?.items.length) return openViewer(users.indexOf(u), e.target.closest('.ring'));
    const p = e.target.closest('[data-post]'); if (p) openPost(posts[+p.dataset.post]);
  };
}
function openPost(n) {
  const src = `https://picsum.photos/id/${n}/900/1125`;
  $('postview').innerHTML = `
    <div class="phead"><button data-v="back" aria-label="Back"><i data-lucide="chevron-left"></i></button><b>Posts</b></div>
    <article class="post"><header><img src="${who.avatar}" alt=""><div><b>${who.name}</b><span>Indore</span></div><i data-lucide="more-horizontal"></i></header>
      <img class="pimg" src="${src}" alt="">
      <footer><button class="pa" data-v="like" aria-label="Like"><i data-lucide="heart"></i></button><span class="pc">29</span>
        <button class="pa" aria-label="Comment"><i data-lucide="message-circle"></i></button><span class="pc">3</span>
        <button class="pa" data-v="share" aria-label="Share"><i data-lucide="send"></i></button><span class="pc">2</span>
        <span class="sp"></span><button class="pa" aria-label="Save"><i data-lucide="bookmark"></i></button></footer>
      <p class="cap"><b>${who.name}</b> sunday naps are a personality now</p></article>`;
  $('postview').classList.add('on'); icons();
  $('postview').onclick = (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    if (b.dataset.v === 'back') return $('postview').classList.remove('on');
    if (b.dataset.v === 'like') { b.classList.toggle('liked'); b.nextElementSibling.textContent = b.classList.contains('liked') ? 30 : 29; return; }
    sharePost(src, who);
  };
}
function sharePost(src, owner) {
  const picked = new Set();
  const acts = `
      <button data-a="story"><span class="ic"><i data-lucide="circle-plus"></i></span>Add to story</button>
      <button data-a="cf"><span class="ic" style="background:#1fc15e;color:#fff"><i data-lucide="star"></i></span>Close friends</button>
      <button data-a="copy"><span class="ic"><i data-lucide="link"></i></span>Copy link</button>
      <button data-a="share"><span class="ic"><i data-lucide="share"></i></span>Share to…</button>
      <button data-a="dl"><span class="ic"><i data-lucide="download"></i></span>Download</button>`;
  const sh = sheet(`<label class="ssearch"><i data-lucide="search"></i><input placeholder="Search"></label>
    <div class="sbody"><div class="sgridp">${PEOPLE.filter((p) => p.id !== owner.id).map((p) => `<button data-p="${p.id}"><img src="${p.avatar}" alt=""><span>${p.full}</span></button>`).join('')}</div></div>
    <div class="shareacts" id="sacts">${acts}</div>`);
  sh.querySelector('.sgridp').onclick = (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    picked.has(b.dataset.p) ? picked.delete(b.dataset.p) : picked.add(b.dataset.p); b.classList.toggle('on');
    sh.querySelector('#sacts').innerHTML = picked.size ? `<input placeholder="Write a message…" style="flex:1;border:0;outline:0;background:#efefef;border-radius:10px;padding:0 12px;height:44px"><button data-a="send" style="width:auto;flex:none;padding:0 18px;border-radius:10px;background:#0a84ff;color:#fff;font-weight:700;height:44px">Send</button>` : acts;
    icons();
  };
  sh.querySelector('#sacts').onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    closeSheet();
    if (a === 'send') return toast(`Sent to ${picked.size}`, 'send');
    if (a === 'story' || a === 'cf') {
      // open at once on a soft default; the photo's own colours arrive a moment later
      const m = { type: 'post', src, bg: 'linear-gradient(160deg,#3a3a40,#1c1c1e)' };
      dominant(src).then((bg) => { m.bg = bg; const f = document.querySelector('#estage .bgfill'); if (f) { f.style.transition = 'background .5s'; f.style.background = bg; } });
      openEditor(m, { onShare: (it, cf, r) => { $('postview').classList.remove('on'); $('profile').classList.remove('on'); postStory(it, cf || a === 'cf', r); },
        stickers: [{ type: 'post', x: .5, y: .46, s: 1.15, d: { src, user: owner.name, avatar: owner.avatar } }] });
      return;
    }
    toast({ copy: 'Link copied', share: 'Opening share…', dl: 'Saved' }[a], a === 'copy' ? 'link' : 'check');
  };
}
// Instagram backs a shared post with the photo's own colours
async function dominant(src) {
  try {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = 2; c.height = 2; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 2, 2);
    const [a, b] = [g.getImageData(0, 0, 1, 1).data, g.getImageData(1, 1, 1, 1).data];
    return `linear-gradient(160deg, rgb(${a[0]},${a[1]},${a[2]}), rgb(${b[0] * .6 | 0},${b[1] * .6 | 0},${b[2] * .6 | 0}))`;
  } catch { return 'linear-gradient(160deg,#8b5dff,#e0559b)'; }
}

renderTray(); renderChats();
icons();
window.__stories = { users, openViewer, pickMedia };

function openProfileRing() { const r = document.querySelector('#profile [data-ring]'); const u = users.find((x) => x.id === who?.id); if (r && u) r.className = `ring ${ringClass(u)}`; }
