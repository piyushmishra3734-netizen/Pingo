import { createControls } from '../controls.js';
import { stepsFor, STEP_MS } from '../game-host.js';
import { createBoxingCpu } from './cpu.js';
import { createHud } from './hud.js';
import { IN, createMatch, stepMatch } from './match.js';
import { createBoxingScene } from './scene.js';

/**
 * Boxing against the computer, full screen in 3D.
 *
 * The match runs in fixed 1/60 s steps from two bytes of input - yours and
 * the computer's - exactly as it will run between two phones. The scene only
 * draws what the match says. Unlike the 2D games this one draws with the
 * arcade's own renderer, full screen, while the arcade itself is paused.
 *
 * @param {{ renderer: import('three').WebGLRenderer, onSound?: (name: string) => void, level?: string, seed?: number }} options
 */

const KEYS = {
  ArrowLeft: IN.LEFT,
  KeyA: IN.LEFT,
  ArrowRight: IN.RIGHT,
  KeyD: IN.RIGHT,
  KeyJ: IN.JAB,
  KeyZ: IN.JAB,
  KeyK: IN.POWER,
  KeyX: IN.POWER,
  KeyL: IN.BLOCK,
  ShiftLeft: IN.BLOCK,
  KeyS: IN.DODGE,
  ArrowDown: IN.DODGE,
  Space: IN.DODGE,
};

const PAD = [
  [
    { label: '◀', bit: IN.LEFT, name: 'Step left' },
    { label: '▶', bit: IN.RIGHT, name: 'Step right' },
  ],
  [
    { label: 'SLIP', bit: IN.DODGE, name: 'Slip', small: true },
    { label: 'BLOCK', bit: IN.BLOCK, name: 'Block', small: true },
    { label: 'JAB', bit: IN.JAB, name: 'Jab' },
    { label: 'POW', bit: IN.POWER, name: 'Power punch', raised: true },
  ],
];

const SOUNDS = { hit: (e) => (e.punch === 'power' ? 'hit-heavy' : 'hit'), block: () => 'block', ko: () => 'ko', fight: () => 'fight' };

export function createBoxing({ renderer, onSound, level = 'normal', seed = 1 }) {
  const view = createBoxingScene();
  const hud = createHud();
  const controls = createControls({ keys: KEYS, pad: PAD });
  const cpu = createBoxingCpu({ level, seed });
  const match = createMatch();

  let last = 0;
  let accumulator = 0;

  return {
    is3d: true,
    ready: view.ready,
    match,

    /** One display frame: catch the match up, then draw it. */
    frame(now) {
      if (!last) last = now;
      const elapsed = now - last;
      last = now;
      const next = stepsFor(accumulator, elapsed);
      accumulator = next.accumulator;
      for (let i = 0; i < next.steps; i += 1) {
        stepMatch(match, [controls.read(), cpu.think(match, 1)]);
        for (const event of match.events) {
          view.onEvent(event, match);
          const sound = SOUNDS[event.type]?.(event);
          if (sound) onSound?.(sound);
        }
      }
      view.update(match, Math.min(elapsed, STEP_MS * 5) / 1000);
      hud.update(match);
      renderer.render(view.scene, view.camera);
    },

    /** After a pause (a hidden tab) the clock restarts rather than leaping. */
    resume() {
      last = 0;
      accumulator = 0;
    },

    resize(width, height) {
      view.resize(width, height);
    },

    dispose() {
      controls.dispose();
      hud.dispose();
    },
  };
}
