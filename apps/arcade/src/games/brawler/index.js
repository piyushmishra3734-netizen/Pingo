import { createControls } from '../controls.js';
import { createBout, stepBout } from './bout.js';
import { createCpu } from './cpu.js';
import { drawBout } from './draw.js';

/**
 * The brawler against the computer: your hands on the left fighter, the bot
 * on the right, best of three.
 *
 * Wired as a game-host game (`update` per fixed step, `draw` per frame). The
 * bout itself only ever sees two bytes of input per step - which is why the
 * online version is this file with the bot swapped for the other phone.
 *
 * @param {{ level?: 'easy' | 'normal' | 'hard', seed?: number, onSound?: (name: string) => void }} [options]
 */
export function createBrawler({ level = 'normal', seed = 1, onSound } = {}) {
  const controls = createControls();
  const cpu = createCpu({ level, seed });
  const bout = createBout();

  return {
    bout,

    update() {
      stepBout(bout, [controls.read(), cpu.think(bout, 1)]);
      for (const event of bout.events) onSound?.(event);
    },

    draw(ctx) {
      drawBout(ctx, bout, ['YOU', 'CPU']);
    },

    dispose() {
      controls.dispose();
    },
  };
}
