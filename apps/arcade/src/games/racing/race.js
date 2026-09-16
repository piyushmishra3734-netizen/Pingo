import { datan2, dcos, dhypot, dsin } from '../dmath.js';
import { HALF_ROAD, buildTrack } from './track.js';

/**
 * A kart race: four karts, three laps, one byte of input each per 1/60 s step.
 *
 * The fun is Mario Kart's, pared down: the kart always accelerates, so a
 * thumb only steers; hold DRIFT through a corner and the sparks go blue,
 * orange, pink - let go for a mini-turbo that big; sit in someone's wake for
 * a slipstream; tap DRIFT just as the lights go for a rocket start (too early
 * and you stall); boost pads on the straights.
 *
 * No drawing, no DOM, no clock, no randomness. Floats, but all
 * the trig is dmath.js, so two different browsers never drift apart; the
 * same inputs make the same race on every phone.
 */

export const IN = { LEFT: 1, RIGHT: 2, BRAKE: 4, DRIFT: 8 };

const DT = 1 / 60;
export const COUNTDOWN = 180;
export const FINISH_HOLD = 150;

const TOP_SPEED = 26;
const ACCEL = 13;
const BRAKE = 32;
const OFFROAD_SPEED = 11;
const TURN = 1.9;
/** Karts are circles this wide, in metres, for bumping. */
const RADIUS = 1.15;
/** Off the road the grass slows you; past this you hit the tyre wall. */
const WALL = HALF_ROAD + 3.2;
const ROAD_EDGE = HALF_ROAD - 0.6;

export const DRIFT_LEVELS = [70, 150, 240];
const MINI_TURBO = [0, 40, 75, 115];
const BOOST_SPEED = 1.38;
const PAD_BOOST = 55;
const ROCKET_BOOST = 80;
const DRAFT_NEEDED = 60;
const DRAFT_BOOST = 45;

/** Starting grid: two by two behind the line, in metres (back, across). */
const GRID = [
  [4, -2.6],
  [4, 2.6],
  [11, -2.6],
  [11, 2.6],
];

function kart(point, [back, across], index) {
  const hx = -dsin(point.yaw);
  const hz = -dcos(point.yaw);
  return {
    index,
    x: point.x - hx * back + -hz * across,
    z: point.z - hz * back + hx * across,
    yaw: point.yaw,
    travel: point.yaw,
    speed: 0,
    steer: 0,
    drift: 0,
    charge: 0,
    boost: 0,
    draft: 0,
    stall: 0,
    pace: 1,
    prev: 0,
    at: 0,
    lap: 0,
    lateral: across,
    offroad: false,
    finished: 0,
    place: index + 1,
  };
}

/**
 * @param {{ layout: string, laps?: number, pads?: number[] }} track
 * @param {number} [count] karts in the race
 */
export function createRace(track, count = 4) {
  const built = buildTrack(track.layout);
  const { points } = built;
  // The grid sits on the start tile, a little after the line.
  const start = points[Math.min(points.length - 1, 22)];
  const karts = Array.from({ length: count }, (_, i) => kart(start, GRID[i], i));
  for (const k of karts) {
    k.at = locate(points, k, 22, 40);
  }
  return {
    track: built,
    laps: track.laps ?? 3,
    pads: (track.pads ?? []).map((f) => Math.floor(f * points.length)),
    phase: 'countdown',
    t: 0,
    time: 0,
    karts,
    events: [],
  };
}

