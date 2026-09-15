/**
 * The only DOM on the page besides the canvas: a hint, a status line and a
 * way back out of the chair.
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
 * @param {{ onStand: () => void }} options
 */
export function createOverlay({ onStand }) {
  const root = document.createElement('div');
  root.className = 'overlay';

  const status = document.createElement('p');
  status.className = 'overlay-status';
  status.setAttribute('role', 'status');

  const stand = document.createElement('button');
  stand.type = 'button';
  stand.className = 'overlay-button';
  stand.textContent = 'Stand up';
  stand.addEventListener('click', onStand);

  root.append(status, stand);
  document.body.append(root);

  return {
    /** @param {string} state - the session's state */
    show(state) {
      const seated = state !== 'IDLE';
      status.textContent = seated ? STATUS[state] : 'Tap a stool to sit';
      stand.hidden = !seated;
    },
  };
}
