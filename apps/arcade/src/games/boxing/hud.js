import { GET_UP, MAX_HEALTH, MAX_STAMINA, MAX_STARS, ROUNDS_TO_WIN } from './match.js';

/**
 * The boxing screen furniture: health, stamina and stars for both corners,
 * the round and its clock, the big words (ROUND 1, FIGHT, K.O.), the count
 * over a boxer on the canvas, pop-ups where punches land, and the menus -
 * pick an opponent, then next fight or rematch.
 *
 * DOM over the canvas rather than drawn in the scene: sharp text at any
 * pixel ratio, and the bars cost nothing to animate.
 */

const STYLE = `
.bx-hud [hidden] { display: none !important; }
.bx-hud { position: fixed; inset: 0; z-index: 1; pointer-events: none; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff; }
.bx-top { position: absolute; left: 0; right: 0; top: max(56px, calc(env(safe-area-inset-top) + 48px)); display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: start; padding: 0 max(14px, env(safe-area-inset-left)); }
.bx-side { display: grid; gap: 5px; }
.bx-side.right { justify-items: end; }
.bx-name { font: 800 13px/1 system-ui, sans-serif; letter-spacing: 0.08em; text-shadow: 0 1px 2px #000; display: flex; gap: 8px; align-items: center; }
.bx-wins { color: #ffcf4a; letter-spacing: 2px; }
.bx-bar { width: min(38vw, 320px); height: 14px; border-radius: 3px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25); overflow: hidden; position: relative; }
.bx-bar i { position: absolute; top: 0; bottom: 0; left: 0; background: linear-gradient(#ff6b6b, #d7263d); transition: width 120ms linear; }
.bx-side.right .bx-bar i { left: auto; right: 0; }
.bx-bar.thin { height: 6px; }
.bx-bar.thin i { background: linear-gradient(#7ff0d8, #29b7a3); }
.bx-stars { font-size: 17px; line-height: 1; letter-spacing: 3px; color: rgba(255,255,255,0.25); text-shadow: 0 1px 2px #000; }
.bx-stars b { color: #ffc83a; font-weight: 400; text-shadow: 0 0 8px rgba(255,200,58,0.9); }
.bx-clock { text-align: center; font: 800 12px/1.1 system-ui, sans-serif; letter-spacing: 0.1em; text-shadow: 0 1px 2px #000; }
.bx-clock b { display: block; font-size: 28px; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
.bx-banner { position: absolute; left: 0; right: 0; top: 34%; text-align: center; font: 900 clamp(34px, 9vw, 72px)/1 system-ui, sans-serif; letter-spacing: 0.04em; text-shadow: 0 4px 0 #000, 0 0 24px rgba(255,79,139,0.7); }
.bx-banner small { display: block; margin-top: 12px; font-size: clamp(13px, 3vw, 18px); font-weight: 700; letter-spacing: 0.08em; text-shadow: 0 1px 2px #000; }
.bx-banner.count { font-size: clamp(64px, 16vw, 120px); animation: bx-thump 300ms ease-out; }
.bx-mash { width: min(60vw, 260px); height: 12px; margin: 14px auto 0; border-radius: 6px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.4); overflow: hidden; }
.bx-mash i { display: block; height: 100%; background: linear-gradient(90deg, #ffc83a, #ff4f8b); transition: width 80ms linear; }
.bx-help { position: absolute; left: 0; right: 0; bottom: max(18px, env(safe-area-inset-bottom)); text-align: center; font: 600 13px/1.4 system-ui, sans-serif; color: rgba(255,255,255,0.8); text-shadow: 0 1px 2px #000; }
@media (pointer: coarse) { .bx-help { display: none; } }
.bx-pop { position: absolute; transform: translate(-50%, -50%); font: 900 22px/1 system-ui, sans-serif; text-shadow: 0 2px 0 #000, 0 0 12px rgba(0,0,0,0.6); white-space: nowrap; animation: bx-rise 900ms ease-out forwards; }
.bx-pop.big { font-size: clamp(26px, 6vw, 40px); color: #ffc83a; }
.bx-pop.combo { color: #7ff0d8; font-size: 20px; }
.bx-pop.star { color: #ffc83a; font-size: 26px; }
@keyframes bx-rise { 0% { opacity: 0; margin-top: 10px; scale: 0.6; } 15% { opacity: 1; scale: 1.15; } 30% { scale: 1; } 100% { opacity: 0; margin-top: -60px; } }
@keyframes bx-thump { 0% { scale: 1.6; opacity: 0; } 100% { scale: 1; opacity: 1; } }
.bx-menu { position: absolute; inset: 0; display: grid; place-items: center; padding: 64px 16px 24px; overflow-y: auto; pointer-events: auto; background: radial-gradient(ellipse at center, rgba(7,5,12,0.55), rgba(7,5,12,0.92)); }
.bx-card { width: min(100%, 440px); display: grid; gap: 10px; }
.bx-card h2 { margin: 0; font: 900 clamp(26px, 7vw, 36px)/1 system-ui, sans-serif; letter-spacing: 0.04em; text-align: center; text-shadow: 0 3px 0 #000; }
.bx-sub { text-align: center; font: 700 13px/1.4 system-ui, sans-serif; color: rgba(255,255,255,0.75); }
.bx-sub b { color: #ffc83a; }
.bx-foe { display: grid; grid-template-columns: 34px 1fr auto; gap: 10px; align-items: center; width: 100%; padding: 11px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); color: #fff; font: inherit; text-align: left; cursor: pointer; }
.bx-foe:hover:not(:disabled), .bx-foe:focus-visible { background: rgba(255,79,139,0.22); border-color: #ff4f8b; outline: none; }
.bx-foe:disabled { opacity: 0.45; cursor: default; }
.bx-foe.next { border-color: #ff4f8b; box-shadow: 0 0 0 1px #ff4f8b, 0 0 22px rgba(255,79,139,0.35); }
.bx-foe .n { font: 900 20px/1 system-ui, sans-serif; color: rgba(255,255,255,0.5); text-align: center; }
.bx-foe strong { display: block; font: 800 16px/1.2 system-ui, sans-serif; }
.bx-foe span { display: block; font: 600 12px/1.3 system-ui, sans-serif; color: rgba(255,255,255,0.65); }
.bx-foe em { font: 800 12px/1 system-ui, sans-serif; font-style: normal; letter-spacing: 0.06em; color: #ffc83a; }
.bx-tip { padding: 10px 12px; border-radius: 10px; background: rgba(255,200,58,0.12); border: 1px solid rgba(255,200,58,0.35); font: 600 13px/1.4 system-ui, sans-serif; text-align: center; }
.bx-actions { display: grid; gap: 8px; margin-top: 4px; }
.bx-btn { padding: 13px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: #fff; font: 800 15px/1 system-ui, sans-serif; letter-spacing: 0.04em; cursor: pointer; }
.bx-btn.primary { background: linear-gradient(#ff4f8b, #d7266a); border-color: transparent; box-shadow: 0 6px 20px rgba(255,79,139,0.35); }
.bx-keys { text-align: center; font: 600 12px/1.5 system-ui, sans-serif; color: rgba(255,255,255,0.6); }
@media (pointer: coarse) { .bx-keys { display: none; } }
`;

