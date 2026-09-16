/**
 * The only DOM on the page besides the canvases: a status line, the invite,
 * and the buttons that move you between the room, the chair and the game.
 *
 * DOM rather than drawn in the scene because text in HTML is sharp at any
 * pixel ratio, readable by a screen reader, and free to lay out - three would
 * need a texture per string and still render it softer.
 */

const STATUS = {
  WAITING: 'Waiting for a player…',
  CONNECTING: 'Connecting…',
  PAIRED: 'Player joined!',
};

/**
 * Gets a link to somebody, trying the best way first.
 *
 * Clipboard first (asked for, and silent), then the share sheet (on a phone
 * it is often the better answer anyway), then the link itself, selected, for
 * a long-press copy. Both APIs need a secure context, which a phone testing
 * against a laptop over plain http on Wi-Fi does not have - so the last
 * fallback is not theoretical.
 *
 * @returns {Promise<'copied' | 'shared' | 'shown'>}
 */
async function sendLink(url, field) {
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
  field.hidden = false;
  field.value = url;
  field.select();
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
 * @param {{ onStand: () => void, onPlay: () => void, onBack: () => void, onCpu: () => void, onBoxing: () => void, onSit: () => void }} options
 */
export function createOverlay({ onStand, onPlay, onBack, onCpu, onBoxing, onSit }) {
  const root = document.createElement('div');
  root.className = 'overlay';

  const status = document.createElement('p');
  status.className = 'overlay-status';
  status.setAttribute('role', 'status');

  let inviteUrl;
  let resetLabel;
  const field = document.createElement('input');
  field.className = 'overlay-link';
  field.readOnly = true;
  field.hidden = true;
  field.setAttribute('aria-label', 'Invite link');

  const invite = button('Copy invite link', 'overlay-button overlay-invite', async () => {
    if (!inviteUrl) return;
    const how = await sendLink(inviteUrl, field);
    invite.textContent =
      how === 'shown' ? 'Copy the link below' : how === 'copied' ? 'Link copied ✓' : 'Shared ✓';
    clearTimeout(resetLabel);
    resetLabel = setTimeout(() => {
      invite.textContent = 'Copy invite link';
    }, 2500);
  });

  const play = button('Play', 'overlay-button overlay-invite', onPlay);
  const boxing = button('🥊 Boxing vs computer', 'overlay-button overlay-invite', onBoxing);
  const cpu = button('Brawler vs computer', 'overlay-button', onCpu);
  const back = button('Back to the room', 'overlay-button', onBack);
  const stand = button('Stand up', 'overlay-button', onStand);

  root.append(status, invite, field, play, boxing, cpu, back, stand);
  document.body.append(root);

  // Bottom right, under the thumb the stick does not use - where games keep
  // their action button.
  const sit = button('Sit down', 'overlay-button overlay-invite overlay-action', onSit);
  document.body.append(sit);

  // Who made the models and sounds. One of them is CC-BY, which asks for its
  // credit where people can find it; the CC0 ones get theirs anyway.
  const credits = document.createElement('a');
  credits.className = 'credits';
  credits.href = 'CREDITS.txt';
  credits.target = '_blank';
  credits.rel = 'noopener';
  credits.textContent = 'Credits';
  document.body.append(credits);

  return {
    /**
     * @param {string} state - the session's state
     * @param {{ invite?: string, rtt?: number, note?: string, mode?: 'lobby' | 'zooming' | 'game', canSit?: boolean }} [extra]
     */
    show(state, extra = {}) {
      const { mode = 'lobby' } = extra;
      const seated = state !== 'IDLE';
      const inGame = mode === 'game';
      // In a game the overlay moves to a corner (see index.html): at the
      // bottom it sat on the game itself - measured, over "GET READY". On
      // foot it moves to the top, clear of the stick and the action button.
      root.dataset.mode = seated ? mode : 'walk';
      sit.hidden = !(extra.canSit && !seated);
      credits.hidden = seated;

      let text = seated ? STATUS[state] : 'Walk in and sit at the PINGO machine';
      if (state === 'PAIRED' && extra.rtt !== undefined) text += ` · ${extra.rtt} ms`;
      if (mode === 'zooming') text = 'Get ready…';
      if (extra.note) text = extra.note;
      status.textContent = text;
      // In the game the screen says everything; the status would sit on it.
      status.hidden = inGame;

      inviteUrl = extra.invite;
      // The invite only makes sense while somebody is still missing.
      // Not during the bout vs the computer: up there it sits on the health bar.
      const inviting = Boolean(inviteUrl) && state === 'WAITING' && !inGame;
      invite.hidden = !inviting;
      if (!inviting) field.hidden = true;

      play.hidden = !(state === 'PAIRED' && mode === 'lobby');
      // Alone in the chair: fight the machine while the invite is out.
      cpu.hidden = !(state === 'WAITING' && mode === 'lobby');
      boxing.hidden = cpu.hidden;
      back.hidden = !inGame;
      stand.hidden = !seated || inGame;
    },
  };
}
