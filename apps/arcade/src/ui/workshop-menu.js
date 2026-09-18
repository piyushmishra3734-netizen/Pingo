/**
 * The workshop screen's menu, after the film: a name pill in the top left
 * with a tram badge, tabs under it (Explore, Workshop, Driver ID, help), a
 * white "Build your tram." card on the right with category tabs, icon
 * sub-tabs and a list of parts with a check on the fitted one, a small
 * status card while a part is being fitted (name, step, progress, Cancel),
 * and "Start journey" in the bottom left.
 *
 * On phones the card docks to the bottom as a sheet that scrolls. This file
 * only draws and reports taps; the lead runs the fitting and calls setStatus.
 */

import { Armchair, ArrowRight, Check, CircleQuestionMark, Compass, Disc, Hammer, IdCard, Paintbrush, Play, Sparkles, TramFront, Umbrella, Wrench, X } from 'lucide';

import { icon } from './icon.js';

const STYLE = `
.wm { position: fixed; inset: 0; z-index: 4; pointer-events: none; font: 600 14px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1f2640; }
.wm[hidden] { display: none; }
.wm button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.wm button:focus-visible { outline: 2px solid #5b7bd5; outline-offset: 2px; }
.wm-top { position: absolute; left: max(12px, env(safe-area-inset-left)); top: max(12px, env(safe-area-inset-top)); display: flex; flex-direction: column; align-items: flex-start; gap: 10px; max-width: calc(100vw - 24px); }
.wm-pill { display: flex; align-items: center; gap: 10px; padding: 7px 16px 7px 7px; border-radius: 14px; background: #fffdf8; box-shadow: 0 4px 16px rgba(10,14,40,0.25); pointer-events: auto; }
.wm-badge { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: #c9573f; color: #fff4dc; }
.wm-pill b { display: block; font: 800 18px/1.1 system-ui, sans-serif; }
.wm-pill small { display: block; font: 500 11px/1.3 system-ui, sans-serif; color: #7a7f93; }
.wm-tabs { display: flex; gap: 8px; overflow-x: auto; max-width: 100%; scrollbar-width: none; pointer-events: auto; padding: 2px; }
.wm-tab { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border: 0; border-radius: 12px; background: #fffdf8; box-shadow: 0 3px 12px rgba(10,14,40,0.22); white-space: nowrap; }
.wm-tab.on { background: #2b3553; color: #fff; }
.wm-tab.round { width: 40px; padding: 0; justify-content: center; border-radius: 50%; }
.wm-tip { position: absolute; left: max(12px, env(safe-area-inset-left)); top: calc(max(12px, env(safe-area-inset-top)) + 116px); max-width: min(280px, calc(100vw - 24px)); padding: 10px 12px; border-radius: 12px; background: #2b3553; color: #fff; font-weight: 500; pointer-events: auto; }
.wm-tip[hidden] { display: none; }
.wm-card { position: absolute; right: max(12px, env(safe-area-inset-right)); top: max(84px, calc(env(safe-area-inset-top) + 72px)); width: 250px; max-height: calc(100vh - 170px); overflow-y: auto; padding: 12px; border-radius: 16px; background: #fffdf8; box-shadow: 0 8px 28px rgba(10,14,40,0.3); pointer-events: auto; }
.wm-card[hidden] { display: none; }
.wm-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font: 700 15px/1.2 system-ui, sans-serif; }
.wm-head span { flex: 1; }
.wm-x { width: 36px; height: 36px; margin: -8px -6px -8px 0; border: 0; border-radius: 50%; background: transparent; color: #8a8fa3 !important; display: grid; place-items: center; }
.wm-x:hover { background: #f0eee8; }
.wm-row { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; margin-bottom: 6px; }
.wm-seg { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 48px; padding: 4px 2px; border: 0; border-radius: 10px; background: transparent; color: #7a7f93 !important; font: 600 10px/1 system-ui, sans-serif !important; }
.wm-seg:hover { background: #f1efe9; }
.wm-seg.on { background: #2b3553; color: #fff !important; }
.wm-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.wm-opt { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; text-align: left; }
.wm-opt:hover { background: #f3f5f8; }
.wm-opt.on { background: #eef3f8; border-color: #dfe6ef; }
.wm-opt .lead { color: #7a7f93; }
.wm-opt span { flex: 1; }
.wm-opt .ck { visibility: hidden; color: #2b3553; }
.wm-opt.on .ck { visibility: visible; }
.wm-note { padding: 14px 6px; color: #7a7f93; font-weight: 500; }
.wm-status b { display: block; margin: 2px 0 10px; font: 800 15px/1.2 system-ui, sans-serif; }
.wm-bar { height: 4px; border-radius: 2px; background: #ebe7df; overflow: hidden; }
.wm-bar i { display: block; height: 100%; width: 0; background: #2b3553; border-radius: 2px; transition: width 200ms linear; }
.wm-status p { margin: 14px 0 6px; color: #5d6278; font-weight: 500; font-size: 12px; }
.wm-cancel { display: block; min-height: 40px; margin: 0 auto; padding: 0 18px; border: 0; border-radius: 10px; background: transparent; color: #5d6278 !important; font-size: 12px !important; }
.wm-cancel:hover { background: #f1efe9; }
.wm-start { position: absolute; left: max(12px, env(safe-area-inset-left)); bottom: max(12px, env(safe-area-inset-bottom)); display: inline-flex; align-items: center; gap: 14px; min-height: 44px; padding: 0 16px; border: 0; border-radius: 12px; background: #fffdf8; box-shadow: 0 4px 16px rgba(10,14,40,0.28); font-weight: 700 !important; pointer-events: auto; }
.wm-start:active, .wm-tab:active, .wm-opt:active { transform: scale(0.98); }
@media (max-width: 640px) {
  .wm-pill small { display: none; }
  .wm-card { top: auto; left: max(12px, env(safe-area-inset-left)); right: max(12px, env(safe-area-inset-right)); bottom: calc(max(12px, env(safe-area-inset-bottom)) + 56px); width: auto; max-height: 46vh; }
}
`;

