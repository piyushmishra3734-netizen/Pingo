// The story editor: Instagram's labelled rail, its text tool, stickers, draw, effects and sharing.
import { $, icons, wait, face, ME, PEOPLE, MUSIC, toast, sheet, closeSheet } from './ui.js?v=2';
import { render, place, textInner, FONTS, COLORS, ANIMS } from './stickers.js?v=2';

const ed = $('editor');
let media, stickers, opts, filterI, boom, trim, song, caption;
let stage, layer, ink, g2, foldT;
let strokes = [];

const FILTERS = [
  ['Normal', ''], ['Paris', 'brightness(1.08) contrast(.94) saturate(1.1)'], ['Oslo', 'saturate(.9) brightness(1.1) hue-rotate(-6deg)'],
  ['Lagos', 'sepia(.25) saturate(1.45) contrast(1.05)'], ['Melbourne', 'sepia(.18) brightness(1.06) contrast(.95)'], ['Jakarta', 'contrast(1.25) saturate(1.25)'],
  ['Abu Dhabi', 'sepia(.35) saturate(1.2) hue-rotate(-10deg) brightness(1.05)'], ['Buenos Aires', 'saturate(1.35) contrast(1.1) hue-rotate(5deg)'],
  ['New York', 'grayscale(1) contrast(1.2)'], ['Jaipur', 'sepia(.3) saturate(1.6) hue-rotate(-15deg)'], ['Cairo', 'sepia(.5) contrast(1.05) brightness(.97)'],
  ['Tokyo', 'saturate(.75) contrast(1.15) hue-rotate(10deg) brightness(1.05)'], ['Rio de Janeiro', 'saturate(1.5) brightness(1.08) hue-rotate(-5deg)'],
];
const LOCATIONS = ['Indore', 'Bhopal', 'Mumbai', 'Rajwada, Indore', 'Sarafa Bazaar', 'Goa', 'Manali', 'Sequoia National Park, California'];
const SLIDER_EMOJI = ['😍', '🔥', '😂', '😮', '💯', '🥳'];

export function openEditor(m, o = {}) {
  media = m; opts = o; filterI = 0; boom = 'off'; trim = [0, 1]; song = undefined; caption = ''; strokes = [];
  stickers = (o.stickers || []).map((s) => ({ ...s }));
  ed.innerHTML = `
    <div class="stage" id="estage"><div class="bgfill"></div><canvas class="ink" id="eink"></canvas><div class="layer" id="elayer"></div></div>
    <div class="fname" id="fname"></div>
    <div class="etop"><button class="eb" data-a="back" aria-label="Back"><i data-lucide="chevron-left"></i></button></div>
    <div class="rail" id="rail">
      ${[['text', 'type', 'Text'], ['stickers', 'sticker', 'Stickers'], ['audio', 'music', 'Audio'], ['effect', 'sparkles', 'Effect']].map(railBtn).join('')}
      <div class="more">${[['mention', 'at-sign', 'Mention'], ['draw', 'brush', 'Draw'], ['download', 'download', 'Download'], ['moremenu', 'ellipsis', 'More']].map(railBtn).join('')}</div>
      <button class="tog" data-a="tog" aria-label="More tools"><span class="ri"><i data-lucide="chevron-down"></i></span></button>
    </div>
    <label class="caption"><input id="ecap" placeholder="Add a caption…"></label>
    <div class="bin" id="bin"><i data-lucide="trash-2"></i></div><div class="guide v" id="gv"></div><div class="guide h" id="gh"></div>
    <div class="ebar">
      <button class="pill" data-a="story"><img src="${ME.avatar}" alt="">Your story</button>
      <button class="pill" data-a="cf"><span class="star"><i data-lucide="star"></i></span>Close Friends</button>
      <button class="go" data-a="share" aria-label="Share"><i data-lucide="arrow-right"></i></button>
    </div>
    <div class="tmode" id="tmode"></div><div class="dmode" id="dmode"></div><div class="xmode" id="xmode"></div>`;
  stage = $('estage'); layer = $('elayer'); ink = $('eink');
  const bg = stage.querySelector('.bgfill');
  if (m.type === 'post') bg.style.background = m.bg;
  else if (m.type === 'video') {
    const v = document.createElement('video'); v.className = 'media'; v.src = m.src; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
    stage.prepend(v); v.play().catch(() => {});
  } else {
    const i = document.createElement('img'); i.className = 'media'; i.src = m.src; stage.prepend(i);
    if (!i.complete) { stage.classList.add('loading'); i.onload = i.onerror = () => stage.classList.remove('loading'); }
  }
  ed.classList.add('on'); ed.className = 'editor on';
  icons();
  sizeInk();
  stickers.forEach(addEl);
  $('rail').classList.remove('folded', 'open');
  $('rail').classList.add('open');
  // Instagram shows the names first, then folds down to icons
  clearTimeout(foldT); foldT = setTimeout(() => { $('rail').classList.add('folded'); $('rail').classList.remove('open'); }, 2800);
  $('ecap').oninput = (e) => (caption = e.target.value);
}
const railBtn = ([a, ic, lb]) => `<button data-a="${a}"><span class="lb">${lb}</span><span class="ri"><i data-lucide="${ic}"></i></span></button>`;
const mediaEl = () => stage.querySelector('.media');
function sizeInk() { const r = stage.getBoundingClientRect(); ink.width = r.width * 2; ink.height = r.height * 2; g2 = ink.getContext('2d'); redraw(); }

