/**
 * The race's screen furniture: place, lap and time; the lights; words that
 * pop when you earn a turbo; the track list and the results card.
 */

const STYLE = `
.rc-hud { position: fixed; inset: 0; z-index: 1; pointer-events: none; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff; }
.rc-hud [hidden] { display: none !important; }
.rc-top { position: absolute; left: max(14px, env(safe-area-inset-left)); right: max(14px, env(safe-area-inset-right)); top: max(56px, calc(env(safe-area-inset-top) + 48px)); display: flex; justify-content: space-between; align-items: flex-start; text-shadow: 0 2px 0 rgba(0,0,0,0.55); }
.rc-place { font: 900 clamp(44px, 11vw, 68px)/0.9 system-ui, sans-serif; font-style: italic; }
.rc-place sup { font-size: 0.42em; vertical-align: 0.95em; margin-left: 2px; }
.rc-place small { font-size: 0.32em; opacity: 0.8; font-style: normal; margin-left: 4px; }
.rc-right { text-align: right; font: 800 15px/1.3 system-ui, sans-serif; letter-spacing: 0.04em; }
.rc-right b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.rc-center { position: absolute; left: 0; right: 0; top: 30%; text-align: center; font: 900 clamp(48px, 13vw, 96px)/1 system-ui, sans-serif; font-style: italic; text-shadow: 0 5px 0 rgba(0,0,0,0.5); }
.rc-center.go { color: #7dff6b; }
.rc-pop { position: absolute; left: 50%; top: 58%; transform: translate(-50%, -50%); font: 900 clamp(22px, 6vw, 34px)/1 system-ui, sans-serif; font-style: italic; white-space: nowrap; text-shadow: 0 3px 0 rgba(0,0,0,0.55); animation: rc-rise 1000ms ease-out forwards; }
@keyframes rc-rise { 0% { opacity: 0; scale: 0.5; } 12% { opacity: 1; scale: 1.2; } 25% { scale: 1; } 70% { opacity: 1; } 100% { opacity: 0; margin-top: -50px; } }
.rc-help { position: absolute; left: 0; right: 0; bottom: max(18px, env(safe-area-inset-bottom)); text-align: center; font: 600 13px/1.4 system-ui, sans-serif; text-shadow: 0 1px 2px #000; }
@media (pointer: coarse) { .rc-help { display: none; } }
.rc-menu { position: absolute; inset: 0; display: grid; place-items: center; padding: 64px 16px 24px; overflow-y: auto; pointer-events: auto; background: radial-gradient(ellipse at center, rgba(10,20,40,0.45), rgba(10,14,28,0.9)); }
.rc-card { width: min(100%, 440px); display: grid; gap: 10px; }
.rc-card h2 { margin: 0; font: 900 clamp(26px, 7vw, 38px)/1 system-ui, sans-serif; font-style: italic; letter-spacing: 0.02em; text-align: center; text-shadow: 0 3px 0 #000; }
.rc-sub { text-align: center; font: 700 14px/1.45 system-ui, sans-serif; color: rgba(255,255,255,0.8); }
.rc-sub b { color: #ffd84a; }
.rc-row { display: grid; grid-template-columns: 34px 1fr auto; gap: 10px; align-items: center; width: 100%; padding: 11px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.07); color: #fff; font: inherit; text-align: left; cursor: pointer; }
.rc-row:hover:not(:disabled), .rc-row:focus-visible { background: rgba(79,179,255,0.25); border-color: #4fb3ff; outline: none; }
.rc-row:disabled { opacity: 0.45; cursor: default; }
.rc-row.next { border-color: #4fb3ff; box-shadow: 0 0 0 1px #4fb3ff, 0 0 22px rgba(79,179,255,0.35); }
.rc-row .n { font: 900 20px/1 system-ui, sans-serif; text-align: center; }
.rc-row strong { display: block; font: 800 16px/1.2 system-ui, sans-serif; }
.rc-row span { display: block; font: 600 12px/1.3 system-ui, sans-serif; color: rgba(255,255,255,0.7); }
.rc-row em { font: 800 13px/1 system-ui, sans-serif; font-style: normal; color: #ffd84a; }
.rc-standings { display: grid; gap: 4px; margin: 4px 0; }
.rc-standings div { display: flex; justify-content: space-between; padding: 7px 12px; border-radius: 8px; background: rgba(255,255,255,0.06); font: 700 14px/1.2 system-ui, sans-serif; }
.rc-standings div.you { background: rgba(79,179,255,0.28); }
.rc-actions { display: grid; gap: 8px; margin-top: 4px; }
.rc-btn { padding: 13px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: #fff; font: 800 15px/1 system-ui, sans-serif; letter-spacing: 0.04em; cursor: pointer; }
.rc-btn.primary { background: linear-gradient(#4fb3ff, #1f7fd6); border-color: transparent; box-shadow: 0 6px 20px rgba(79,179,255,0.4); }
.rc-keys { text-align: center; font: 600 12px/1.5 system-ui, sans-serif; color: rgba(255,255,255,0.65); }
@media (pointer: coarse) { .rc-keys { display: none; } }
`;

