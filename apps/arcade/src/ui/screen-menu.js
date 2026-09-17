/**
 * The PINGO machine's own screen: what you see once you sit down. Pick a game,
 * against the computer or against your friend; invite a friend if nobody is
 * here yet; answer when your friend picks a game.
 *
 * It is laid over the cabinet's screen, measured from the screen's projected
 * corners every frame. Where that is too small to read (a phone held
 * upright) it grows out of the screen to fill the view, in the same CRT
 * frame, so it still reads as the machine talking.
 */

import { Bot, CarFront, Check, HandFist, Link, LogOut, Pencil, Swords, User, UserPlus, Users } from 'lucide';

import { icon, withIcon } from './icon.js';

const STYLE = `
.sm { position: fixed; z-index: 2; display: grid; grid-template-rows: auto auto 1fr; gap: 10px; box-sizing: border-box; padding: 14px; overflow: hidden;
  font: 600 14px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #f4f1fa;
  background: radial-gradient(120% 90% at 50% 0%, #2a1650 0%, #120a24 55%, #07040f 100%);
  border-radius: 14px; box-shadow: inset 0 0 0 2px rgba(255,79,139,0.35), inset 0 0 60px rgba(120,60,255,0.25), 0 0 40px rgba(255,79,139,0.25);
  transform-origin: center; animation: sm-on 380ms cubic-bezier(.2,.9,.3,1.2) both; }
.sm::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 3px); mix-blend-mode: overlay; }
.sm.full { inset: max(12px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(84px, calc(env(safe-area-inset-bottom) + 76px)) max(10px, env(safe-area-inset-left)) !important; width: auto !important; height: auto !important; overflow-y: auto; }
@keyframes sm-on { from { opacity: 0; transform: scale(0.92, 0.02); filter: brightness(3); } 60% { opacity: 1; transform: scale(1.01, 1.02); } to { transform: none; filter: none; } }
.sm[hidden] { display: none; }
.sm-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sm-logo { font: 900 italic clamp(18px, 3.2vw, 26px)/1 system-ui, sans-serif; letter-spacing: 0.04em; color: #fff; text-shadow: 0 0 10px #ff4f8b, 0 0 22px #b44dff; white-space: nowrap; }
.sm-logo small { font-size: 0.55em; color: #ffcf4a; text-shadow: 0 0 8px #ff9a2e; margin-left: 6px; }
.sm-me { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 99px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.07); color: #fff; font: 700 13px system-ui, sans-serif; cursor: pointer; max-width: 180px; }
.sm-me span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-friend { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
.sm-friend b { color: #7dff9b; }
.sm-friend .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; background: #ff9a2e; box-shadow: 0 0 8px #ff9a2e; animation: sm-blink 1.1s infinite; }
.sm-friend .dot.on { background: #45ff7a; box-shadow: 0 0 8px #45ff7a; animation: none; }
@keyframes sm-blink { 50% { opacity: 0.25; } }
.sm-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.sm-games { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; align-content: start; min-height: 0; overflow-y: auto; }
.sm-game { cursor: pointer; position: relative; display: grid; gap: 8px; padding: 12px; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.14); background: linear-gradient(160deg, var(--a), var(--b)); }
.sm-art { position: absolute; right: 6px; top: 4px; color: #fff; opacity: 0.92; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); transform: rotate(8deg); }
.sm-game h3 { margin: 0; font: 900 italic 19px/1 system-ui, sans-serif; letter-spacing: 0.02em; text-shadow: 0 2px 0 rgba(0,0,0,0.4); padding-right: 58px; }
.sm-game p { margin: 0; font: 600 12px/1.3 system-ui, sans-serif; color: rgba(255,255,255,0.82); padding-right: 40px; min-height: 2.6em; }
.sm-game .row { display: flex; gap: 6px; flex-wrap: wrap; }
.sm-btn { flex: 1 1 auto; padding: 9px 12px; border: 0; border-radius: 10px; font: 800 13px/1 system-ui, sans-serif; letter-spacing: 0.02em; color: #fff; background: rgba(0,0,0,0.35); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22); cursor: pointer; white-space: nowrap; transition: transform 80ms; }
.sm-btn:active { transform: scale(0.96); }
.sm-btn.hot { background: linear-gradient(#ff5d97, #d92a6c); box-shadow: 0 4px 14px rgba(255,79,139,0.45); }
.sm-btn.go { background: linear-gradient(#4be38a, #1fae5c); box-shadow: 0 4px 14px rgba(69,255,122,0.35); }
.sm-btn:disabled { opacity: 0.4; cursor: default; }
.sm-ask { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; background: rgba(7,4,15,0.82); backdrop-filter: blur(3px); }
.sm-ask > div { display: grid; gap: 12px; justify-items: center; text-align: center; padding: 18px; max-width: 360px; }
.sm-ask .big { font-size: 54px; line-height: 1; animation: sm-bounce 900ms infinite; }
@keyframes sm-bounce { 50% { transform: translateY(-6px) scale(1.06); } }
.sm-ask h4 { margin: 0; font: 900 italic 22px/1.15 system-ui, sans-serif; }
.sm-ask .sm-actions { justify-content: center; }
.sm-link { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.25); background: rgba(0,0,0,0.4); color: #fff; font: 12px monospace; }
`;