function addEl(s) {
  const el = render(s, 'edit'); layer.append(el); s._el = el;
  el.addEventListener('focusout', (e) => {
    const f = e.target.closest('[data-f]'); if (!f) return;
    const k = f.dataset.f, v = f.textContent.trim();
    if (k === 'q') s.d.q = v || s.d.q; else s.d.opts[+k.slice(1)] = v || s.d.opts[+k.slice(1)];
  });
  return el;
}
function add(s) {
  s.s ??= 1; s.r ??= 0;
  const given = s.y !== undefined;
  s.x ??= .5; s.y ??= .45;
  stickers.push(s); const el = addEl(s);
  // Where it covers the least of what is already there; the middle when the story is empty.
  if (!given && stickers.length > 1) {
    const L = layer.getBoundingClientRect(), others = stickers.filter((o) => o !== s).map((o) => o._el.getBoundingClientRect());
    const spots = [[.5, .45], [.5, .25], [.5, .65], [.5, .82], [.3, .35], [.7, .35], [.3, .58], [.7, .58], [.5, .12], [.3, .8], [.7, .8]];
    let best, bestCover = Infinity;
    for (const [x, y] of spots) {
      s.x = x; s.y = y; place(el, s);
      const r = el.getBoundingClientRect();
      const inside = r.left >= L.left - 4 && r.right <= L.right + 4 && r.top >= L.top + 40 && r.bottom <= L.bottom - 40;
      const cover = others.reduce((a, o) => a + Math.max(0, Math.min(r.right, o.right) - Math.max(r.left, o.left)) * Math.max(0, Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top)), 0) + (inside ? 0 : 1e6);
      if (cover < bestCover) { bestCover = cover; best = [x, y]; }
      if (cover === 0) break;
    }
    [s.x, s.y] = best; place(el, s);
  }
  el.animate([{ transform: `${el.style.transform} scale(.3)` }, { transform: el.style.transform }], { duration: 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  return s;
}
function rerender(s) { const el = render(s, 'edit'); s._el.replaceWith(el); s._el = el; }

// ---------------- rail and bar ----------------
ed.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]'); if (!b || !ed.contains(b)) return;
  const a = b.dataset.a;
  if (b.closest('.rail')) { $('rail').classList.remove('open'); $('rail').classList.add('folded'); }
  switch (a) {
    case 'back': return discard();
    case 'tog': $('rail').classList.toggle('open'); $('rail').classList.remove('folded'); clearTimeout(foldT); foldT = setTimeout(() => $('rail').classList.add('folded'), 2200); return;
    case 'text': return textMode();
    case 'stickers': return stickerTray();
    case 'audio': return musicSheet();
    case 'effect': return media.type === 'video' ? boomerangMode() : effectsTray();
    case 'mention': return pickPerson((p) => add({ type: 'men', d: { text: p.id } }));
    case 'draw': return drawMode();
    case 'download': return download();
    case 'moremenu': return moreMenu();
    case 'story': return share(false, b);
    case 'cf': return share(true, b);
    case 'share': return shareSheet();
  }
});
function discard() {
  const sh = sheet(`<h3>Discard media?</h3><p style="text-align:center;font-size:13.5px;color:#a1a1a6;padding:0 20px 14px">If you go back now, you will lose any changes you've made.</p>
    <div class="sbody"><button class="row" data-k="discard" style="width:100%;justify-content:center;color:#ff3040;font-weight:700">Discard</button><button class="row" data-k="draft" style="width:100%;justify-content:center;font-weight:600">Save draft</button><button class="row" data-k="cancel" style="width:100%;justify-content:center">Cancel</button></div>`, { dark: true });
  sh.querySelector('.sbody').onclick = (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return; closeSheet();
    if (k === 'cancel') return;
    if (k === 'draft') toast('Draft saved', 'file');
    close();
  };
}
function close() { ed.classList.remove('on'); stopSong(); ed.innerHTML = ''; }

// ---------------- stage gestures: stickers, swipe filters, tap to type ----------------
let pts = new Map(), act, g;
ed.addEventListener('pointerdown', (e) => {
  if (!stage || ed.classList.contains('texting') || ed.classList.contains('drawing') || ed.classList.contains('effects')) return;
  if (e.target.closest('.rail, .etop, .ebar, .caption, .sheet')) return;
  const el = e.target.closest('.stk');
  if (el && !act) {
    const editable = e.target.closest('[contenteditable="true"]');
    act = { el, s: el._s, x0: e.clientX, y0: e.clientY, sx: el._s.x, sy: el._s.y, t: performance.now(), moved: false, editable };
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!editable) e.preventDefault();
    ed.setPointerCapture(e.pointerId);
    layer.append(el); // to the top
    return;
  }
  if (act && pts.size === 1) { // a second finger anywhere turns the drag into pinch and twist
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); ed.setPointerCapture(e.pointerId);
    const [a, b] = [...pts.values()];
    act.pinch = { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), s: act.s.s, r: act.s.r };
    return;
  }
  if (e.target.closest('#estage, .fname') || e.target === ed) { g = { x: e.clientX, y: e.clientY, t: performance.now() }; ed.setPointerCapture(e.pointerId); }
});
ed.addEventListener('pointermove', (e) => {
  if (act && pts.has(e.pointerId)) {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stage.getBoundingClientRect();
    if (act.pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      act.s.s = Math.max(.3, Math.min(4, act.pinch.s * Math.hypot(b.x - a.x, b.y - a.y) / act.pinch.d));
      act.s.r = act.pinch.r + (Math.atan2(b.y - a.y, b.x - a.x) - act.pinch.ang) * 180 / Math.PI;
      act.moved = true; place(act.el, act.s); return;
    }
    const dx = e.clientX - act.x0, dy = e.clientY - act.y0;
    if (!act.moved && Math.hypot(dx, dy) < 6) return;
    if (act.editable && !act.moved) { act.editable.blur(); }
    act.moved = true; ed.classList.add('dragging', 'busy');
    let x = act.sx + dx / r.width, y = act.sy + dy / r.height;
    // snap to the middle, with Instagram's blue guides
    const sv = Math.abs(x - .5) < .02, sh2 = Math.abs(y - .5) < .02;
    if (sv) x = .5; if (sh2) y = .5;
    $('gv').classList.toggle('on', sv); $('gh').classList.toggle('on', sh2);
    act.s.x = x; act.s.y = y;
    const bin = $('bin').getBoundingClientRect();
    const hot = Math.hypot(e.clientX - (bin.left + bin.width / 2), e.clientY - (bin.top + bin.height / 2)) < 50;
    $('bin').classList.toggle('hot', hot); act.hot = hot;
    act.el.style.opacity = hot ? .55 : '';
    place(act.el, { ...act.s, s: hot ? act.s.s * .45 : act.s.s });
    return;
  }
  if (g) {
    g.dx = e.clientX - g.x; g.dy = e.clientY - g.y;
    if (media.type !== 'post' && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy)) {
      // swipe filters follow the finger: the next one's name fades in
      const n = Math.round(-g.dx / 90);
      const i = ((filterI + n) % FILTERS.length + FILTERS.length) % FILTERS.length;
      applyFilter(i, false);
    }
  }
});
ed.addEventListener('pointerup', (e) => {
  if (act && pts.has(e.pointerId)) {
    pts.delete(e.pointerId);
    if (pts.size) { act.pinch = undefined; const [p] = [...pts.values()]; act.x0 = p.x; act.y0 = p.y; act.sx = act.s.x; act.sy = act.s.y; return; }
    const a = act; act = undefined;
    ed.classList.remove('dragging', 'busy'); $('gv').classList.remove('on'); $('gh').classList.remove('on'); $('bin').classList.remove('hot');
    if (a.hot) { a.el.classList.add('dying'); a.el.style.transform += ' scale(0)'; setTimeout(() => a.el.remove(), 260); stickers.splice(stickers.indexOf(a.s), 1); if (a.s.type === 'music') stopSong(); return; }
    a.el.style.opacity = ''; place(a.el, a.s);
    if (!a.moved && performance.now() - a.t < 350) tapSticker(a.s, e);
    return;
  }
  if (g) {
    const s = g; g = undefined;
    if (Math.abs(s.dx || 0) > 12 && Math.abs(s.dx) > Math.abs(s.dy || 0)) { if (media.type !== 'post') { filterI = ((filterI + Math.round(-s.dx / 90)) % FILTERS.length + FILTERS.length) % FILTERS.length; applyFilter(filterI, true); } return; }
    if (Math.hypot(s.dx || 0, s.dy || 0) < 8) textMode(); // tap anywhere to type, as on Instagram
  }
});
// desktop: the wheel scales, shift+wheel turns
ed.addEventListener('wheel', (e) => {
  const el = e.target.closest('.stk'); if (!el || ed.classList.contains('texting')) return; e.preventDefault();
  const s = el._s; if (e.shiftKey) s.r += e.deltaY > 0 ? 6 : -6; else s.s = Math.max(.3, Math.min(4, s.s * (e.deltaY > 0 ? .93 : 1.07))); place(el, s);
}, { passive: false });

