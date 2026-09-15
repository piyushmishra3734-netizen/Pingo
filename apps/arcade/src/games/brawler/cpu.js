import { IN, MOVES, SUB } from './bout.js';

/**
 * The computer opponent: one byte of intent per step, exactly what a player
 * produces - so to the fight it is indistinguishable from a person, and the
 * same bout code runs a match against it or against a phone across the room.
 *
 * ## Blocking is a reaction, not a plan
 *
 * It sees an attack coming only half a think-time after the attack starts,
 * like a person does. On normal that is 6 steps - longer than a punch's 4-step
 * startup, shorter than a kick's 8 - so fast punches get through and slow
 * kicks get blocked, which is the lesson a first-time player should learn.
 *
 * Seeded randomness (mulberry32), so a match against it can be replayed step
 * for step, and the tests can pin its behaviour down.
 */

export const LEVELS = {
  easy: { think: 22, aggression: 0.3, block: 0.3 },
  normal: { think: 12, aggression: 0.5, block: 0.55 },
  hard: { think: 6, aggression: 0.7, block: 0.8 },
};

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createCpu({ level = 'normal', seed = 1 } = {}) {
  const skill = LEVELS[level] ?? LEVELS.normal;
  const random = mulberry32(seed);
  let plan = 0;
  let tap = 0;
  let left = 0;
  let blocking = 0;

  return {
    /** Intent for fighter `me` this step, given the bout as it stands. */
    think(bout, me) {
      if (bout.phase !== 'fight') {
        plan = 0;
        left = 0;
        return 0;
      }
      const self = bout.fighters[me];
      const foe = bout.fighters[1 - me];
      const distance = Math.abs(foe.x - self.x) / SUB;
      const toward = foe.x > self.x ? IN.RIGHT : IN.LEFT;
      const away = toward === IN.RIGHT ? IN.LEFT : IN.RIGHT;

      const threat = MOVES[foe.state];
      if (threat && distance < 46 && foe.t >= Math.floor(skill.think / 2) && foe.t < threat.startup + threat.active) {
        // Decided once per attack, so it does not flicker in and out of guard.
        if (blocking === 0) blocking = random() < skill.block ? 1 : -1;
        if (blocking === 1) return IN.BLOCK;
      } else {
        blocking = 0;
      }

      // Airborne and close: the flying kick, every time - a bot that jumps in
      // and does nothing looks broken, not easy.
      if (self.y > 0 && !self.airAttacked && distance < 32) return IN.KICK;

      if (left <= 0) {
        left = skill.think;
        const roll = random();
        if (distance > 40) {
          plan = toward | (random() < 0.08 ? IN.UP : 0);
        } else if (self.hp < 25 && roll < 0.25) {
          plan = away;
        } else if (roll < skill.aggression) {
          plan = 0;
          tap = distance <= 26 && random() < 0.6 ? IN.PUNCH : IN.KICK;
        } else if (roll < skill.aggression + 0.2) {
          plan = away;
        } else {
          plan = random() < skill.block * 0.5 ? IN.BLOCK : 0;
        }
      }
      left -= 1;
      // An attack is a tap: pressed for one step, so the next one can press again.
      const bits = plan | tap;
      tap = 0;
      return bits;
    },
  };
}