export const GAME_CARDS = [
  { kind: 'boxing', art: HandFist, title: 'BOXING', text: 'Slip, counter, knock them down.', a: '#ff4f6d', b: '#6b1238', friend: true },
  { kind: 'racing', art: CarFront, title: 'KART RACING', text: 'Drift the bends, boost past.', a: '#3aa0ff', b: '#15306e', friend: true },
  { kind: 'cpu', art: Swords, title: 'STREET BRAWL', text: 'Classic 2D fighter.', a: '#ffae3a', b: '#6e3a10', friend: false },
];

let styled = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text instanceof Node) node.append(text);
  else if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const node = el('button', `sm-btn ${className ?? ''}`, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/**
 * @param {{
 *   onPlay: (kind: string, vs: 'cpu' | 'friend') => void,
 *   onInvite: () => void,
 *   onCopyLink: () => Promise<string>,
 *   onAnswer: (yes: boolean, kind: string) => void,
 *   onCancel: () => void,
 *   onRename: (name: string) => void,
 *   onStand: () => void,
 *   onClick?: () => void,
 * }} handlers
 */
export function createScreenMenu({ onPlay, onInvite, onCopyLink, onAnswer, onCancel, onRename, onStand, onClick }) {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    styled = true;
  }
  const root = el('div', 'sm');
  root.hidden = true;

  const head = el('div', 'sm-head');
  const logo = el('div', 'sm-logo');
  logo.innerHTML = 'PINGO<small>GAMES</small>';
  const me = el('button', 'sm-me');
  me.type = 'button';
  const meName = el('span');
  me.append(icon(User, 15), meName, icon(Pencil, 13));
  const right = el('div', 'sm-actions');
  right.append(me, button(withIcon(LogOut, 'Stand up', { size: 15 }), '', onStand));
  head.append(logo, right);

  const friend = el('div', 'sm-friend');
  const games = el('div', 'sm-games');
  root.append(head, friend, games);
  document.body.append(root);

  let state = { inPingo: false, name: '', friendName: '', linked: false, friendSeated: false, ask: null, waiting: null, invite: '' };
  let ask;

  root.addEventListener('click', (event) => {
    if (event.target.closest('button')) onClick?.();
  });

  me.addEventListener('click', () => {
    // A plain prompt: a keyboard that works everywhere, and nothing to style.
    const next = window.prompt('Your name in PINGO', state.name)?.trim().slice(0, 18);
    if (next) onRename(next);
  });

  const cards = GAME_CARDS.map((game) => {
    const card = el('div', 'sm-game');
    card.append(icon(game.art, 48, 'sm-art'));
    card.style.setProperty('--a', game.a);
    card.style.setProperty('--b', game.b);
    const row = el('div', 'row');
    const cpu = button(withIcon(Bot, 'vs CPU', { size: 15 }), '', () => onPlay(game.kind, 'cpu'));
    const vsFriend = button(withIcon(Users, 'vs Friend', { size: 15 }), 'hot', () => onPlay(game.kind, 'friend'));
    row.append(cpu, vsFriend);
    card.append(el('h3', '', game.title), el('p', '', game.text), row);
    // The whole card is a tap target: a tap anywhere but a button plays the computer.
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      onClick?.();
      onPlay(game.kind, 'cpu');
    });
    games.append(card);
    return { game, vsFriend };
  });

  function renderFriend() {
    friend.replaceChildren();
    const line = el('div');
    const dot = el('span', `dot${state.linked ? ' on' : ''}`);
    const who = state.friendName || 'Your friend';
    if (!state.linked) {
      line.append(dot, 'Play with a friend - send them an invite');
      const actions = el('div', 'sm-actions');
      const copy = button(withIcon(Link, 'Copy link', { size: 15 }), '', async (event) => {
        const target = event.currentTarget;
        target.replaceChildren((await onCopyLink()) === 'copied' ? withIcon(Check, 'Copied', { size: 15 }) : withIcon(Link, 'Link below', { size: 15 }));
        setTimeout(() => target.replaceChildren(withIcon(Link, 'Copy link', { size: 15 })), 2000);
      });
      // Inside PINGO a friend is invited from your PINGO chats; outside it, by link.
      actions.append(state.inPingo ? button(withIcon(UserPlus, 'Invite PINGO friends', { size: 15 }), 'hot', onInvite) : copy);
      friend.append(line, actions);
    } else if (!state.friendSeated) {
      line.append(dot);
      const b = el('b', '', who);
      line.append(b, ' is here - waiting for them to sit at the game kiosk');
      friend.append(line);
    } else {
      line.append(dot);
      line.append(el('b', '', who), ' is sitting opposite you - pick a game!');
      friend.append(line);
    }
  }

  function renderAsk() {
    ask?.remove();
    ask = undefined;
    const card = GAME_CARDS.find((g) => g.kind === (state.ask ?? state.waiting));
    if (!card) return;
    ask = el('div', 'sm-ask');
    const box = el('div');
    const who = state.friendName || 'Your friend';
    if (state.ask) {
      box.append(el('div', 'big', icon(card.art, 54)), el('h4', '', `${who} wants to play ${card.title.toLowerCase()}!`));
      const actions = el('div', 'sm-actions');
      actions.append(button("LET'S GO!", 'go', () => onAnswer(true, state.ask)), button('Not now', '', () => onAnswer(false, state.ask)));
      box.append(actions);
    } else {
      box.append(el('div', 'big', icon(card.art, 54)), el('h4', '', `Waiting for ${who} to accept…`));
      box.append(button('Cancel', '', onCancel));
    }
    ask.append(box);
    root.append(ask);
  }

  return {
    get element() {
      return root;
    },

    update(next) {
      const before = state;
      state = { ...state, ...next };
      meName.textContent = state.name || 'Player';
      if (before.inPingo !== state.inPingo || before.linked !== state.linked || before.friendSeated !== state.friendSeated || before.friendName !== state.friendName || !friend.childElementCount) renderFriend();
      for (const { game, vsFriend } of cards) {
        vsFriend.disabled = !game.friend || !state.friendSeated;
        vsFriend.replaceChildren(withIcon(Users, game.friend ? `vs ${state.friendSeated ? state.friendName || 'Friend' : 'Friend'}` : 'Soon', { size: 15 }));
      }
      if (before.ask !== state.ask || before.waiting !== state.waiting || before.friendName !== state.friendName) renderAsk();
    },

    /** Shows the menu over `rect` (the screen, in CSS pixels), or hides it with null. */
    place(rect) {
      if (!rect) {
        root.hidden = true;
        return;
      }
      const wasHidden = root.hidden;
      root.hidden = false;
      const tooSmall = rect.width < 520 || rect.height < 300;
      root.classList.toggle('full', tooSmall);
      if (!tooSmall) {
        Object.assign(root.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      }
      if (wasHidden) {
        // Replay the switch-on flicker each time the machine comes back.
        root.style.animation = 'none';
        void root.offsetWidth;
        root.style.animation = '';
      }
    },
  };
}
