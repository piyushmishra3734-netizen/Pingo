import { ChevronLeft, ChevronRight, Coins, Map as MapIcon, Menu, Sparkle, Ticket, User } from 'lucide';

import { icon } from './icon.js';

/**
 * The tram's screen furniture, drawn after the film: a white "To <station>"
 * pill and a dark passengers-and-coins pill top left; ticket, map and menu
 * buttons top right; at the bottom the comfort line, the route bar and a white
 * driving panel (speed, lean arrows, the crosswind gauge, Power and Brake).
 * At a station the panel shrinks to "aboard" and an Open doors button.
 *
 * Power, Brake and the lean arrows are held, by touch or by key (W/S, A/D or
 * the arrows); E opens the doors. The HUD only reports presses, the driving
 * logic decides what they do.
 */

const STYLE = `
.th { position: fixed; inset: 0; z-index: 2; pointer-events: none; color: #1f2230; font: 600 14px/1.2 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
.th[hidden], .th [hidden] { display: none !important; }
.th button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; touch-action: none; }
.th-tl { position: absolute; left: max(10px, env(safe-area-inset-left)); top: max(10px, env(safe-area-inset-top)); display: grid; gap: 8px; justify-items: start; }
.th-dest { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px 0 12px; border-radius: 999px; background: #fff; box-shadow: 0 4px 14px rgba(20,24,40,0.18); font-weight: 650; font-size: 14px; max-width: calc(100vw - 150px); }
.th-dest span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.th-dest .ic { color: #f0655a; fill: #f0655a; }
.th-purse { display: flex; align-items: center; height: 30px; padding: 0 10px; border-radius: 999px; background: rgba(28,32,48,0.62); border: 1px solid rgba(255,255,255,0.12); color: #fff; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.th-pax { display: flex; gap: 1px; margin-right: 8px; }
.th-pax .ic { color: #f2b35e; fill: #f2b35e; }
.th-pax .ic.off { color: rgba(255,255,255,0.28); fill: none; }
.th-mult { padding-right: 9px; margin-right: 9px; border-right: 1px solid rgba(255,255,255,0.18); height: 100%; display: flex; align-items: center; }
.th-coins { display: flex; align-items: center; gap: 6px; }
.th-coins .ic { color: #f5c542; }
.th-tr { position: absolute; right: max(10px, env(safe-area-inset-right)); top: max(10px, env(safe-area-inset-top)); display: flex; gap: 8px; }
.th-round { pointer-events: auto; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: #fff !important; box-shadow: 0 4px 14px rgba(20,24,40,0.18); }
.th-round:active { transform: scale(0.94); }
.th-round.ticket .ic { color: #ef8a5a; }
.th-msg { position: absolute; left: 50%; top: max(104px, calc(env(safe-area-inset-top) + 94px)); transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 8px 14px; border-radius: 10px; background: rgba(28,32,48,0.66); color: #fff; font-size: 13px; text-align: center; opacity: 0; transition: opacity 300ms; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.th-msg.on { opacity: 1; }
.th-bottom { position: absolute; left: 0; right: 0; bottom: max(8px, env(safe-area-inset-bottom)); display: grid; justify-items: center; gap: 8px; padding: 0 max(8px, env(safe-area-inset-right)) 0 max(8px, env(safe-area-inset-left)); }
.th-dark { max-width: 100%; padding: 6px 11px; border-radius: 9px; background: rgba(28,32,48,0.66); color: #fff; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.th-route { display: flex; align-items: center; gap: 10px; width: min(306px, 100%); box-sizing: border-box; }
.th-route span { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.th-track { position: relative; flex: 1 0 60px; height: 2px; border-radius: 2px; background: rgba(255,255,255,0.32); }
.th-track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: linear-gradient(90deg, rgba(255,210,150,0.5), #ffd29a); }
.th-track b { position: absolute; top: 50%; width: 9px; height: 5px; border-radius: 3px; background: #f0655a; box-shadow: 0 0 0 1.5px #fff; transform: translate(-50%, -50%); }
.th-panel { pointer-events: auto; display: flex; align-items: center; gap: 12px; max-width: 100%; box-sizing: border-box; padding: 8px 10px 8px 12px; border-radius: 14px; background: #fffdf8; box-shadow: 0 8px 26px rgba(20,24,40,0.22); }
.th-speed { min-width: 70px; }
.th-speed b { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.th-speed small { font-size: 11px; color: #6b6f7d; margin-left: 3px; font-weight: 600; }
.th-aboard { font-size: 11px; color: #6b6f7d; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.th-arrow { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: #f1efe9 !important; color: #3a3e4c; flex: none; }
.th-gauge { width: 160px; display: grid; gap: 7px; justify-items: center; font-size: 11px; color: #6b6f7d; }
.th-line { position: relative; width: 100%; height: 3px; border-radius: 3px; background: linear-gradient(90deg, #e98a8a, #f3e8ea 50%, #8fb2e6); }
.th-line b { position: absolute; top: 50%; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 7px solid #2e3446; transform: translate(-50%, -20%); transition: left 120ms linear; }
.th-key { height: 36px; padding: 0 8px 0 12px; border-radius: 10px; display: flex; align-items: center; gap: 8px; flex: none; font-size: 13px; font-weight: 650; background: #f1efe9 !important; }
.th-key.power { background: #f4a28f !important; color: #3b1f1a; }
.th-key kbd { min-width: 16px; height: 18px; padding: 0 3px; box-sizing: border-box; border-radius: 4px; display: grid; place-items: center; font: 700 10px/1 system-ui, sans-serif; background: rgba(255,255,255,0.55); border: 1px solid rgba(0,0,0,0.12); }
.th-arrow.down, .th-key.down { filter: brightness(0.9); transform: scale(0.96); }
.th-stop { min-width: 300px; justify-content: space-between; padding: 8px 8px 8px 14px; }
.th-stop .th-aboard { font-size: 12.5px; color: #3a3e4c; }
.th-doors { height: 36px; padding: 0 10px 0 14px; border-radius: 10px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; background: #f4a28f !important; color: #3b1f1a; }
.th-doors:disabled { background: transparent !important; color: #b3b5bd; cursor: default; }
.th-doors:disabled kbd { display: none; }
.th-doors kbd { min-width: 16px; height: 18px; border-radius: 4px; display: grid; place-items: center; font: 700 10px/1 system-ui, sans-serif; background: rgba(255,255,255,0.55); border: 1px solid rgba(0,0,0,0.12); }
@media (pointer: coarse) { .th-key kbd, .th-doors kbd { display: none; } .th-key { padding: 0 14px; } }
@media (max-width: 560px) {
  .th-panel { gap: 7px; padding: 6px 7px 6px 10px; }
  .th-speed { min-width: 52px; }
  .th-speed b { font-size: 19px; }
  .th-gauge { width: auto; flex: 1 1 60px; min-width: 50px; }
  .th-key { height: 40px; padding: 0 9px; font-size: 12.5px; }
  .th-key kbd { display: none; }
  .th-arrow { width: 34px; height: 34px; }
  .th-stop { min-width: 0; width: 100%; }
}
`;