let styled = false;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (className, children, label) => {
  const node = el('button', className);
  node.type = 'button';
  node.append(...children);
  if (label) node.setAttribute('aria-label', label);
  return node;
};

const CATEGORIES = [
  ['build', 'Build', Hammer],
  ['upgrades', 'Upgrades', Wrench],
  ['care', 'Care', Sparkles],
  ['test', 'Test', Play],
];
const PARTS = [
  ['tram', 'Tram', TramFront],
  ['roof', 'Roof', Umbrella],
  ['wheels', 'Wheels', Disc],
  ['car', 'Coach', Armchair],
  ['paint', 'Paint', Paintbrush],
  ['extras', 'Extras', Sparkles],
];

/**
 * @param {{
 *   roofs: { id: string, name: string }[],
 *   cars: { id: string, name: string }[],
 *   selected: { roof?: string, car?: string },
 *   onPick: (kind: 'roof' | 'car', id: string) => void,
 *   onStart: () => void,
 *   onExplore: () => void,
 *   onCancel?: () => void,
 *   title?: string,
 *   subtitle?: string,
 * }} options - `onCancel` is called by the status card's Cancel button
 */
export function createWorkshopMenu({ roofs, cars, selected, onPick, onStart, onExplore, onCancel, title = 'Pingo Cloudworks', subtitle = 'Your home workshop' }) {
  if (!styled) {
    const style = el('style');
    style.textContent = STYLE;
    document.head.append(style);
    styled = true;
  }
  const chosen = { roof: selected?.roof, car: selected?.car };
  const lists = { roof: roofs, car: cars };
  let category = 'build';
  let part = 'roof';
  let status = null;
  let cardOpen = true;

  const root = el('div', 'wm');

  // Top left: the name pill and the tabs.
  const top = el('div', 'wm-top');
  const badge = el('span', 'wm-badge');
  badge.append(icon(TramFront, 24));
  const names = el('span');
  names.append(el('b', '', title), el('small', '', subtitle));
  const pill = el('div', 'wm-pill');
  pill.append(badge, names);
  const tabs = el('div', 'wm-tabs');
  const explore = button('wm-tab', [icon(Compass, 16), 'Explore']);
  const workshop = button('wm-tab on', [icon(Wrench, 16), 'Workshop']);
  const driver = button('wm-tab', [icon(IdCard, 16), 'Driver ID']);
  const help = button('wm-tab round', [icon(CircleQuestionMark, 18)], 'Help');
  tabs.append(explore, workshop, driver, help);
  top.append(pill, tabs);
  const tip = el('div', 'wm-tip');
  tip.hidden = true;

  const showTip = (text) => {
    tip.textContent = text;
    tip.hidden = false;
    clearTimeout(showTip.timer);
    showTip.timer = setTimeout(() => (tip.hidden = true), 3500);
  };
  explore.addEventListener('click', () => onExplore());
  workshop.addEventListener('click', () => {
    cardOpen = true;
    render();
  });
  driver.addEventListener('click', () => showTip('Driver ID is coming soon.'));
  help.addEventListener('click', () => showTip('Pick a part to fit it to your tram, then press Start journey.'));

  // The card: build menu or fitting status.
  const card = el('div', 'wm-card');
  const start = button('wm-start', [el('span', '', 'Start journey'), icon(ArrowRight, 18)]);
  start.addEventListener('click', () => onStart());
  root.append(top, tip, card, start);
  document.body.append(root);

  // Pointer events on the menu must not reach the 3D view underneath.
  const stop = (event) => event.stopPropagation();
  for (const type of ['pointerdown', 'wheel', 'touchstart']) root.addEventListener(type, stop, { passive: true });

  function head(iconNode, text) {
    const row = el('div', 'wm-head');
    if (iconNode) row.append(icon(iconNode, 18));
    const close = button('wm-x', [icon(X, 16)], 'Close');
    close.addEventListener('click', () => {
      if (status) onCancel?.();
      else {
        cardOpen = false;
        render();
      }
    });
    row.append(el('span', '', text), close);
    return row;
  }

  function segments(items, current, pick) {
    const row = el('div', 'wm-row');
    for (const [id, label, node] of items) {
      const seg = button(`wm-seg${id === current ? ' on' : ''}`, [icon(node, 16), label]);
      seg.setAttribute('aria-pressed', String(id === current));
      seg.addEventListener('click', () => pick(id));
      row.append(seg);
    }
    return row;
  }

  function render() {
    card.hidden = !cardOpen && !status;
    workshop.classList.toggle('on', !card.hidden);
    if (card.hidden) return;
    if (status) {
      const box = el('div', 'wm-status');
      const bar = el('div', 'wm-bar');
      const fill = el('i');
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, status.progress ?? 0)) * 100)}%`;
      bar.append(fill);
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuenow', String(Math.round((status.progress ?? 0) * 100)));
      const cancel = button('wm-cancel', ['Cancel']);
      cancel.addEventListener('click', () => onCancel?.());
      box.append(head(null, status.name ?? ''), el('b', '', status.text ?? ''), bar, el('p', '', 'Sit back and watch the workshop.'), cancel);
      card.replaceChildren(box);
      return;
    }
    const body = [head(TramFront, 'Build your tram.'), segments(CATEGORIES, category, (id) => ((category = id), render()))];
    if (category !== 'build') {
      body.push(el('div', 'wm-note', 'Coming soon.'));
    } else {
      body.push(segments(PARTS, part, (id) => ((part = id), render())));
      const items = lists[part];
      if (!items?.length) {
        body.push(el('div', 'wm-note', 'Coming soon.'));
      } else {
        const list = el('div', 'wm-list');
        for (const { id, name } of items) {
          const on = chosen[part] === id;
          const opt = button(`wm-opt${on ? ' on' : ''}`, [icon(part === 'roof' ? Umbrella : Armchair, 16, 'ic lead'), el('span', '', name), icon(Check, 16, 'ic ck')]);
          opt.setAttribute('aria-pressed', String(on));
          opt.addEventListener('click', () => {
            if (chosen[part] === id) return;
            onPick(part, id);
          });
          list.append(opt);
        }
        body.push(list);
      }
    }
    card.replaceChildren(...body);
  }
  render();

  return {
    /** The fitting card: `{ name, text, progress 0-1 }`, or null to go back to the build menu. */
    setStatus(next) {
      status = next;
      render();
    },
    /** Moves the check to the fitted part. */
    setSelected(kind, id) {
      chosen[kind] = id;
      if (!status) render();
    },
    show(on) {
      root.hidden = !on;
    },
    dispose() {
      clearTimeout(showTip.timer);
      root.remove();
    },
  };
}