let fnameT;
function applyFilter(i, commit) {
  const [name, css] = FILTERS[i];
  if (mediaEl()) mediaEl().style.filter = css;
  const f = $('fname'); f.innerHTML = `${name}${commit ? '' : ''}`; f.classList.add('on');
  clearTimeout(fnameT); fnameT = setTimeout(() => f.classList.remove('on'), 900);
  if (commit) filterI = i;
}

function tapSticker(s, e) {
  switch (s.type) {
    case 'text': return textMode(s);
    case 'loc': case 'men': case 'tag': case 'link': s.style = ((s.style || 0) + 1) % 4; return rerender(s);
    case 'post': s.style = ((s.style || 0) + 1) % 2; return rerender(s);
    case 'clock': s.style = ((s.style || 0) + 1) % 2; return rerender(s);
    case 'music': return clipSheet(s);
    case 'slider': s.d.emoji = SLIDER_EMOJI[(SLIDER_EMOJI.indexOf(s.d.emoji) + 1) % SLIDER_EMOJI.length]; return rerender(s);
    case 'quiz': { const o = e.target.closest?.('.o'); if (o && !e.target.closest('[contenteditable]')) { s.d.right = +o.dataset.i; rerender(s); toast(`Right answer: ${s.d.opts[s.d.right]}`, 'check'); } return; }
    case 'countdown': if (!e.target.closest('[contenteditable]')) countdownSheet(s); return;
  }
}