/** Index of the centre-line point nearest the kart, searching around `from`. */
function locate(points, k, from, span = 30) {
  const n = points.length;
  let best = from;
  let bestD = Infinity;
  for (let o = -span; o <= span; o += 1) {
    const i = (((from + o) % n) + n) % n;
    const d = (points[i].x - k.x) ** 2 + (points[i].z - k.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const wrap = (a) => datan2(dsin(a), dcos(a));

/** How far round the race a kart is, in centre-line points. */
export function progress(race, k) {
  const n = race.track.points.length;
  // Before the line on lap 0 the grid is "behind" point 0.
  return k.lap * n + k.at;
}

function stepKart(race, k, bits) {
  const pressed = bits & ~k.prev;
  const released = k.prev & ~bits;
  k.prev = bits;
  if (k.finished) bits = 0;

  const steer = (bits & IN.RIGHT ? 1 : 0) - (bits & IN.LEFT ? 1 : 0);
  k.steer += (steer - k.steer) * 0.25;

  if (race.phase === 'countdown') {
    // Rocket start: DRIFT in the last half second. Earlier is a jump start.
    if (pressed & IN.DRIFT) {
      if (race.t >= COUNTDOWN - 30) k.rocket = true;
      else if (race.t >= 60) k.stall = 50;
    }
    return;
  }

  if (k.stall > 0) {
    k.stall -= 1;
    k.speed *= 0.9;
  }

  // Drifting: hold DRIFT while turning. The charge builds faster when you
  // steer into the drift; letting go spends it on a mini-turbo.
  if (k.drift === 0 && bits & IN.DRIFT && steer !== 0 && k.speed > 12) {
    k.drift = steer;
    k.charge = 0;
    race.events.push({ type: 'drift', kart: k.index });
  }
  if (k.drift !== 0 && (!(bits & IN.DRIFT) || k.speed < 8)) {
    const level = DRIFT_LEVELS.filter((need) => k.charge >= need).length;
    if (level > 0 && released & IN.DRIFT) {
      k.boost = Math.max(k.boost, MINI_TURBO[level]);
      race.events.push({ type: 'turbo', kart: k.index, level });
    }
    k.drift = 0;
    k.charge = 0;
  }

  let yawRate;
  if (k.drift !== 0) {
    const into = steer * k.drift;
    yawRate = k.drift * (1.25 + 0.75 * into) * TURN * 0.62;
    const before = DRIFT_LEVELS.filter((need) => k.charge >= need).length;
    k.charge += into > 0 ? 2 : 1;
    const after = DRIFT_LEVELS.filter((need) => k.charge >= need).length;
    if (after > before) race.events.push({ type: 'spark', kart: k.index, level: after });
  } else {
    yawRate = k.steer * TURN * Math.min(1, k.speed / 9);
  }
  k.yaw -= yawRate * DT;
  // The kart points one way and slides the other; grip pulls them together.
  k.travel += wrap(k.yaw - k.travel) * (k.drift ? 0.07 : 0.3);

  const boosting = k.boost > 0;
  if (boosting) k.boost -= 1;
  const top = (k.offroad && !boosting ? OFFROAD_SPEED : TOP_SPEED) * k.pace * (boosting ? BOOST_SPEED : 1);
  if (bits & IN.BRAKE) k.speed = Math.max(0, k.speed - BRAKE * DT);
  else if (k.speed < top) k.speed = Math.min(top, k.speed + ACCEL * (boosting ? 3 : 1) * DT);
  else k.speed = Math.max(top, k.speed - 20 * DT);
  if (k.drift) k.speed *= 0.9993;

  k.x += -dsin(k.travel) * k.speed * DT;
  k.z += -dcos(k.travel) * k.speed * DT;
}

function placeOnTrack(race, k) {
  const { points } = race.track;
  const n = points.length;
  const before = k.at;
  k.at = locate(points, k, k.at);
  if (before > n - 40 && k.at < 40) {
    k.lap += 1;
    if (k.lap >= race.laps && !k.finished) {
      k.finished = race.time;
      race.events.push({ type: 'finish', kart: k.index, time: race.time });
    } else if (k.lap >= 1 && !k.finished) {
      race.events.push({ type: 'lap', kart: k.index, lap: k.lap });
    }
  } else if (before < 40 && k.at > n - 40) {
    k.lap -= 1;
  }

  const p = points[k.at];
  const hx = -dsin(p.yaw);
  const hz = -dcos(p.yaw);
  // Positive lateral is to the right of the road's direction.
  const dx = k.x - p.x;
  const dz = k.z - p.z;
  k.lateral = dx * -hz + dz * hx;
  k.offroad = Math.abs(k.lateral) > ROAD_EDGE;
  if (Math.abs(k.lateral) > WALL) {
    const push = Math.abs(k.lateral) - WALL;
    const side = Math.sign(k.lateral);
    k.x -= -hz * side * push;
    k.z -= hx * side * push;
    k.lateral = side * WALL;
    if (k.speed > 6) {
      k.speed *= 0.72;
      k.drift = 0;
      k.charge = 0;
      race.events.push({ type: 'bump', kart: k.index });
    }
    // Scrape along the wall rather than stick to it.
    k.travel += wrap(p.yaw - k.travel) * 0.35;
    k.yaw += wrap(p.yaw - k.yaw) * 0.2;
  }

  for (const pad of race.pads) {
    const ahead = (k.at - pad + n) % n;
    if (ahead < 4 && Math.abs(k.lateral) < 3.5 && k.boost < PAD_BOOST) {
      if (k.boost === 0) race.events.push({ type: 'pad', kart: k.index });
      k.boost = PAD_BOOST;
    }
  }
}

function interact(race) {
  const { karts } = race;
  for (let i = 0; i < karts.length; i += 1) {
    for (let j = i + 1; j < karts.length; j += 1) {
      const a = karts[i];
      const b = karts[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = dhypot(dx, dz);
      if (d < RADIUS * 2 && d > 0.0001) {
        const push = (RADIUS * 2 - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
        const behind = progress(race, a) < progress(race, b) ? a : b;
        behind.speed *= 0.97;
      }
    }
  }
  // Slipstream: close behind someone and in line with them.
  for (const k of karts) {
    if (k.finished) continue;
    const hx = -dsin(k.yaw);
    const hz = -dcos(k.yaw);
    const drafting = karts.some((o) => {
      if (o === k) return false;
      const dx = o.x - k.x;
      const dz = o.z - k.z;
      const forward = dx * hx + dz * hz;
      const side = dx * -hz + dz * hx;
      return forward > 2.5 && forward < 15 && Math.abs(side) < 2.2 && o.speed > 14;
    });
    if (drafting && k.speed > 14) {
      k.draft += 1;
      if (k.draft >= DRAFT_NEEDED) {
        k.draft = 0;
        k.boost = Math.max(k.boost, DRAFT_BOOST);
        race.events.push({ type: 'slipstream', kart: k.index });
      }
    } else {
      k.draft = Math.max(0, k.draft - 2);
    }
  }
}

function rank(race) {
  const order = [...race.karts].sort((a, b) => {
    if (a.finished && b.finished) return a.finished - b.finished;
    if (a.finished || b.finished) return a.finished ? -1 : 1;
    return progress(race, b) - progress(race, a);
  });
  order.forEach((k, i) => {
    k.place = i + 1;
  });
}

/**
 * One step of the race.
 * @param {ReturnType<typeof createRace>} race - mutated in place
 * @param {number[]} inputs - each kart's `IN` bits this step
 */
export function stepRace(race, inputs) {
  race.events = [];
  race.t += 1;
  if (race.phase === 'countdown') {
    if (race.t % 60 === 0 && race.t < COUNTDOWN) race.events.push({ type: 'count', n: 3 - race.t / 60 });
    race.karts.forEach((k, i) => stepKart(race, k, inputs[i] ?? 0));
    if (race.t >= COUNTDOWN) {
      race.phase = 'race';
      race.t = 0;
      race.events.push({ type: 'go' });
      for (const k of race.karts) {
        if (k.rocket && !k.stall) {
          k.boost = ROCKET_BOOST;
          race.events.push({ type: 'rocket', kart: k.index });
        }
        k.rocket = false;
      }
    }
    return;
  }

  race.time += 1;
  race.karts.forEach((k, i) => {
    stepKart(race, k, inputs[i] ?? 0);
    placeOnTrack(race, k);
  });
  interact(race);
  rank(race);

  if (race.phase === 'race' && race.karts[0].finished) {
    race.phase = 'finished';
    race.t = 0;
  }
}
