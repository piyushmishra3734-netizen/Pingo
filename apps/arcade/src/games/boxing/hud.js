import { MAX_HEALTH, MAX_STAMINA, REMATCH_AFTER, ROUNDS_TO_WIN } from './match.js';

/**
 * The boxing scoreboard: health and stamina for both corners, the round and
 * its clock, and the big words - ROUND 1, FIGHT, K.O.
 *
 * DOM over the canvas rather than drawn in the scene: sharp text at any
 * pixel ratio, and the bars cost nothing to animate.
 */

const STYLE = `
.bx-hud { position: fixed; inset: 0; z-index: 2; pointer-events: none; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff; }
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
.bx-clock { text-align: center; font: 800 12px/1.1 system-ui, sans-serif; letter-spacing: 0.1em; text-shadow: 0 1px 2px #000; }
.bx-clock b { display: block; font-size: 28px; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
.bx-banner { position: absolute; left: 0; right: 0; top: 36%; text-align: center; font: 900 clamp(34px, 9vw, 72px)/1 system-ui, sans-serif; letter-spacing: 0.04em; text-shadow: 0 4px 0 #000, 0 0 24px rgba(255,79,139,0.7); }
.bx-banner small { display: block; margin-top: 12px; font-size: clamp(13px, 3vw, 18px); font-weight: 700; letter-spacing: 0.08em; text-shadow: 0 1px 2px #000; }
.bx-help { position: absolute; left: 0; right: 0; bottom: max(18px, env(safe-area-inset-bottom)); text-align: center; font: 600 13px/1.4 system-ui, sans-serif; color: rgba(255,255,255,0.8); text-shadow: 0 1px 2px #000; }
@media (pointer: coarse) { .bx-help { display: none; } }
`;

let styled = false;

function side(name, right) {
  const root = document.createElement('div');
  root.className = `bx-side${right ? ' right' : ''}`;
  root.innerHTML = `<div class="bx-name"><span></span><span class="bx-wins"></span></div><div class="bx-bar"><i></i></div><div class="bx-bar thin"><i></i></div>`;
  root.querySelector('.bx-name span').textContent = name;
  const [health, stamina] = root.querySelectorAll('.bx-bar i');
  return { root, health, stamina, wins: root.querySelector('.bx-wins') };
}

export function createHud(names = ['YOU', 'CPU']) {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    styled = true;
  }
  const root = document.createElement('div');
  root.className = 'bx-hud';
  const top = document.createElement('div');
  top.className = 'bx-top';
  const sides = names.map((name, i) => side(name, i === 1));
  const clock = document.createElement('div');
  clock.className = 'bx-clock';
  top.append(sides[0].root, clock, sides[1].root);
  const banner = document.createElement('div');
  banner.className = 'bx-banner';
  const help = document.createElement('div');
  help.className = 'bx-help';
  help.textContent = '← → move · J jab · K power · L block · S slip';
  root.append(top, banner, help);
  document.body.append(root);

  let lastBanner = '';

  return {
    update(match) {
      match.boxers.forEach((boxer, i) => {
        sides[i].health.style.width = `${(100 * boxer.health) / MAX_HEALTH}%`;
        sides[i].stamina.style.width = `${(100 * boxer.stamina) / MAX_STAMINA}%`;
        sides[i].wins.textContent = '●'.repeat(match.wins[i]) + '○'.repeat(Math.max(0, ROUNDS_TO_WIN - match.wins[i]));
      });
      clock.innerHTML = `ROUND ${match.round}<b>${Math.ceil(match.timer / 60)}</b>`;

      let text = '';
      let sub = '';
      if (match.phase === 'intro') text = `ROUND ${match.round}`;
      else if (match.phase === 'fight' && match.t < 45) text = 'FIGHT!';
      else if (match.phase === 'ko') text = 'K.O.';
      else if (match.phase === 'timeup') text = 'TIME';
      else if (match.phase === 'over') {
        text = match.winner === null ? 'DRAW' : match.winner === 0 ? 'YOU WIN!' : 'CPU WINS';
        if (match.t >= REMATCH_AFTER) sub = 'Jab for a rematch';
      }
      const next = `${text}|${sub}`;
      if (next !== lastBanner) {
        lastBanner = next;
        banner.textContent = text;
        if (sub) {
          const small = document.createElement('small');
          small.textContent = sub;
          banner.append(small);
        }
      }
    },

    dispose() {
      root.remove();
    },
  };
}