// ---------------- text (image 4) ----------------
function textMode(s) {
  const d = s ? { ...s.d } : { text: '', font: 'classic', color: '#ffffff', bg: 'none', align: 'center', size: 30, anim: 'none' };
  if (s) s._el.style.visibility = 'hidden';
  const tm = $('tmode');
  tm.className = 'tmode';
  tm.innerHTML = `
    <div class="tbar">
      <button class="tb" data-t="align" aria-label="Alignment"><i data-lucide="align-${d.align}"></i></button>
      <button class="tb" data-t="colors" aria-label="Colour"><span class="wheel"></span></button>
      <button class="tb ${d.anim !== 'none' ? 'on' : ''}" data-t="anim" aria-label="Animate"><i data-lucide="a-large-small"></i></button>
      <button class="tb ${d.bg !== 'none' ? 'on' : ''}" data-t="bg" aria-label="Background"><i data-lucide="baseline"></i></button>
      <button class="done" data-t="done">Done</button>
    </div>
    <div class="tsize" id="tsize"><span class="tri"></span><span class="dot" id="tdot"></span></div>
    <div class="tedit"><div id="tx" contenteditable="true" spellcheck="false"></div></div>
    <div class="tbottom">
      <div class="fontname" id="fontname"></div>
      <div class="fonts" id="fonts">${FONTS.map((f) => `<button data-font="${f.k}" class="f-${f.k} ${f.k === d.font ? 'on' : ''}">Aa</button>`).join('')}</div>
      <div class="palette" id="palette">${COLORS.map((c) => `<button data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      <div class="tchips"><button data-t="mention"><i data-lucide="at-sign"></i>Mention</button><button data-t="location"><i data-lucide="map-pin"></i>Location</button></div>
    </div>`;
  ed.classList.add('texting'); icons();
  const tx = $('tx');
  const paint = () => {
    const el = document.createElement('div'); el.innerHTML = textInner({ ...d, anim: d.anim === 'type' || d.anim === 'wave' ? 'none' : d.anim, text: 'x' });
    const proto = el.firstElementChild;
    tx.className = proto.className; tx.setAttribute('style', proto.getAttribute('style'));
    $('fontname').textContent = FONTS.find((f) => f.k === d.font).name + (d.anim !== 'none' ? ` · ${d.anim}` : '');
    $('tdot').style.top = `${(1 - (d.size - 16) / 56) * 100}%`;
  };
  tx.textContent = d.text; paint();
  setTimeout(() => { tx.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(tx); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); }, 30);
  tx.oninput = () => (d.text = tx.innerText.replace(/\n$/, ''));
  tm.onclick = (e) => {
    const f = e.target.closest('[data-font]'); if (f) { d.font = f.dataset.font; tm.querySelectorAll('[data-font]').forEach((x) => x.classList.toggle('on', x === f)); paint(); tx.focus({ preventScroll: true }); return; }
    const c = e.target.closest('[data-c]'); if (c) { d.color = c.dataset.c; paint(); tx.focus({ preventScroll: true }); return; }
    const b = e.target.closest('[data-t]');
    if (!b) { if (e.target === tm || e.target.closest('.tedit') === null && !e.target.closest('.tbottom, .tbar, .tsize')) finish(); return; }
    switch (b.dataset.t) {
      case 'align': d.align = { center: 'left', left: 'right', right: 'center' }[d.align]; b.innerHTML = `<i data-lucide="align-${d.align}"></i>`; icons(); break;
      case 'colors': tm.classList.toggle('colors'); break;
      case 'anim': d.anim = ANIMS[(ANIMS.indexOf(d.anim) + 1) % ANIMS.length]; b.classList.toggle('on', d.anim !== 'none'); toast(d.anim === 'none' ? 'No animation' : `Animation: ${d.anim}`, 'sparkles'); break;
      case 'bg': d.bg = { none: 'solid', solid: 'soft', soft: 'none' }[d.bg]; b.classList.toggle('on', d.bg !== 'none'); break;
      case 'mention': d.text = (d.text ? d.text + ' ' : '') + '@baani'; tx.textContent = d.text; break;
      case 'location': finish(); return pickLocation();
      case 'done': return finish();
    }
    paint(); tx.focus({ preventScroll: true });
  };
  // size: drag the wedge on the left
  const ts = $('tsize');
  ts.onpointerdown = (e) => {
    ts.setPointerCapture(e.pointerId);
    const move = (ev) => { const r = ts.getBoundingClientRect(); const k = 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)); d.size = Math.round(16 + k * 56); paint(); };
    move(e); ts.onpointermove = move; ts.onpointerup = () => { ts.onpointermove = null; tx.focus({ preventScroll: true }); };
  };
  function finish() {
    ed.classList.remove('texting'); tm.innerHTML = '';
    d.text = d.text.trim();
    if (s) { s._el.style.visibility = ''; if (!d.text) { s._el.remove(); stickers.splice(stickers.indexOf(s), 1); return; } s.d = d; rerender(s); return; }
    if (d.text) add({ type: 'text', d, y: .42 });
  }
}

// ---------------- stickers tray ----------------
function stickerTray() {
  const sh = sheet(`<label class="ssearch"><i data-lucide="search"></i><input id="sq" placeholder="Search"></label>
    <div class="sbody"><div class="stray" id="stray">
      <button class="loc" data-s="loc"><i data-lucide="map-pin"></i>LOCATION</button>
      <button class="men" data-s="men">@MENTION</button>
      <button class="mus" data-s="music"><i data-lucide="music-2"></i>MUSIC</button>
      <button class="qs" data-s="question">QUESTIONS</button>
      <button class="poll" data-s="poll"><b>POLL</b>&nbsp;<i>•</i></button>
      <button class="cd" data-s="countdown"><i data-lucide="alarm-clock"></i>COUNTDOWN</button>
      <button class="qz" data-s="quiz"><i data-lucide="circle-check"></i>QUIZ</button>
      <button class="sld" data-s="slider">😍 EMOJI SLIDER</button>
      <button class="lnk" data-s="link"><i data-lucide="link"></i>LINK</button>
      <button class="tag" data-s="tag">#HASHTAG</button>
      <button class="tm" data-s="clock"><i data-lucide="clock"></i>TIME</button>
    </div><div class="egrid" id="egrid"></div></div>`, { dark: true });
  loadPack().then((pack) => { $('egrid').innerHTML = pack.map((p, i) => `<button data-e="${i}" data-n="${p.name.toLowerCase()} ${p.keywords.join(' ')}"><img src="${p.url}" alt="" loading="lazy"></button>`).join(''); });
  $('sq').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    sh.querySelectorAll('#stray button').forEach((b) => (b.hidden = q && !b.textContent.toLowerCase().includes(q)));
    sh.querySelectorAll('#egrid button').forEach((b) => (b.hidden = q && !b.dataset.n.includes(q)));
  };
  sh.querySelector('.sbody').onclick = async (e) => {
    const em = e.target.closest('[data-e]');
    if (em) { closeSheet(); const p = (await loadPack())[+em.dataset.e]; return add({ type: 'emoji', d: { src: p.url }, y: .35 }); }
    const b = e.target.closest('[data-s]'); if (!b) return;
    // stickers that need a choice swap straight to the next sheet (and its keyboard, still inside the tap)
    if (!['loc', 'men', 'music', 'link', 'tag', 'countdown'].includes(b.dataset.s)) closeSheet();
    switch (b.dataset.s) {
      case 'loc': return pickLocation();
      case 'men': return pickPerson((p) => add({ type: 'men', d: { text: p.id } }));
      case 'music': return musicSheet();
      case 'question': return add({ type: 'question', d: { q: 'Ask me a question' } });
      case 'poll': return add({ type: 'poll', d: { q: 'Ask a question…', opts: ['YES', 'NO'], votes: [0, 0] } });
      case 'countdown': return countdownSheet();
      case 'quiz': return add({ type: 'quiz', d: { q: 'Guess what?', opts: ['Option A', 'Option B', 'Option C'], right: 0 } });
      case 'slider': return add({ type: 'slider', d: { q: 'Ask a question…', emoji: '😍', avg: .7 } });
      case 'link': return inputSheet('Add link', 'https://', (v) => add({ type: 'link', d: { text: v } }), 'url');
      case 'tag': return inputSheet('Add hashtag', 'weekend', (v) => add({ type: 'tag', d: { text: v.replace(/^#/, '') } }));
      case 'clock': return add({ type: 'clock', d: { at: Date.now() }, y: .3 });
    }
  };
}
let packP;
const loadPack = () => (packP ||= fetch('fluent-3d.json').then((r) => r.json()).then((j) => j.stickers));
function pickLocation() {
  const sh = sheet(`<h3>Location</h3><label class="ssearch"><i data-lucide="search"></i><input id="lq" placeholder="Search locations"></label><div class="sbody" id="ll">${LOCATIONS.map((l) => `<button class="row" data-l="${l}" style="width:100%;text-align:left"><span class="rb"><i data-lucide="map-pin"></i></span><span class="t"><b>${l}</b></span></button>`).join('')}</div>`, { dark: true });
  $('lq').oninput = (e) => sh.querySelectorAll('[data-l]').forEach((b) => (b.hidden = !b.dataset.l.toLowerCase().includes(e.target.value.toLowerCase())));
  $('ll').onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) return; closeSheet(); add({ type: 'loc', d: { text: b.dataset.l }, y: .7 }); };
}
function pickPerson(fn) {
  const sh = sheet(`<h3>Mention</h3><label class="ssearch"><i data-lucide="search"></i><input id="pq" placeholder="Search"></label><div class="sbody" id="pl">${PEOPLE.map((p) => `<button class="row" data-p="${p.id}" style="width:100%;text-align:left"><img class="av" src="${p.avatar}" alt=""><span class="t"><b>${p.name}</b><span>${p.full}</span></span></button>`).join('')}</div>`, { dark: true });
  $('pq').oninput = (e) => sh.querySelectorAll('[data-p]').forEach((b) => (b.hidden = !b.textContent.toLowerCase().includes(e.target.value.toLowerCase())));
  $('pl').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; closeSheet(); fn(PEOPLE.find((p) => p.id === b.dataset.p)); };
}
function inputSheet(title, ph, fn, type = 'text') {
  const sh = sheet(`<h3>${title}</h3><div class="sbody"><input id="iv" type="${type}" placeholder="${ph}" style="width:100%;height:46px;border-radius:12px;border:0;outline:0;padding:0 14px;background:#2c2c2e;color:#fff;font-size:16px"><button id="ib" style="margin-top:12px;width:100%;height:46px;border-radius:12px;background:#0a84ff;color:#fff;font-weight:700">Done</button></div>`, { dark: true });
  $('iv').focus({ preventScroll: true });
  const go = () => { const v = $('iv').value.trim(); if (!v) return; closeSheet(); fn(v); };
  $('ib').onclick = go; $('iv').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
function countdownSheet(s) {
  const at = new Date(s ? s.d.to : Date.now() + 2 * 864e5); at.setMinutes(at.getMinutes() - at.getTimezoneOffset());
  const sh = sheet(`<h3>Countdown</h3><div class="sbody">
    <input id="cn" placeholder="Countdown name" value="${s?.d.q || ''}" style="width:100%;height:46px;border-radius:12px;border:0;outline:0;padding:0 14px;background:#2c2c2e;color:#fff;font-size:16px;text-transform:uppercase">
    <input id="cd" type="datetime-local" value="${at.toISOString().slice(0, 16)}" style="margin-top:10px;width:100%;height:46px;border-radius:12px;border:0;outline:0;padding:0 14px;background:#2c2c2e;color:#fff;font-size:16px;color-scheme:dark">
    <button id="cb" style="margin-top:12px;width:100%;height:46px;border-radius:12px;background:#0a84ff;color:#fff;font-weight:700">Done</button></div>`, { dark: true });
  $('cn').focus({ preventScroll: true });
  $('cb').onclick = () => {
    const d = { q: $('cn').value.trim() || 'Countdown', to: new Date($('cd').value).toISOString() };
    closeSheet();
    if (s) { s.d = d; rerender(s); } else add({ type: 'countdown', d, y: .3 });
  };
}

// ---------------- music: JioSaavn through pingo-music ----------------
const player = new Audio(); player.crossOrigin = 'anonymous'; player.loop = true;
const decode = (t) => { const x = document.createElement('textarea'); x.innerHTML = t || ''; return x.value; };
const shape = (r) => ({ name: decode(r.name), artist: decode((r.artists?.primary || []).map((a) => a.name).slice(0, 2).join(', ')), secs: r.duration || 0,
  img: r.image?.[1]?.url || r.image?.[0]?.url, url: (r.downloadUrl || []).find((u) => u.quality === '160kbps')?.url || r.downloadUrl?.at(-1)?.url });
function stopSong() { player.pause(); }
function musicSheet() {
  let list = [], playing = -1;
  const sh = sheet(`<label class="ssearch"><i data-lucide="search"></i><input id="mq" placeholder="Search music"></label><div class="stray mtabs2" id="mt" style="justify-content:flex-start;padding:0 14px 10px"><button class="on" data-q="">For you</button><button data-q="trending hits">Trending</button><button data-q="latest hindi songs">Hindi</button><button data-q="punjabi hits">Punjabi</button></div><div class="sbody" id="ml"><p style="text-align:center;color:#8e8e8e;padding:20px">Loading…</p></div>`, { dark: true, onClose: () => { if (!song) stopSong(); } });
  const draw = () => {
    $('ml').innerHTML = list.map((s, i) => `<div class="row" data-i="${i}"><img class="av" src="${s.img}" style="border-radius:8px" alt=""><span class="t"><b>${s.name}</b><span>${s.artist}</span></span><button class="rb" data-play aria-label="Preview"><i data-lucide="${i === playing ? 'pause' : 'play'}"></i></button></div>`).join('') || '<p style="text-align:center;color:#8e8e8e;padding:20px">Nothing found</p>';
    icons();
  };
  const load = async (q) => {
    try { const d = await (await fetch(q ? `${MUSIC}/search/songs?query=${encodeURIComponent(q)}&limit=20` : `${MUSIC}/playlists?id=110858205&limit=20`)).json(); list = (q ? d.data.results : d.data.songs).map(shape).filter((s) => s.url); }
    catch { list = []; }
    draw();
  };
  load(); let t;
  $('mt').onclick = (e) => { const b = e.target.closest('[data-q]'); if (!b) return; $('mt').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); $('ml').innerHTML = '<p style="text-align:center;color:#8e8e8e;padding:20px">Loading…</p>'; load(b.dataset.q); };
  $('mq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 350); };
  $('ml').onclick = (e) => {
    const r = e.target.closest('[data-i]'); if (!r) return; const s = list[+r.dataset.i];
    if (e.target.closest('[data-play]')) { if (playing === +r.dataset.i) { playing = -1; stopSong(); } else { playing = +r.dataset.i; player.src = s.url; player.currentTime = 30; player.play().catch(() => {}); } return draw(); }
    closeSheet();
    song = { ...s, start: 30 };
    const old = stickers.find((x) => x.type === 'music'); if (old) { old._el.remove(); stickers.splice(stickers.indexOf(old), 1); }
    const st = add({ type: 'music', d: song, y: .72 });
    player.src = s.url; player.currentTime = 30; player.play().catch(() => {});
    clipSheet(st);
  };
}
// which part of the song: Instagram's scrubber
function clipSheet(s) {
  const d = s.d, max = Math.max(15, (d.secs || 240) - 15);
  const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  const bars = Array.from({ length: 60 }, (_, i) => 20 + Math.abs(Math.sin(i * 1.7) * 60) + (i % 5) * 4);
  const sh = sheet(`<div style="display:flex;align-items:center;gap:10px;padding:0 16px 12px"><img src="${d.img}" style="width:44px;height:44px;border-radius:8px"><div style="flex:1;min-width:0"><b style="display:block">${d.name}</b><span style="font-size:13px;color:#a1a1a6">${d.artist}</span></div><button id="cdone" style="font-weight:700;color:#0a84ff">Done</button></div>
    <div style="position:relative;height:56px;margin:0 16px;display:flex;align-items:center;gap:2px">${bars.map((h) => `<i style="flex:1;height:${h}%;border-radius:2px;background:#48484a"></i>`).join('')}
      <span id="cwin" style="position:absolute;top:-4px;bottom:-4px;width:${(15 / (d.secs || 240)) * 100}%;border-radius:10px;box-shadow:0 0 0 3px #fff;pointer-events:none"></span></div>
    <input id="crange" type="range" min="0" max="${max}" step="1" value="${d.start || 0}" style="width:calc(100% - 32px);margin:10px 16px 0">
    <p id="cwhen" style="text-align:center;font-weight:700;font-size:13px;padding:6px 0 22px;font-variant-numeric:tabular-nums"></p>`, { dark: true });
  const upd = () => { const v = +$('crange').value; d.start = v; $('cwin').style.left = `${(v / (d.secs || 240)) * 100}%`; $('cwhen').textContent = `${fmt(v)} – ${fmt(v + 15)}`; player.currentTime = v; player.play().catch(() => {}); };
  $('crange').oninput = upd; upd();
  $('cdone').onclick = closeSheet;
}
player.addEventListener('timeupdate', () => { if (song && player.currentTime > (song.start || 0) + 15) player.currentTime = song.start || 0; });

// ---------------- effects: filters for a photo, Boomerang for a video (image 6) ----------------
function effectsTray() {
  const src = media.type === 'post' ? media.src : media.src;
  const sh = sheet(`<h3>Effects</h3><div class="sbody"><div class="sgridp" id="fx">${FILTERS.map(([n, css], i) => `<button data-i="${i}" class="${i === filterI ? 'on' : ''}"><img src="${src}" style="filter:${css};border-radius:16px;width:64px;height:84px" alt=""><span>${n}</span></button>`).join('')}</div></div>`, { dark: true });
  $('fx').onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; sh.querySelectorAll('[data-i]').forEach((x) => x.classList.toggle('on', x === b)); filterI = +b.dataset.i; applyFilter(filterI, true); };
}
const BOOM = [['off', 'ban', 'Off'], ['echo', 'target', 'Echo'], ['classic', 'infinity', 'Classic'], ['slowmo', 'gauge', 'Slowmo'], ['duo', 'repeat-2', 'Duo']];
function boomerangMode() {
  if (boom === 'off') boom = 'classic'; // Instagram opens on Classic
  const x = $('xmode');
  x.innerHTML = `<button class="done" data-x="done">Done</button>
    <div class="xstage" id="xstage"><video id="xv" src="${media.src}" muted playsinline></video></div>
    <div class="xname" id="xname"></div>
    <div class="xopts" id="xopts">${BOOM.map(([k, ic]) => `<button data-b="${k}" class="${k === boom ? 'on' : ''}" aria-label="${k}"><i data-lucide="${ic}"></i></button>`).join('')}</div>
    <div class="trim" id="trim"><div class="frames" id="frames"></div><span class="shade" id="sh0" style="left:16px"></span><span class="shade" id="sh1" style="right:16px"></span><span class="h" id="h0"></span><span class="h" id="h1"></span><span class="play" id="ph"></span></div>`;
  ed.classList.add('effects'); icons();
  const v = $('xv'); let back = false, raf;
  const setName = (k) => { $('xname').textContent = BOOM.find((b) => b[0] === k)[2]; $('xname').style.opacity = 1; clearTimeout(x._t); x._t = setTimeout(() => { const n = $('xname'); if (n) n.style.opacity = 0; }, 1100); };
  let echo;
  const applyMode = () => {
    v.playbackRate = boom === 'slowmo' ? .5 : 1;
    echo?.remove(); echo = undefined;
    if (boom === 'echo') { echo = document.createElement('video'); echo.className = 'echo'; echo.src = media.src; echo.muted = true; echo.playsInline = true; $('xstage').append(echo); }
  };
  const loop = () => {
    const a = trim[0] * v.duration, b = trim[1] * v.duration;
    if (v.duration) {
      if (boom === 'duo') v.playbackRate = .4 + 1.6 * Math.abs(Math.sin(performance.now() / 700));
      // forwards then backwards within the trim, stepping the clock by hand for the way back
      if (boom !== 'off') {
        if (!back && v.currentTime >= b - .03) { back = true; v.pause(); }
        if (back) { v.currentTime = Math.max(a, v.currentTime - (boom === 'slowmo' ? .017 : .034)); if (v.currentTime <= a + .02) { back = false; v.play().catch(() => {}); } }
      } else if (v.currentTime >= b - .03) v.currentTime = a;
      if (echo) echo.currentTime = Math.max(0, v.currentTime - .16);
      const pw = $('frames').getBoundingClientRect().width;
      $('ph').style.left = `${16 + (v.currentTime / v.duration) * pw}px`;
    }
    raf = requestAnimationFrame(loop);
  };
  v.addEventListener('loadedmetadata', () => { v.currentTime = trim[0] * v.duration; v.play().catch(() => {}); applyMode(); loop(); thumbs(); layoutTrim(); });
  x._stop = () => cancelAnimationFrame(raf);
  $('xopts').onclick = (e) => { const b = e.target.closest('[data-b]'); if (!b) return; boom = b.dataset.b; x.querySelectorAll('[data-b]').forEach((y) => y.classList.toggle('on', y === b)); back = false; if (v.paused) v.play().catch(() => {}); applyMode(); setName(boom); };
  setName(boom);
  // frames along the trim bar
  async function thumbs() {
    const t = document.createElement('video'); t.src = media.src; t.muted = true; await new Promise((r) => (t.onloadeddata = r));
    const out = [];
    for (let i = 0; i < 8; i++) {
      t.currentTime = (i + .5) / 8 * t.duration; await new Promise((r) => (t.onseeked = r));
      const c = document.createElement('canvas'); c.width = 60; c.height = 100; c.getContext('2d').drawImage(t, 0, 0, 60, 100); out.push(c.toDataURL('image/jpeg', .6));
    }
    $('frames').innerHTML = out.map((u) => `<img src="${u}" alt="">`).join('');
  }
  const layoutTrim = () => {
    const w = $('frames').getBoundingClientRect().width;
    $('h0').style.left = `${trim[0] * w}px`; $('h1').style.left = `${16 + trim[1] * w}px`;
    $('sh0').style.width = `${trim[0] * w}px`; $('sh1').style.width = `${(1 - trim[1]) * w}px`;
  };
  ['h0', 'h1'].forEach((id, k) => {
    const h = $(id);
    h.onpointerdown = (e) => {
      h.setPointerCapture(e.pointerId);
      h.onpointermove = (ev) => { const r = $('frames').getBoundingClientRect(); let f = (ev.clientX - r.left) / r.width; f = Math.max(0, Math.min(1, f)); trim[k] = k ? Math.max(trim[0] + .15, f) : Math.min(trim[1] - .15, f); layoutTrim(); v.currentTime = trim[k] * v.duration; };
      h.onpointerup = () => (h.onpointermove = null);
    };
  });
  x.querySelector('[data-x="done"]').onclick = () => {
    x._stop(); ed.classList.remove('effects'); x.innerHTML = '';
    const mv = mediaEl(); mv.playbackRate = boom === 'slowmo' ? .5 : 1;
    toast(boom === 'off' ? 'Effect off' : `Boomerang: ${BOOM.find((b) => b[0] === boom)[2]}`, 'infinity');
  };
}

// ---------------- draw ----------------
const BRUSHES = [['pen', 'pen-line'], ['marker', 'highlighter'], ['neon', 'zap'], ['eraser', 'eraser']];
const DCOLORS = ['#ffffff', '#000000', '#0a84ff', '#34c759', '#ffcc00', '#ff9500', '#ff3b30', '#e0559b', '#bf5af2'];
let brush = 'pen', dcolor = '#ffffff', dsize = 8;
function drawMode() {
  const dm = $('dmode');
  dm.innerHTML = `<canvas class="drawpad" id="pad"></canvas>
    <div class="dtop"><button class="eb" data-d="undo" aria-label="Undo"><i data-lucide="undo-2"></i></button><div class="brushes">${BRUSHES.map(([k, ic]) => `<button data-b="${k}" class="${k === brush ? 'on' : ''}"><i data-lucide="${ic}"></i></button>`).join('')}</div><button class="done" data-d="done">Done</button></div>
    <div class="dsize" id="dsz"><span class="tri"></span><span class="dot" id="ddot"></span></div>
    <div class="dcolors">${DCOLORS.map((c) => `<button data-c="${c}" style="background:${c}" class="${c === dcolor ? 'on' : ''}"></button>`).join('')}</div>`;
  ed.classList.add('drawing'); icons();
  const pad = $('pad'), r = stage.getBoundingClientRect(), er = ed.getBoundingClientRect();
  Object.assign(pad.style, { left: `${r.left - er.left}px`, top: `${r.top - er.top}px`, width: `${r.width}px`, height: `${r.height}px`, inset: 'auto' });
  $('ddot').style.top = `${(1 - (dsize - 2) / 38) * 100}%`;
  let cur;
  pad.onpointerdown = (e) => { pad.setPointerCapture(e.pointerId); const b = pad.getBoundingClientRect(); cur = { brush, color: dcolor, size: dsize, p: [[(e.clientX - b.left) * 2, (e.clientY - b.top) * 2]] }; strokes.push(cur); };
  pad.onpointermove = (e) => { if (!cur) return; const b = pad.getBoundingClientRect(); cur.p.push([(e.clientX - b.left) * 2, (e.clientY - b.top) * 2]); redraw(); };
  pad.onpointerup = () => (cur = undefined);
  dm.onclick = (e) => {
    const b = e.target.closest('[data-b]'); if (b) { brush = b.dataset.b; dm.querySelectorAll('[data-b]').forEach((x) => x.classList.toggle('on', x === b)); return; }
    const c = e.target.closest('[data-c]'); if (c) { dcolor = c.dataset.c; dm.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === c)); return; }
    const d = e.target.closest('[data-d]')?.dataset.d;
    if (d === 'undo') { strokes.pop(); redraw(); }
    if (d === 'done') { ed.classList.remove('drawing'); dm.innerHTML = ''; }
  };
  const sz = $('dsz');
  sz.onpointerdown = (e) => { sz.setPointerCapture(e.pointerId); const mv = (ev) => { const rr = sz.getBoundingClientRect(); const k = 1 - Math.max(0, Math.min(1, (ev.clientY - rr.top) / rr.height)); dsize = Math.round(2 + k * 38); $('ddot').style.top = `${(1 - k) * 100}%`; }; mv(e); sz.onpointermove = mv; sz.onpointerup = () => (sz.onpointermove = null); };
}
function redraw() {
  if (!g2) return;
  g2.clearRect(0, 0, ink.width, ink.height);
  for (const s of strokes) {
    g2.save(); g2.lineJoin = 'round'; g2.lineCap = s.brush === 'marker' ? 'square' : 'round';
    g2.lineWidth = s.size * 2 * (s.brush === 'marker' ? 2.2 : 1); g2.strokeStyle = s.color;
    if (s.brush === 'marker') g2.globalAlpha = .5;
    if (s.brush === 'eraser') g2.globalCompositeOperation = 'destination-out';
    if (s.brush === 'neon') { g2.shadowColor = s.color; g2.shadowBlur = 24; }
    const path = () => { g2.beginPath(); s.p.forEach(([x, y], i) => (i ? g2.lineTo(x, y) : g2.moveTo(x, y))); g2.stroke(); };
    path();
    if (s.brush === 'neon') { g2.shadowBlur = 0; g2.strokeStyle = '#fff'; g2.lineWidth = s.size * .7; path(); }
    g2.restore();
  }
}

// ---------------- download, more ----------------
async function download() {
  const r = stage.getBoundingClientRect(), c = document.createElement('canvas'); c.width = r.width * 2; c.height = r.height * 2; const g = c.getContext('2d');
  try {
    const m = mediaEl();
    if (m) { g.filter = m.style.filter || 'none'; const w = m.videoWidth || m.naturalWidth, h = m.videoHeight || m.naturalHeight, k = Math.max(c.width / w, c.height / h); g.drawImage(m, (c.width - w * k) / 2, (c.height - h * k) / 2, w * k, h * k); g.filter = 'none'; }
    g.drawImage(ink, 0, 0, c.width, c.height);
    const a = document.createElement('a'); a.href = c.toDataURL('image/jpeg', .92); a.download = 'pingo-story.jpg'; a.click();
  } catch { /* a cross-origin picture: nothing to save in the sample */ }
  toast('Saved to your phone', 'download');
}
function moreMenu() {
  const sh = sheet(`<div class="sbody">${[['file', 'Save draft'], ['bot', 'Add AI label'], ['message-circle-off', 'Turn off replies'], ['users-round', 'Invite collaborator']].map(([ic, t]) => `<button class="row" data-t="${t}" style="width:100%"><span class="rb"><i data-lucide="${ic}"></i></span><span class="t"><b style="font-weight:600">${t}</b></span></button>`).join('')}</div>`, { dark: true });
  sh.querySelector('.sbody').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; closeSheet(); toast(b.dataset.t, 'check'); };
}

// ---------------- sharing ----------------
function item() {
  return {
    type: media.type === 'video' ? 'video' : 'image',
    src: media.type === 'post' ? 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' : media.src,
    poster: media.type === 'post' ? media.src : media.poster || media.src, rev: media.rev, bg: media.type === 'post' ? media.bg : undefined,
    filter: FILTERS[filterI][1], boom, trim: [...trim], music: song, caption: caption.trim(),
    ink: strokes.length ? ink.toDataURL('image/png') : undefined,
    stickers: stickers.map(({ _el, ...s }) => JSON.parse(JSON.stringify(s))),
  };
}
function share(cf, from) {
  const r = stage.getBoundingClientRect();
  const it = item(); stopSong(); close();
  opts.onShare?.(it, cf, r);
}
function shareSheet() {
  const sel = { story: true, cf: false }, sent = new Set();
  const sh = sheet(`<h3>Share</h3><div class="sbody">
      <button class="row" data-k="story" style="width:100%"><img class="av" src="${ME.avatar}" alt=""><span class="t" style="text-align:left"><b>Your story</b></span><span class="rb" data-tick><i data-lucide="circle-check"></i></span></button>
      <button class="row" data-k="cf" style="width:100%"><span class="av" style="display:grid;place-items:center;background:#1fc15e;color:#fff;border-radius:50%;width:44px;height:44px"><i data-lucide="star"></i></span><span class="t" style="text-align:left"><b>Close friends</b><span>6 people</span></span><span class="rb" data-tick><i data-lucide="circle"></i></span></button>
      <div class="vh" style="font-weight:700;padding:14px 0 4px">Messages</div>
      ${PEOPLE.map((p) => `<div class="row"><img class="av" src="${p.avatar}" alt=""><span class="t"><b>${p.full}</b><span>${p.name}</span></span><button class="btn" data-p="${p.id}">Send</button></div>`).join('')}
      <button id="shgo" style="position:sticky;bottom:0;margin-top:10px;width:100%;height:48px;border-radius:12px;background:#0a84ff;color:#fff;font-weight:700">Share</button></div>`, { dark: true });
  sh.querySelector('.sbody').onclick = (e) => {
    const k = e.target.closest('[data-k]');
    if (k) { sel[k.dataset.k] = !sel[k.dataset.k]; k.querySelector('[data-tick]').innerHTML = `<i data-lucide="${sel[k.dataset.k] ? 'circle-check' : 'circle'}"></i>`; icons(); return; }
    const p = e.target.closest('[data-p]'); if (p && !sent.has(p.dataset.p)) { sent.add(p.dataset.p); p.classList.add('sent'); p.textContent = 'Undo'; return; }
    if (e.target.id === 'shgo') {
      closeSheet();
      if (sel.story || sel.cf) return share(sel.cf && !sel.story);
      if (sent.size) { toast(`Sent to ${sent.size}`, 'send'); close(); }
    }
  };
}

window.addEventListener('resize', () => { if (ed.classList.contains('on')) sizeInk(); });