let styled = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function side(right) {
  const root = el('div', `bx-side${right ? ' right' : ''}`);
  root.innerHTML = `<div class="bx-name"><span></span><span class="bx-wins"></span></div><div class="bx-bar"><i></i></div><div class="bx-bar thin"><i></i></div><div class="bx-stars"></div>`;
  const [health, stamina] = root.querySelectorAll('.bx-bar i');
  return { root, name: root.querySelector('.bx-name span'), health, stamina, wins: root.querySelector('.bx-wins'), stars: root.querySelector('.bx-stars'), shown: -1 };
}

export function createHud() {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    styled = true;
  }
  const root = el('div', 'bx-hud');
  const top = el('div', 'bx-top');
  const sides = [side(false), side(true)];
  sides[0].name.textContent = 'YOU';
  const clock = el('div', 'bx-clock');
  top.append(sides[0].root, clock, sides[1].root);
  const banner = el('div', 'bx-banner');
  const pops = el('div');
  const help = el('div', 'bx-help', '← → move · J jab · K power · L block · S slip · I ★ star punch');
  root.append(top, pops, banner, help);
  document.body.append(root);

  let lastBanner = '';
  let menu;

  function closeMenu() {
    menu?.remove();
    menu = undefined;
    top.hidden = false;
    help.hidden = false;
  }

  /** A full-screen card; the fight furniture hides behind it. */
  function openMenu(build) {
    closeMenu();
    menu = el('div', 'bx-menu');
    const card = el('div', 'bx-card');
    build(card);
    menu.append(card);
    root.append(menu);
    top.hidden = true;
    help.hidden = true;
    banner.textContent = '';
    lastBanner = '';
    menu.querySelector('.primary, .bx-foe:not(:disabled)')?.focus();
  }

  function button(label, className, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  return {
    setOpponent(name) {
      sides[1].name.textContent = name.toUpperCase();
    },

    /** The ladder: every opponent, the next one lit, later ones locked. */
    showLadder(roster, progress, onPick) {
      openMenu((card) => {
        card.append(el('h2', '', '🥊 PINGO BOXING'));
        const sub = el('div', 'bx-sub');
        const belt = progress.beaten >= roster.length ? '🏆 Champion' : `Beaten <b>${progress.beaten}/${roster.length}</b>`;
        sub.innerHTML = `${belt}${progress.streak ? ` · 🔥 <b>${progress.streak}</b>-day streak` : ''}`;
        card.append(sub);
        roster.forEach((foe, i) => {
          const locked = i > progress.beaten;
          const pick = button('', `bx-foe${i === Math.min(progress.beaten, roster.length - 1) ? ' next' : ''}`, () => onPick(i));
          pick.disabled = locked;
          const who = el('div');
          who.append(el('strong', '', foe.name), el('span', '', locked ? 'Beat the one above to unlock' : foe.nick));
          pick.append(el('div', 'n', locked ? '🔒' : String(i + 1)), who, el('em', '', i < progress.beaten ? '✓ BEATEN' : locked ? '' : 'FIGHT ▶'));
          card.append(pick);
        });
        card.append(el('div', 'bx-keys', 'J jab · K power · L block · S slip · I star punch'));
      });
    },

    /** Before the bell: who, and the one thing to watch for. */
    showIntro(foe, index, onGo) {
      openMenu((card) => {
        card.append(el('div', 'bx-sub', `FIGHT ${index + 1}`), el('h2', '', foe.name.toUpperCase()), el('div', 'bx-sub', `“${foe.nick}”`));
        card.append(el('div', 'bx-tip', `💡 ${foe.tip}`));
        const actions = el('div', 'bx-actions');
        actions.append(button('FIGHT!', 'bx-btn primary', onGo));
        card.append(actions);
      });
    },

    /** After the last bell: what now. `choices` are [label, onClick, primary?]. */
    showEnd(title, line, choices) {
      openMenu((card) => {
        card.append(el('h2', '', title));
        if (line) card.append(el('div', 'bx-sub', line));
        const actions = el('div', 'bx-actions');
        for (const [label, onClick, primary] of choices) actions.append(button(label, `bx-btn${primary ? ' primary' : ''}`, onClick));
        card.append(actions);
      });
    },

    closeMenu,

    get menuOpen() {
      return Boolean(menu);
    },

    /** A word that jumps out of a spot on the screen and floats away. */
    pop(text, x, y, kind = '') {
      const node = el('div', `bx-pop ${kind}`, text);
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      pops.append(node);
      setTimeout(() => node.remove(), 950);
    },

    update(match, youDown) {
      match.boxers.forEach((boxer, i) => {
        const s = sides[i];
        s.health.style.width = `${(100 * boxer.health) / MAX_HEALTH}%`;
        s.stamina.style.width = `${(100 * boxer.stamina) / MAX_STAMINA}%`;
        s.wins.textContent = '●'.repeat(match.wins[i]) + '○'.repeat(Math.max(0, ROUNDS_TO_WIN - match.wins[i]));
        if (s.shown !== boxer.stars) {
          s.shown = boxer.stars;
          s.stars.innerHTML = `<b>${'★'.repeat(boxer.stars)}</b>${'☆'.repeat(MAX_STARS - boxer.stars)}`;
        }
      });
      clock.innerHTML = `ROUND ${match.round}<b>${Math.ceil(match.timer / 60)}</b>`;
      if (menu) return;

      let text = '';
      let sub = '';
      let mash = -1;
      let count = false;
      if (match.phase === 'intro') text = `ROUND ${match.round}`;
      else if (match.phase === 'fight' && match.t < 45) text = 'FIGHT!';
      else if (match.phase === 'down') {
        const fallen = match.boxers.find((b) => b.state === 'down');
        text = fallen && fallen.count ? String(fallen.count) : 'DOWN!';
        count = Boolean(fallen?.count);
        if (fallen && youDown) {
          sub = 'MASH JAB TO GET UP!';
          mash = Math.min(1, fallen.mash / GET_UP[fallen.knockdowns - 1].presses);
        } else if (fallen) sub = 'Stay down…';
      } else if (match.phase === 'ko') text = 'K.O.!';
      else if (match.phase === 'timeup') text = 'TIME';
      else if (match.phase === 'over') text = match.winner === 0 ? 'YOU WIN!' : match.winner === null ? 'DRAW' : 'YOU LOSE';
      const next = `${text}|${sub}|${mash.toFixed(2)}`;
      if (next !== lastBanner) {
        const textChanged = lastBanner.split('|')[0] !== text;
        lastBanner = next;
        banner.textContent = text;
        banner.classList.toggle('count', count);
        if (count && textChanged) {
          banner.style.animation = 'none';
          void banner.offsetWidth;
          banner.style.animation = '';
        }
        if (sub) banner.append(el('small', '', sub));
        if (mash >= 0) {
          const bar = el('div', 'bx-mash');
          const fill = el('i');
          fill.style.width = `${mash * 100}%`;
          bar.append(fill);
          banner.append(bar);
        }
      }
    },

    dispose() {
      root.remove();
    },
  };
}
