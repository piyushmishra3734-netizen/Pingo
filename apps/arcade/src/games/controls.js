import { ChevronLeft, ChevronRight, ChevronUp } from 'lucide';

import { icon } from '../ui/icon.js';
import { IN } from './brawler/bout.js';

/**
 * A player's hands: keyboard on a laptop, a touch pad on a phone, both read
 * as the same byte of `IN` bits - so the fight never knows which it was.
 *
 * ## The touch pad
 *
 * Every button owns its own pointer (pointer capture), so a thumb holding
 * right while the other taps punch is two pointers on two buttons, and
 * sliding off a button still releases it. Shown only where the primary
 * pointer is coarse (CSS, in index.html): a laptop gets its keyboard and a
 * clean screen.
 */

const KEYS = {
  ArrowLeft: IN.LEFT,
  KeyA: IN.LEFT,
  ArrowRight: IN.RIGHT,
  KeyD: IN.RIGHT,
  ArrowUp: IN.UP,
  KeyW: IN.UP,
  Space: IN.UP,
  KeyJ: IN.PUNCH,
  KeyK: IN.KICK,
  KeyL: IN.BLOCK,
  ArrowDown: IN.BLOCK,
  KeyS: IN.BLOCK,
};

const PAD = [
  [
    { label: icon(ChevronLeft, 26), bit: IN.LEFT, name: 'Left' },
    { label: icon(ChevronUp, 26), bit: IN.UP, name: 'Jump', raised: true },
    { label: icon(ChevronRight, 26), bit: IN.RIGHT, name: 'Right' },
  ],
  [
    { label: 'B', bit: IN.BLOCK, name: 'Block', small: true },
    { label: 'P', bit: IN.PUNCH, name: 'Punch' },
    { label: 'K', bit: IN.KICK, name: 'Kick', raised: true },
  ],
];

/**
 * @param {{ keys?: Record<string, number>, pad?: Array<Array<{ label: string, bit: number, name: string, raised?: boolean, small?: boolean }>> }} [layout]
 *   the brawler's by default; other games bring their own buttons.
 */
export function createControls({ keys: keyMap = KEYS, pad: layout = PAD } = {}) {
  let keys = 0;
  let touch = 0;

  const down = (event) => {
    const bit = keyMap[event.code];
    if (!bit) return;
    keys |= bit;
    event.preventDefault();
  };
  const up = (event) => {
    const bit = keyMap[event.code];
    if (bit) keys &= ~bit;
  };
  // A key held while the window loses focus never sends its keyup.
  const release = () => {
    keys = 0;
    touch = 0;
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', release);

  const pad = document.createElement('div');
  pad.className = 'pad';
  for (const side of layout) {
    const group = document.createElement('div');
    group.className = 'pad-side';
    for (const { label, bit, name, raised, small } of side) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `pad-btn${raised ? ' is-raised' : ''}${small ? ' is-small' : ''}`;
      // A letter, or a Lucide icon.
      if (label instanceof Node) button.append(label);
      else button.textContent = label;
      button.setAttribute('aria-label', name);
      const press = (event) => {
        touch |= bit;
        button.classList.add('is-down');
        button.setPointerCapture(event.pointerId);
        event.preventDefault();
      };
      const lift = () => {
        touch &= ~bit;
        button.classList.remove('is-down');
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', lift);
      button.addEventListener('pointercancel', lift);
      button.addEventListener('lostpointercapture', lift);
      group.append(button);
    }
    pad.append(group);
  }
  document.body.append(pad);

  return {
    /** The player's `IN` bits right now. */
    read: () => keys | touch,
    dispose() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      pad.remove();
    },
  };
}
