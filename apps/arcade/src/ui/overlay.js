/**
 * The only DOM on the page besides the canvas: a status line, the invite, and
 * a way back out of the chair.
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

/**
 * @param {{ onStand: () => void }} options
 */
export function createOverlay({ onStand }) {
  const root = document.createElement('div');
  root.className = 'overlay';

  const status = document.createElement('p');
  status.className = 'overlay-status';
  status.setAttribute('role', 'status');

  const invite = document.createElement('button');
  invite.type = 'button';
  invite.className = 'overlay-button overlay-invite';
  invite.textContent = 'Copy invite link';

  const field = document.createElement('input');
  field.className = 'overlay-link';
  field.readOnly = true;
  field.hidden = true;
  field.setAttribute('aria-label', 'Invite link');

  const stand = document.createElement('button');
  stand.type = 'button';
  stand.className = 'overlay-button';
  stand.textContent = 'Stand up';
  stand.addEventListener('click', onStand);

  root.append(status, invite, field, stand);
  document.body.append(root);

  let inviteUrl;
  let resetLabel;
  invite.addEventListener('click', async () => {
    if (!inviteUrl) return;
    const how = await sendLink(inviteUrl, field);
    invite.textContent = how === 'shown' ? 'Copy the link below' : how === 'copied' ? 'Link copied ✓' : 'Shared ✓';
    clearTimeout(resetLabel);
    resetLabel = setTimeout(() => {
      invite.textContent = 'Copy invite link';
    }, 2500);
  });

  return {
    /**
     * @param {string} state - the session's state
     * @param {{ invite?: string, rtt?: number, note?: string }} [extra]
     */
    show(state, extra = {}) {
      const seated = state !== 'IDLE';
      let text = seated ? STATUS[state] : 'Tap a stool to sit';
      if (state === 'PAIRED' && extra.rtt !== undefined) text += ` · ${extra.rtt} ms`;
      if (extra.note) text = extra.note;
      status.textContent = text;

      inviteUrl = extra.invite;
      // The invite only makes sense while somebody is still missing.
      const inviting = Boolean(inviteUrl) && state === 'WAITING';
      invite.hidden = !inviting;
      if (!inviting) field.hidden = true;

      stand.hidden = !seated;
    },
  };
}
