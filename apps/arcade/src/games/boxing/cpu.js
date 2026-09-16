import { IN, PUNCHES } from './match.js';

/**
 * The computer boxer: one byte of intent per step, exactly what a player
 * produces - so the match cannot tell it from a person, and the same match
 * runs against it or against a friend's phone.
 *
 * ## It sees punches the way a person does
 *
 * A punch is only noticed `react` steps after it starts. On normal that is 10:
 * after a jab's 6-step startup (jabs mostly land) and before a power punch's
 * 14 (power punches get blocked or slipped) - which teaches the player that
 * the jab is how you open someone up.
 *
 * Seeded randomness (mulberry32), so a match against it replays exactly.
 */

export const LEVELS = {
  easy: { react: 14, think: 26, aggression: 0.35, defend: 0.35 },
  normal: { react: 10, think: 16, aggression: 0.42, defend: 0.55 },
  hard: { react: 6, think: 9, aggression: 0.65, defend: 0.8 },
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

export function createBoxingCpu({ level = 'normal', seed = 1 } = {}) {
  const skill = LEVELS[level] ?? LEVELS.normal;
  const random = mulberry32(seed);
  let plan = 0;
  let left = 0;
  let tap = 0;
  let defence = 0;

  return {
    /** Intent for boxer `me` this step. */
    think(match, me) {
      if (match.phase !== 'fight') {
        plan = 0;
        left = 0;
        defence = 0;
        return 0;
      }
      const self = match.boxers[me];
      const foe = match.boxers[1 - me];
      const distance = (foe.x - self.x) * self.facing;
      const toward = self.facing > 0 ? IN.RIGHT : IN.LEFT;
      const away = self.facing > 0 ? IN.LEFT : IN.RIGHT;

      // Defence: once per incoming punch, decided when it is noticed.
      const incoming = PUNCHES[foe.state];
      if (incoming && distance <= incoming.reach + 20 && foe.t >= skill.react && foe.t < incoming.startup + incoming.active) {
        if (defence === 0) {
          const roll = random();
          defence = roll < skill.defend ? (foe.state === 'power' && roll < skill.defend * 0.5 ? 2 : 1) : -1;
          if (defence === 2) return IN.DODGE;
        }
        if (defence === 1) return IN.BLOCK;
      } else if (!incoming) {
        defence = 0;
      }

      // Punish a whiffed power punch: it leaves the other boxer wide open.
      if (foe.whiffed && distance <= PUNCHES.power.reach && self.state === 'idle') return IN.POWER;

      if (left <= 0) {
        left = skill.think;
        const roll = random();
        const tired = self.stamina < 250;
        if (tired && roll < 0.6) {
          plan = away;
        } else if (distance > PUNCHES.jab.reach) {
          plan = toward;
        } else if (roll < skill.aggression) {
          plan = 0;
          tap = random() < 0.7 ? IN.JAB : IN.POWER;
        } else if (roll < skill.aggression + 0.25) {
          plan = IN.BLOCK;
        } else {
          plan = random() < 0.5 ? away : 0;
        }
      }
      left -= 1;
      const bits = plan | tap;
      tap = 0;
      return bits;
    },
  };
}
