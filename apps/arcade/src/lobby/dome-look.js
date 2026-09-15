import { Light } from '../core/session.js';

/**
 * What the dome light shows at a given moment: a target colour, and how far
 * toward it the dome has come (0 = dark, 1 = full).
 *
 * Pure - a function of the session's light and the clock - so the blink can
 * be tested without a GPU, and so the mesh code only ever applies an answer.
 */

export const DOME_COLORS = {
  [Light.OFF]: 0x3a3342,
  [Light.BLINK_ORANGE]: 0xff8a1f,
  [Light.GREEN]: 0x39ff88,
};

/** Beacon speed. Fast enough to read as "waiting", slow enough not to strobe. */
export const BLINK_HZ = 1.6;
/** The dim half of a blink never goes fully dark, so the dome stays visible. */
export const BLINK_FLOOR = 0.15;

/**
 * @param {string} light - one of `Light`
 * @param {number} nowMs - the frame's timestamp
 * @returns {{ color: number, strength: number }}
 */
export function domeLook(light, nowMs) {
  if (light === Light.GREEN) return { color: DOME_COLORS[Light.GREEN], strength: 1 };

  if (light === Light.BLINK_ORANGE) {
    /*
     * A beacon, not a strobe: an eased pulse rather than on/off.
     *
     * A hard square wave on a phone dropping frames can land every sampled
     * frame in the "off" half and look dead for a second. Squaring the sine
     * keeps the bright part short and punchy, like a rotating lamp, while
     * every frame still shows where in the pulse it is.
     */
    const wave = 0.5 + 0.5 * Math.sin((nowMs / 1000) * BLINK_HZ * Math.PI * 2);
    return {
      color: DOME_COLORS[Light.BLINK_ORANGE],
      strength: BLINK_FLOOR + (1 - BLINK_FLOOR) * wave * wave,
    };
  }

  return { color: DOME_COLORS[Light.OFF], strength: 0 };
}
