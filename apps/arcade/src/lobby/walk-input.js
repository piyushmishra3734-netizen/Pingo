/**
 * Where you want to walk: WASD or the arrows on a laptop, a thumb stick on a
 * phone, both read as one vector with y up = into the screen.
 *
 * The stick is its own pointer (capture), so it keeps tracking a thumb that
 * slides off it, and lets go the moment the thumb lifts. It shows only where
 * the primary pointer is coarse (CSS in index.html).
 */

const KEYS = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, 1],
  KeyW: [0, 1],
  ArrowDown: [0, -1],
  KeyS: [0, -1],
};
/** How far the knob travels from centre, in CSS pixels, for full speed. */
const RANGE = 44;

export function createWalkInput() {
  const held = new Set();
  const stick = { x: 0, y: 0 };
  let enabled = true;

  window.addEventListener('keydown', (event) => {
    if (KEYS[event.code]) held.add(event.code);
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  window.addEventListener('blur', () => held.clear());

  const base = document.createElement('div');
  base.className = 'stick';
  const knob = document.createElement('div');
  knob.className = 'stick-knob';
  base.append(knob);
  document.body.append(base);

  let centre;
  function track(event) {
    let dx = event.clientX - centre.x;
    let dy = event.clientY - centre.y;
    const distance = Math.hypot(dx, dy);
    if (distance > RANGE) {
      dx *= RANGE / distance;
      dy *= RANGE / distance;
    }
    stick.x = dx / RANGE;
    stick.y = -dy / RANGE;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  function release() {
    centre = undefined;
    stick.x = 0;
    stick.y = 0;
    knob.style.transform = '';
  }
  base.addEventListener('pointerdown', (event) => {
    const rect = base.getBoundingClientRect();
    centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    base.setPointerCapture(event.pointerId);
    track(event);
    event.preventDefault();
  });
  base.addEventListener('pointermove', (event) => {
    if (centre) track(event);
  });
  base.addEventListener('pointerup', release);
  base.addEventListener('pointercancel', release);
  base.addEventListener('lostpointercapture', release);

  return {
    read() {
      if (!enabled) return { x: 0, y: 0 };
      let { x, y } = stick;
      for (const code of held) {
        x += KEYS[code][0];
        y += KEYS[code][1];
      }
      return { x, y };
    },

    /** Seated, the stick goes and the keys belong to whatever is on the screen. */
    setEnabled(value) {
      enabled = value;
      base.hidden = !value;
      if (!value) {
        release();
        held.clear();
      }
    },
  };
}