let styled = false;
const SUFFIX = ['', 'st', 'nd', 'rd', 'th'];
export const MEDALS = ['🥇', '🥈', '🥉'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const clock = (steps) => {
  const s = steps / 60;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

export function createHud() {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    styled = true;
  }
  const root = el('div', 'rc-hud');
  const top = el('div', 'rc-top');
  const place = el('div', 'rc-place');
  const right = el('div', 'rc-right');
  top.append(place, right);
  const center = el('div', 'rc-center');
  const pops = el('div');
  const help = el('div', 'rc-help', '← → steer · hold Space to drift, let go to boost · S brake');
  root.append(top, center, pops, help);
  document.body.append(root);
  let menu;
  let shown = '';

  function closeMenu() {
    menu?.remove();
    menu = undefined;
    top.hidden = false;
    help.hidden = false;
  }

  function openMenu(build) {
    closeMenu();
    menu = el('div', 'rc-menu');
    const card = el('div', 'rc-card');
    build(card);
    menu.append(card);
    root.append(menu);
    top.hidden = true;
    help.hidden = true;
    center.textContent = '';
    menu.querySelector('.primary, .rc-row:not(:disabled)')?.focus();
  }

  const button = (label, className, onClick) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };

  return {
    closeMenu,

    showTracks(tracks, progress, onPick) {
      openMenu((card) => {
        card.append(el('h2', '', '🏎️ PINGO KARTS'));
        card.append(el('div', 'rc-sub', 'Finish in the top 3 to unlock the next track'));
        tracks.forEach((track, i) => {
          const locked = i >= progress.unlocked;
          const best = progress.best[i];
          const row = button('', `rc-row${i === progress.unlocked - 1 ? ' next' : ''}`, () => onPick(i));
          row.disabled = locked;
          const who = el('div');
          who.append(el('strong', '', track.name), el('span', '', locked ? '🔒 Finish top 3 on the one above' : best ? `Best ${clock(best)}` : track.nick));
          const medal = best ? track.medals.findIndex((m) => best <= m * 60) : -1;
          row.append(el('div', 'n', locked ? '🔒' : medal >= 0 ? MEDALS[medal] : String(i + 1)), who, el('em', '', locked ? '' : 'RACE ▶'));
          card.append(row);
        });
        card.append(el('div', 'rc-keys', '← → steer · hold Space to drift, let go to boost · S brake'));
      });
    },

    showIntro(track, onGo) {
      openMenu((card) => {
        card.append(el('h2', '', track.name.toUpperCase()), el('div', 'rc-sub', `${track.laps} laps · 🥇 under ${track.medals[0]}s`));
        const tips = el('div', 'rc-sub');
        tips.innerHTML = '💡 Hold <b>DRIFT</b> through a bend: blue → orange → <b>pink</b> sparks, then let go for a turbo.<br>Tap <b>DRIFT</b> just before GO for a rocket start.';
        card.append(tips);
        const actions = el('div', 'rc-actions');
        actions.append(button('START', 'rc-btn primary', onGo));
        card.append(actions);
      });
    },

    showResults(title, lines, standings, choices) {
      openMenu((card) => {
        card.append(el('h2', '', title));
        for (const line of lines) card.append(el('div', 'rc-sub', line));
        const list = el('div', 'rc-standings');
        for (const [name, time, you] of standings) {
          const row = el('div', you ? 'you' : '');
          row.append(el('span', '', name), el('span', '', time));
          list.append(row);
        }
        card.append(list);
        const actions = el('div', 'rc-actions');
        for (const [label, onClick, primary] of choices) actions.append(button(label, `rc-btn${primary ? ' primary' : ''}`, onClick));
        card.append(actions);
      });
    },

    pop(text, color = '#fff') {
      const node = el('div', 'rc-pop', text);
      node.style.color = color;
      pops.append(node);
      setTimeout(() => node.remove(), 1050);
    },

    update(race, you = 0) {
      if (menu) {
        center.textContent = '';
        return;
      }
      const k = race.karts[you];
      const p = k.place;
      const next = `${p}|${Math.min(race.laps, k.lap + 1)}|${Math.floor(race.time / 6)}|${race.phase}|${race.phase === 'countdown' ? Math.floor(race.t / 60) : race.t < 50}`;
      if (next === shown) return;
      shown = next;
      place.innerHTML = `${p}<sup>${SUFFIX[Math.min(p, 4)]}</sup><small>/ ${race.karts.length}</small>`;
      right.innerHTML = `LAP ${Math.max(1, Math.min(race.laps, k.lap + 1))}/${race.laps}<b>${clock(race.time)}</b>`;
      let text = '';
      if (race.phase === 'countdown') text = String(3 - Math.floor(race.t / 60));
      else if (race.phase === 'race' && race.t < 50) text = 'GO!';
      else if (race.phase === 'finished') text = 'FINISH!';
      center.textContent = text;
      center.classList.toggle('go', text === 'GO!');
    },

    dispose() {
      root.remove();
    },
  };
}
