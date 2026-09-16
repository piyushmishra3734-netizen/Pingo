/**
 * Talking to your friend, the way Roblox and Minecraft do it: a chat log in
 * the corner, a box to type in, a mic button and a speaker button, and your
 * friend's name lighting up while they talk.
 *
 * The text goes over the match's reliable channel; the voice over its audio
 * line (net/peer.js). This file only draws and listens.
 */

import { meterFor } from '../lobby/voice-bubble.js';

const STYLE = `
.so { position: fixed; z-index: 4; left: max(10px, env(safe-area-inset-left)); top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 8px; pointer-events: none;
  font: 600 14px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff; }
.so[data-place='top'] { top: max(10px, env(safe-area-inset-top)); transform: none; }
.so-bar { display: flex; gap: 6px; pointer-events: auto; }
.so-btn { position: relative; width: 42px; height: 42px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.22); background: rgba(12,8,22,0.62); backdrop-filter: blur(6px); color: #fff; font-size: 19px; cursor: pointer; display: grid; place-items: center; }
.so-btn.off::after { content: ''; position: absolute; width: 26px; height: 3px; background: #ff4f6d; border-radius: 2px; transform: rotate(-45deg); box-shadow: 0 0 0 1.5px rgba(12,8,22,0.9); }
.so-btn.live { border-color: #45ff7a; box-shadow: 0 0 0 2px rgba(69,255,122,0.35); }
.so-btn .badge { position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #ff4f8b; font: 800 10px/16px system-ui; }
.so-friend { display: inline-flex; align-items: center; gap: 7px; align-self: flex-start; padding: 5px 10px 5px 6px; border-radius: 99px; background: rgba(12,8,22,0.62); border: 1px solid rgba(255,255,255,0.18); font-size: 13px; }
.so-friend i { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-style: normal; background: #3a2a66; font-size: 12px; transition: box-shadow 80ms; }
.so-log { display: flex; flex-direction: column; gap: 4px; max-width: min(320px, 70vw); }
.so-line { align-self: flex-start; padding: 5px 9px; border-radius: 10px; background: rgba(12,8,22,0.62); text-shadow: 0 1px 1px #000; word-break: break-word; transition: opacity 600ms; }
.so-line b { margin-right: 5px; }
.so-line.fade { opacity: 0; }
.so-line.sys { color: #ffcf4a; font-style: italic; }
.so[data-open='true'] .so-line.fade { opacity: 1; }
.so-form { display: flex; gap: 6px; pointer-events: auto; }
.so-form[hidden] { display: none; }
.so-form input { width: min(240px, 58vw); padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.3); background: rgba(12,8,22,0.85); color: #fff; font: 600 15px system-ui, sans-serif; outline: none; user-select: text; -webkit-user-select: text; }
.so-form button { padding: 0 14px; border: 0; border-radius: 10px; background: linear-gradient(#ff5d97, #d92a6c); color: #fff; font: 800 14px system-ui, sans-serif; }
`;

let styled = false;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const LINE_MS = 9000;

/**
 * @param {{
 *   onSend: (text: string) => void,
 *   onMic: (on: boolean) => Promise<boolean>,
 *   onSpeaker: (on: boolean) => void,
 * }} handlers
 */
export function createSocial({ onSend, onMic, onSpeaker }) {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    styled = true;
  }
  const root = el('div', 'so');
  const bar = el('div', 'so-bar');
  const chat = el('button', 'so-btn', '💬');
  chat.setAttribute('aria-label', 'Chat');
  const mic = el('button', 'so-btn off', '🎤');
  mic.setAttribute('aria-label', 'Microphone');
  const speaker = el('button', 'so-btn', '🔊');
  speaker.setAttribute('aria-label', 'Speaker');
  bar.append(chat, mic, speaker);
  const friend = el('div', 'so-friend');
  friend.hidden = true;
  const avatar = el('i', '', '👤');
  const friendName = el('span');
  friend.append(avatar, friendName);
  const log = el('div', 'so-log');
  const form = el('form', 'so-form');
  form.hidden = true;
  const input = el('input');
  input.maxLength = 120;
  input.placeholder = 'Say something…';
  input.enterKeyHint = 'send';
  const send = el('button', '', 'Send');
  send.type = 'submit';
  form.append(input, send);
  root.append(bar, friend, log, form);
  document.body.append(root);

  let unread = 0;
  let micOn = false;
  let speakerOn = true;
  let meter;

  const badge = () => {
    chat.querySelector('.badge')?.remove();
    if (unread > 0) chat.append(el('span', 'badge', String(unread)));
  };

  function open(on) {
    form.hidden = !on;
    root.dataset.open = String(on);
    if (on) {
      unread = 0;
      badge();
      input.focus();
    } else {
      input.blur();
    }
  }

  chat.addEventListener('click', () => open(form.hidden));
  // Typing must not steer a kart or throw a punch.
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') open(false);
  });
  input.addEventListener('keyup', (event) => event.stopPropagation());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) onSend(text);
    input.value = '';
    open(false);
  });
  window.addEventListener('keydown', (event) => {
    if ((event.key === 't' || event.key === 'T' || event.key === '/') && form.hidden && !event.repeat && document.activeElement === document.body) {
      event.preventDefault();
      open(true);
    }
  });

  mic.addEventListener('click', async () => {
    const want = !micOn;
    micOn = await onMic(want);
    mic.classList.toggle('off', !micOn);
    mic.classList.toggle('live', micOn);
  });
  speaker.addEventListener('click', () => {
    speakerOn = !speakerOn;
    speaker.classList.toggle('off', !speakerOn);
    speaker.textContent = speakerOn ? '🔊' : '🔈';
    onSpeaker(speakerOn);
  });

  function add(name, text, { mine = false, system = false } = {}) {
    const line = el('div', `so-line${system ? ' sys' : ''}`);
    if (!system) {
      const who = el('b', '', `${name}:`);
      who.style.color = mine ? '#7fd8ff' : '#ff9ac0';
      line.append(who);
    }
    line.append(text);
    log.append(line);
    while (log.childElementCount > 6) log.firstElementChild.remove();
    setTimeout(() => line.classList.add('fade'), LINE_MS);
    if (!mine && !system && form.hidden) {
      unread += 1;
      badge();
    }
  }

  return {
    add,

    /** The friend chip: their name, or hidden with null. */
    setFriend(name) {
      friend.hidden = !name;
      friendName.textContent = name ?? '';
    },

    /** Where the bar sits: the middle of the left edge, or the top in the lobby. */
    setPlace(place) {
      root.dataset.place = place;
    },

    /**
     * The other player's voice arrived: play it, and light their chip while
     * it is loud. Returns a reader for the current level (0-1).
     */
    playVoice(stream, audio) {
      audio.srcObject = stream;
      audio.muted = !speakerOn;
      void audio.play().catch(() => {});
      meter = meterFor(stream);
    },

    /** How loud the friend is right now; also lights their chip. */
    level() {
      const value = meter?.() ?? 0;
      avatar.style.boxShadow = value > 0.12 ? `0 0 0 ${2 + value * 4}px #45ff7a` : 'none';
      return value;
    },
  };
}
