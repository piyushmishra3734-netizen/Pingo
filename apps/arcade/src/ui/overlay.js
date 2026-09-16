/**
 * The buttons that move you between the room, the chair and the game: a
 * status line on foot, Sit down beside a stool, Stand up in the chair, Back
 * out of a game. Choosing a game lives on the machine's screen instead
 * (screen-menu.js).
 *
 * DOM rather than drawn in the scene because text in HTML is sharp at any
 * pixel ratio, readable by a screen reader, and free to lay out.
 */

/**
 * Gets a link to somebody, trying the best way first: clipboard, then the
 * share sheet, then the link itself in a prompt to copy by hand. Both APIs
 * need a secure context, which a phone testing against a laptop over plain
 * http does not have - so the last fallback is not theoretical.
 *
 * @returns {Promise<'copied' | 'shared' | 'shown'>}
 */
export async function sendLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    /* no clipboard here; try the share sheet */
  }
  try {
    await navigator.share({ title: 'PINGO Arcade', text: 'Play me in PINGO Arcade', url });
    return 'shared';
  } catch {
    /* no share sheet either */
  }
  window.prompt('Copy this link and send it to your friend', url);
  return 'shown';
}

function button(label, className, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

/**
 * @param {{ onStand: () => void, onBack: () => void, onSit: () => void }} options
 */
export function createOverlay({ onStand, onBack, onSit, onLeave }) {
  const root = document.createElement('div');
  root.className = 'overlay';

  const status = document.createElement('p');
  status.className = 'overlay-status';
  status.setAttribute('role', 'status');

  const back = button('✕ Back to the arcade', 'overlay-button', onBack);
  const stand = button('Stand up', 'overlay-button', onStand);
  root.append(status, back, stand);
  document.body.append(root);

  // Bottom right, under the thumb the stick does not use - where games keep
  // their action button.
  const sit = button('Sit down', 'overlay-button overlay-invite overlay-action', onSit);
  document.body.append(sit);

  // Who made the models and sounds. Some are CC-BY, which asks for their
  // credit where people can find it; the CC0 ones get theirs anyway.
  // Inside PINGO that corner is the way back to PINGO instead.
  const credits = onLeave ? button('✕ Leave', 'credits overlay-button', onLeave) : document.createElement('a');
  if (!onLeave) {
    credits.className = 'credits';
    credits.href = 'CREDITS.txt';
    credits.target = '_blank';
    credits.rel = 'noopener';
    credits.textContent = 'Credits';
  }
  document.body.append(credits);

  return {
    /**
     * @param {string} state - the session's state
     * @param {{ note?: string, mode?: 'lobby' | 'zooming' | 'game', canSit?: boolean }} [extra]
     */
    show(state, extra = {}) {
      const { mode = 'lobby' } = extra;
      const seated = state !== 'IDLE';
      const inGame = mode === 'game';
      root.dataset.mode = seated ? mode : 'walk';
      sit.hidden = !(extra.canSit && !seated);
      credits.hidden = seated;

      let text = seated ? '' : 'Walk in and sit at the PINGO machine';
      if (mode === 'zooming') text = 'Get ready…';
      if (extra.note) text = extra.note;
      status.textContent = text;
      status.hidden = inGame || !text;

      back.hidden = !inGame;
      // Seated, Stand up is on the machine's own menu.
      stand.hidden = true;
    },
  };
}
