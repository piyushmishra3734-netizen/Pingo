import { IN, progress } from './race.js';

/**
 * A computer driver: looks down the road, steers for a spot on it, drifts
 * the big corners for a turbo, and - like every kart racer's computer - eases
 * off when far ahead of you and finds a little extra when far behind, so the
 * race stays close. Seeded randomness (mulberry32).
 */

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

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** @param {{ pace?: number, drift?: number, lane?: number, seed?: number, player?: number }} [options] */
export function createRacingCpu({ pace = 1, drift = 0.6, lane = 0, seed = 1, player = 0 } = {}) {
  const random = mulberry32(seed);
  let drifting = 0;
  let wobble = 0;
  let wobbleT = 0;

  return {
    think(race, me) {
      const k = race.karts[me];
      const { points } = race.track;
      const n = points.length;

      const you = race.karts[player];
      if (you && you !== k) {
        const gap = progress(race, you) - progress(race, k);
        k.pace = pace * Math.min(1.1, Math.max(0.88, 1 + gap / 300));
      } else {
        k.pace = pace;
      }
      if (race.phase === 'countdown') return race.t === 160 && random() < 0.5 ? IN.DRIFT : 0;

      if (--wobbleT <= 0) {
        wobbleT = 40 + Math.floor(random() * 80);
        wobble = (random() - 0.5) * 3;
      }
      const look = Math.floor(8 + k.speed * 0.45);
      const p = points[(k.at + look) % n];
      const offset = lane + wobble;
      const tx = p.x + -Math.cos(p.yaw) * offset;
      const tz = p.z + Math.sin(p.yaw) * offset;
      const want = Math.atan2(-(tx - k.x), -(tz - k.z));
      const diff = wrap(want - k.yaw);

      // A big bend coming up: drift it.
      const bend = wrap(points[(k.at + 30) % n].yaw - points[(k.at + 6) % n].yaw);
      if (!drifting && Math.abs(bend) > 1.0 && k.speed > 16 && k.drift === 0) {
        drifting = random() < drift ? Math.sign(-bend) : -99;
      }
      if (drifting !== 0 && Math.abs(bend) < 0.3) drifting = 0;

      let bits = 0;
      if (diff < -0.05) bits |= IN.RIGHT;
      else if (diff > 0.05) bits |= IN.LEFT;
      if (drifting === 1 || drifting === -1) {
        bits |= IN.DRIFT;
        if (k.drift === 0) bits = (bits & ~(IN.LEFT | IN.RIGHT)) | (drifting > 0 ? IN.RIGHT : IN.LEFT);
      }
      return bits;
    },
  };
}
