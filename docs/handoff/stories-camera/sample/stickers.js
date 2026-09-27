// Stickers: one model, drawn in the editor (editable) and in the viewer (interactive).
// A sticker sits at x, y (fractions of the stage), scaled by s and turned by r degrees.

export const FONTS = [
  { k: 'classic', name: 'Classic' }, { k: 'modern', name: 'Modern' }, { k: 'neon', name: 'Neon' },
  { k: 'type', name: 'Typewriter' }, { k: 'strong', name: 'Strong' }, { k: 'elegant', name: 'Elegant' }, { k: 'direct', name: 'Directional' },
];
export const COLORS = ['#ffffff', '#000000', '#0a84ff', '#34c759', '#ffcc00', '#ff9500', '#ff3b30', '#e0559b', '#bf5af2', '#5e5ce6', '#64d2ff', '#a2845e'];
export const ANIMS = ['none', 'type', 'pop', 'wave', 'flicker'];

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const light = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 160; };
const chars = (t) => [...t].map((c, i) => (c === '\n' ? '<br>' : `<span class="ch" style="animation-delay:${i * 55}ms">${esc(c)}</span>`)).join('');

export function textInner(d) {
  const anim = d.anim && d.anim !== 'none' ? ` anim-${d.anim}` : '';
  let style = `font-size:${d.size || 28}px;text-align:${d.align || 'center'};`;
  if (d.bg === 'solid') style += `background:${d.color};color:${light(d.color) ? '#111' : '#fff'};`;
  else style += `color:${d.color};`;
  const body = d.anim === 'type' || d.anim === 'wave' ? chars(d.text) : esc(d.text).replace(/\n/g, '<br>');
  return `<div class="txt f-${d.font || 'classic'} bg-${d.bg || 'none'}${anim}" style="${style}">${body}</div>`;
}

function pad2(n) { return String(Math.max(0, n)).padStart(2, '0'); }
export function countdownParts(to) {
  const ms = Math.max(0, new Date(to) - Date.now());
  const m = Math.floor(ms / 60000);
  return [pad2(Math.floor(m / 1440)), pad2(Math.floor((m % 1440) / 60)), pad2(m % 60)];
}
const digits = (to) => {
  const [d, h, m] = countdownParts(to);
  const g = (v, l) => `<div class="grp"><div class="d"><i>${v[0]}</i><i>${v[1]}</i></div><small>${l}</small></div>`;
  return `${g(d, 'days')}<span class="colon">:</span>${g(h, 'hours')}<span class="colon">:</span>${g(m, 'minutes')}`;
};

export function inner(s, mode) {
  const d = s.d, ed = mode === 'edit' ? 'contenteditable="true" spellcheck="false"' : '';
  switch (s.type) {
    case 'text': return textInner(d);
    case 'loc': return `<div class="chip loc s${s.style || 0}"><svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>${esc(d.text)}</div>`;
    case 'men': return `<div class="chip men s${s.style || 0}"><span class="${(s.style || 0) === 0 ? 'gt' : ''}">@${esc(d.text)}</span></div>`;
    case 'tag': return `<div class="chip tag s${s.style || 0}">#${esc(d.text)}</div>`;
    case 'link': return `<div class="chip link s${s.style || 0}"><svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>${esc(d.text.replace(/^https?:\/\//, ''))}</div>`;
    case 'poll': {
      const st = s.state || {}, tot = (d.votes?.[0] || 0) + (d.votes?.[1] || 0) + (st.vote !== undefined ? 1 : 0);
      const pct = (i) => (tot ? Math.round((((d.votes?.[i] || 0) + (st.vote === i ? 1 : 0)) / tot) * 100) : 0);
      return `<div class="card poll ${st.vote !== undefined ? 'voted' : ''}"><div class="q" ${ed} data-f="q">${esc(d.q)}</div><div class="opts">${d.opts.map((o, i) => `
        <div class="opt ${st.vote === i ? 'mine' : ''}" data-i="${i}"><span class="fill" style="width:${st.vote !== undefined ? pct(i) : 0}%"></span><span class="lb" ${ed} data-f="o${i}">${esc(o)}</span><span class="pct">${pct(i)}%</span></div>`).join('')}</div></div>`;
    }
    case 'question': return `<div class="card question"><div class="q" ${ed} data-f="q">${esc(d.q)}</div><div class="ans">${mode === 'view' ? 'Type something…' : 'Viewers respond here'}</div></div>`;
    case 'countdown': return `<div class="card countdown"><div class="q"><span ${ed} data-f="q">${esc(d.q)}</span><svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m10 8 4 4-4 4"/></svg></div><div class="digits" data-to="${d.to}">${digits(d.to)}</div>${mode === 'view' ? `<button class="remind ${s.state?.remind ? 'on' : ''}">${s.state?.remind ? 'Reminder set' : 'Remind me'}</button>` : ''}</div>`;
    case 'slider': {
      const v = s.state?.v;
      return `<div class="card slider ${v !== undefined ? 'answered' : ''}"><div class="q" ${ed} data-f="q">${esc(d.q)}</div><div class="track"><span class="done" style="width:${(v ?? 0) * 100}%"></span><span class="avg" style="left:${(d.avg ?? .7) * 100}%">${Math.round((d.avg ?? .7) * 100)}</span><span class="knob" style="left:${(v ?? 0) * 100}%">${d.emoji}</span></div></div>`;
    }
    case 'quiz': return `<div class="card quiz"><div class="q" ${ed} data-f="q">${esc(d.q)}</div><div class="opts">${d.opts.map((o, i) => `<button class="o ${s.state?.pick !== undefined && i === d.right ? 'right' : ''} ${s.state?.pick === i && i !== d.right ? 'wrong' : ''}" data-i="${i}"><b>${'ABC'[i]}</b><span ${ed} data-f="o${i}">${esc(o)}</span></button>`).join('')}</div></div>`;
    case 'music': return `<div class="music"><img src="${esc(d.img)}" alt=""><div><b>${esc(d.name)}</b><span><span class="eq"><i></i><i></i><i></i></span>${esc(d.artist)}</span></div></div>`;
    case 'clock': {
      const t = new Date(d.at || Date.now());
      const hm = t.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)/, '');
      return (s.style || 0) % 2 === 0 ? `<div class="clock">${hm}<small>${t.getHours() < 12 ? 'AM' : 'PM'}</small></div>`
        : `<div class="chip s0" style="color:#111;font-size:22px">${t.toLocaleDateString('en', { weekday: 'long' })} · ${hm}</div>`;
    }
    case 'emoji': return `<div class="emoji"><img src="${esc(d.src)}" alt=""></div>`;
    case 'post': return `<div class="postcard s${s.style || 0}"><header><img src="${esc(d.avatar)}" alt="">${esc(d.user)}</header><img src="${esc(d.src)}" alt=""></div>`;
  }
  return '';
}

export function place(el, s) {
  el.style.left = `${s.x * 100}%`; el.style.top = `${s.y * 100}%`;
  el.style.transform = `translate(-50%, -50%) rotate(${s.r || 0}deg) scale(${s.s || 1})`;
}

export function render(s, mode) {
  const el = document.createElement('div');
  el.className = 'stk'; el.dataset.type = s.type;
  el.innerHTML = inner(s, mode);
  place(el, s);
  el._s = s;
  return el;
}

// countdowns tick wherever they are shown
setInterval(() => {
  document.querySelectorAll('.countdown .digits[data-to]').forEach((n) => { n.innerHTML = digits(n.dataset.to); });
}, 20000);