let styled = false;

function el(tag, className, child) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (child instanceof Node) node.append(child);
  else if (child !== undefined) node.textContent = child;
  return node;
}

const PAX_ICONS = 3;

/**
 * @param {{
 *   onPower?: (down: boolean) => void,
 *   onBrake?: (down: boolean) => void,
 *   onLean?: (dir: -1 | 0 | 1) => void,
 *   onOpenDoors?: () => void,
 *   onMap?: () => void,
 *   onMenu?: () => void,
 *   onTicket?: () => void,
 * }} handlers
 */
export function createTramHud({ onPower, onBrake, onLean, onOpenDoors, onMap, onMenu, onTicket } = {}) {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    styled = true;
  }

  const root = el('div', 'th');

  // Top left: destination, then passengers, multiplier and coins.
  const tl = el('div', 'th-tl');
  const dest = el('div', 'th-dest', icon(Sparkle, 14));
  const destText = el('span');
  dest.append(destText);
  const purse = el('div', 'th-purse');
  const pax = el('div', 'th-pax');
  const paxIcons = Array.from({ length: PAX_ICONS }, () => pax.appendChild(icon(User, 14)));
  const mult = el('div', 'th-mult');
  const coins = el('div', 'th-coins', icon(Coins, 15));
  const coinText = el('span');
  coins.append(coinText);
  purse.append(pax, mult, coins);
  tl.append(dest, purse);

  // Top right: ticket, map, menu.
  const round = (node, label, cls, onClick) => {
    const b = el('button', `th-round ${cls}`, icon(node, 18));
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => onClick?.());
    return b;
  };
  const tr = el('div', 'th-tr');
  tr.append(round(Ticket, 'Tickets', 'ticket', onTicket), round(MapIcon, 'Map', '', onMap), round(Menu, 'Menu', '', onMenu));

  const msg = el('div', 'th-msg');
  msg.setAttribute('role', 'status');

  // Bottom: comfort line, route bar, driving panel or station panel.
  const bottom = el('div', 'th-bottom');
  const comfort = el('div', 'th-dark');
  const route = el('div', 'th-dark th-route');
  const fromText = el('span');
  const track = el('div', 'th-track');
  const trackFill = el('i');
  const trackDot = el('b');
  track.append(trackFill, trackDot);
  const toText = el('span');
  route.append(fromText, track, toText);

  const drive = el('div', 'th-panel');
  const speedBox = el('div', 'th-speed');
  const speedLine = el('div');
  const speedNum = el('b');
  speedLine.append(speedNum, el('small', '', 'km/h'));
  const aboardDrive = el('div', 'th-aboard');
  speedBox.append(speedLine, aboardDrive);

  const held = { power: false, brake: false, left: false, right: false };
  const holdButtons = {};
  const leanDir = () => (held.right ? 1 : 0) - (held.left ? 1 : 0);
  function setHeld(name, down) {
    if (held[name] === down) return;
    const lean = leanDir();
    held[name] = down;
    holdButtons[name]?.classList.toggle('down', down);
    if (name === 'power') onPower?.(down);
    else if (name === 'brake') onBrake?.(down);
    else if (leanDir() !== lean) onLean?.(leanDir());
  }

  /** A button that stays pressed while a finger or mouse is on it. */
  function holdButton(name, className, child, label) {
    const b = el('button', className, child);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      setHeld(name, true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(type, () => setHeld(name, false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    holdButtons[name] = b;
    return b;
  }

  const keyButton = (text, key) => {
    const frag = document.createDocumentFragment();
    frag.append(document.createTextNode(text), el('kbd', '', key));
    return frag;
  };

  const left = holdButton('left', 'th-arrow', icon(ChevronLeft, 18), 'Lean left');
  const gauge = el('div', 'th-gauge');
  const gaugeLabel = el('div');
  const gaugeLine = el('div', 'th-line');
  const gaugeMark = el('b');
  gaugeLine.append(gaugeMark);
  gauge.append(gaugeLabel, gaugeLine);
  const right = holdButton('right', 'th-arrow', icon(ChevronRight, 18), 'Lean right');
  const power = holdButton('power', 'th-key power', keyButton('Power', 'W'), 'Power');
  const brake = holdButton('brake', 'th-key', keyButton('Brake', 'S'), 'Brake');
  drive.append(speedBox, left, gauge, right, power, brake);

  const stop = el('div', 'th-panel th-stop');
  const aboardStop = el('div', 'th-aboard');
  const doors = el('button', 'th-doors');
  doors.type = 'button';
  const doorsText = document.createTextNode('');
  doors.append(doorsText, el('kbd', '', 'E'));
  let canOpen = false;
  doors.addEventListener('click', () => canOpen && onOpenDoors?.());
  stop.append(aboardStop, doors);
  stop.hidden = true;

  bottom.append(comfort, route, drive, stop);
  root.append(tl, tr, msg, bottom);
  document.body.append(root);

  // Keyboard: held keys map to the same hold state as the buttons.
  const KEYS = { KeyW: 'power', ArrowUp: 'power', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  const typing = (e) => e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  function onKey(e) {
    if (root.hidden || typing(e)) return;
    const down = e.type === 'keydown';
    const name = KEYS[e.code];
    if (name) {
      e.preventDefault();
      setHeld(name, down);
    } else if (down && e.code === 'KeyE' && !e.repeat && canOpen) {
      onOpenDoors?.();
    }
  }
  const releaseAll = () => Object.keys(held).forEach((name) => setHeld(name, false));
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', releaseAll);

  // Writes go through here so the DOM is only touched when a value changes.
  const last = new Map();
  function put(key, value, apply) {
    if (last.get(key) === value) return;
    last.set(key, value);
    apply(value);
  }
  const text = (node) => (v) => { node.textContent = v; };

  let msgTimer = 0;

  return {
    update(s) {
      const atStation = s.phase === 'stopped' || s.phase === 'doors';
      const cap = Math.max(1, s.capacity || 0);
      const aboard = `${s.aboard ?? 0} / ${s.capacity ?? 0} aboard`;

      put('dest', atStation ? s.nextStation || '' : `To ${s.nextStation || ''}`, text(destText));
      put('pax', Math.round(((s.aboard || 0) / cap) * PAX_ICONS), (n) => paxIcons.forEach((node, i) => node.classList.toggle('off', i >= n)));
      put('mult', `×${(s.multiplier ?? 1).toFixed(1)}`, text(mult));
      put('coins', Math.round(s.coins || 0).toLocaleString('en-US'), text(coinText));

      put('station', atStation, (on) => {
        comfort.hidden = on;
        route.hidden = on;
        drive.hidden = on;
        stop.hidden = !on;
        if (on) releaseAll();
      });

      if (atStation) {
        put('aboardStop', aboard, text(aboardStop));
        canOpen = !!s.canOpenDoors;
        put('doors', canOpen, (on) => {
          doors.disabled = !on;
          doorsText.textContent = on ? 'Open doors' : 'Please wait…';
        });
        return;
      }

      put('comfort', `${Math.round((s.comfort || 0) * 100)}% leg comfort · +${Math.round(s.arrivalBonus || 0)} at arrival`, text(comfort));
      put('from', s.fromStation || '', text(fromText));
      put('to', s.nextStation || '', text(toText));
      put('progress', Math.round(Math.min(1, Math.max(0, s.progress || 0)) * 1000) / 10, (p) => {
        trackFill.style.width = `${p}%`;
        trackDot.style.left = `${p}%`;
      });
      put('speed', String(Math.round(s.speedKmh || 0)), text(speedNum));
      put('aboardDrive', aboard, text(aboardDrive));
      put('steady', s.steady ? 'Steady' : 'Crosswind', text(gaugeLabel));
      put('wind', Math.round((Math.min(1, Math.max(-1, s.crosswind || 0)) + 1) * 500) / 10, (p) => { gaugeMark.style.left = `${p}%`; });
    },

    /** A short line top centre, e.g. "Doors opening · Mango Tide". */
    message(value, ms = 3200) {
      clearTimeout(msgTimer);
      msg.textContent = value;
      msg.classList.add('on');
      msgTimer = setTimeout(() => msg.classList.remove('on'), ms);
    },

    show(on) {
      root.hidden = !on;
      if (!on) releaseAll();
    },

    dispose() {
      releaseAll();
      clearTimeout(msgTimer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', releaseAll);
      root.remove();
    },
  };
}
