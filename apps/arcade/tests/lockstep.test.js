import assert from 'node:assert/strict';
import test from 'node:test';

import { IN, createMatch, stepMatch } from '../src/games/boxing/match.js';
import { createLockstep } from '../src/games/lockstep.js';

/** Two lockstep ends joined by a lossy, laggy fake network. */
function pair({ loss = 0.2, lag = 3 } = {}) {
  let seed = 7;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  const ends = [0, 1].map(() => ({ input: new Set(), control: new Map(), queue: [] }));
  const nets = ends.map((end, i) => ({
    sendInput(data) {
      if (random() < loss) return;
      ends[1 - i].queue.push({ at: tick + lag + Math.floor(random() * 3), data: data.slice(0) });
    },
    onInput(handler) {
      end.input.add(handler);
      return () => end.input.delete(handler);
    },
    send() {},
    on() {
      return () => {};
    },
  }));
  let tick = 0;
  return {
    nets,
    deliver() {
      tick += 1;
      for (const end of ends) {
        const due = end.queue.filter((p) => p.at <= tick);
        end.queue = end.queue.filter((p) => p.at > tick);
        for (const { data } of due) for (const handler of end.input) handler(data);
      }
    },
  };
}

test('two ends of a lossy link play exactly the same match', () => {
  const link = pair();
  const matches = [createMatch(), createMatch()];
  const history = [[], []];
  const locks = [0, 1].map((side) =>
    createLockstep({
      net: link.nets[side],
      side,
      step(inputs) {
        stepMatch(matches[side], inputs);
        history[side].push(matches[side].boxers.map((b) => `${b.x},${b.health},${b.state}`).join('|'));
      },
    }),
  );
  const script = (side, t) => (t % 37 < 3 ? IN.JAB : t % 90 < 30 ? (side ? IN.LEFT : IN.RIGHT) : t % 61 === 0 ? IN.POWER : 0);
  for (let t = 0; t < 3000; t += 1) {
    locks.forEach((lock, side) => lock.advance(1, script(side, t)));
    link.deliver();
  }
  assert.ok(locks[0].frame > 2000, `only ${locks[0].frame} steps ran`);
  const n = Math.min(locks[0].frame, locks[1].frame);
  assert.ok(Math.abs(locks[0].frame - locks[1].frame) < 30);
  for (let i = 0; i < n; i += 1) assert.equal(history[0][i], history[1][i], `diverged at step ${i}`);
  assert.ok(matches[0].boxers.some((b) => b.health < 1000), 'punches landed');
});
