/**
 * Driving the tram: power, brake, a crosswind to lean into, and stations to
 * stop at, open the doors, swap passengers and collect the tips.
 *
 * Pure and deterministic, like the kart race: no DOM, no clock, no
 * Math.random. The state is a plain object (the random generator is a number
 * in it), so the same seed, inputs and dt sequence always make the same ride.
 *
 * The line is treated as a loop of `routeLength` metres; `position` wraps.
 * Stations are points along it, and the tram serves them in order.
 */

/** Top speed on the line, m/s (50 km/h). */
const TOP_SPEED = 50 / 3.6;
const ACCEL = 2.2;
const BRAKE = 4.5;
/** Rolling drag (m/s^2) plus air drag (per m/s), so coasting slowly bleeds speed. */
const ROLL = 0.15;
const AIR = 0.02;
const GRAVITY = 9.81;

/** Stop within this many metres either side of the station mark. */
export const PLATFORM_WINDOW = 8;
/** Below this speed (m/s) the tram counts as stopped. */
const STOPPED = 0.3;
/** How far out (m) the next station counts as "arriving". */
const ARRIVE_ZONE = 120;

/** |balance| under this is steady; over BREAK the streak breaks. */
const STEADY = 0.25;
const BREAK = 0.75;
/** How hard wind (and lean) push the balance, and how fast it settles back. */
const PUSH = 1.4;
const SETTLE = 0.9;
/** The multiplier climbs STEP for every STEP_TIME seconds of steady riding. */
const STEP = 0.2;
const STEP_TIME = 1.5;
const MAX_MULTIPLIER = 2;
/** Per rider, the base fare paid at arrival (before multiplier and comfort). */
export const FARE = 9;

/** The door sequence, seconds: open, alight + board, close. */
const DOORS_OPEN = 1;
const EXCHANGE = 4;
const DOORS_CLOSE = 1;

/** mulberry32 on a number held in state. Returns [value 0..1, next seed]. */
function rand(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const mod = (v, n) => ((v % n) + n) % n;

/**
 * @param {{ routeLength: number, stations: { name: string, at: number }[], capacity?: number, seed?: number, aboard?: number }} options
 *   Needs at least two stations. The tram starts at rest at the first.
 */
export function createTramDrive({ routeLength, stations, capacity = 16, seed = 1, aboard = 12 }) {
  if (!(routeLength > 0) || !stations || stations.length < 2) throw new Error('createTramDrive needs a routeLength and two or more stations');
  const state = {
    routeLength,
    stations: [...stations].sort((a, b) => a.at - b.at),
    capacity,
    rng: seed >>> 0,
    time: 0,
    position: 0,
    speed: 0,
    speedKmh: 0,
    fromIndex: 0,
    nextIndex: 1,
    fromStation: '',
    nextStation: '',
    progress: 0,
    travelled: 0,
    distanceToNext: 0,
    aboard: Math.min(aboard, capacity),
    crosswind: 0,
    gust: 0,
    gustTimer: 0,
    balance: 0,
    steady: true,
    broken: false,
    comfort: 1,
    streak: 0,
    multiplier: 1,
    coins: 0,
    arrivalTips: 0,
    phase: 'departing',
    canOpenDoors: false,
    doorsOpen: 0,
    doorTime: 0,
    exchange: null,
    events: [],
  };
  state.position = state.stations[0].at;
  label(state);
  return state;
}

function label(state) {
  const { stations, routeLength } = state;
  const from = stations[state.fromIndex];
  const next = stations[state.nextIndex];
  state.fromStation = from.name;
  state.nextStation = next.name;
  const leg = mod(next.at - from.at, routeLength) || routeLength;
  // Measured along the leg, so long legs (over half the loop) still work; a
  // small overshoot past the station makes it negative. Having stopped a little
  // short of the last station reads as slightly negative travel, not a lap.
  state.travelled = mod(state.position - from.at + PLATFORM_WINDOW, routeLength) - PLATFORM_WINDOW;
  state.distanceToNext = leg - state.travelled;
  state.progress = clamp(1 - state.distanceToNext / leg, 0, 1);
  state.arrivalTips = Math.floor(FARE * state.aboard * state.multiplier * state.comfort);
}

/** The wind: seeded gusts that change every 2-5 s, eased into. Calm when stopped. */
function blow(state, dt) {
  state.gustTimer -= dt;
  if (state.gustTimer <= 0) {
    state.gustTimer = 2 + rand(state) * 3;
    state.gust = (rand(state) * 2 - 1) * (0.4 + rand(state) * 0.6);
  }
  state.crosswind += (state.gust - state.crosswind) * Math.min(1, dt * 1.2);
}

function ride(state, input, dt) {
  const { events } = state;
  const lean = clamp(input.lean ?? 0, -1, 1);
  // Wind only bites with speed, and leaning only matters when there is sway to
  // counter; leaning with the wind's sign cancels it.
  const exposure = Math.min(1, state.speed / 8);
  state.balance += ((state.crosswind - lean) * exposure * PUSH - state.balance * SETTLE) * dt;
  state.balance = clamp(state.balance, -1, 1);
  const off = Math.abs(state.balance);
  state.steady = off < STEADY;

  if (off > BREAK) {
    if (!state.broken) {
      state.broken = true;
      if (state.streak > 0 || state.multiplier > 1) events.push({ type: 'streak-broken', message: 'Streak broken. Find your balance to rebuild your tips.' });
      state.streak = 0;
      state.multiplier = 1;
    }
  } else if (state.steady) {
    state.broken = false;
  }

  if (state.steady && state.speed > STOPPED && !state.broken) {
    state.streak += dt;
    const multiplier = Math.min(MAX_MULTIPLIER, 1 + Math.floor(state.streak / STEP_TIME) * STEP);
    if (multiplier > state.multiplier + 1e-9) {
      state.multiplier = Math.round(multiplier * 10) / 10;
      events.push({ type: 'multiplier', multiplier: state.multiplier });
    }
  }
  // Comfort slowly recovers while steady and drains with imbalance.
  state.comfort = clamp(state.comfort + (state.steady ? 0.01 : -0.25 * (off - STEADY)) * dt, 0, 1);
}

function move(state, input, dt) {
  const grade = input.grade ?? 0;
  let a = -ROLL * Math.sign(state.speed) - AIR * state.speed - GRAVITY * grade * 0.5;
  if (input.brake) a -= BRAKE;
  else if (input.power && state.speed < TOP_SPEED) a += ACCEL * (1 - state.speed / (TOP_SPEED * 1.15));
  state.speed = clamp(state.speed + a * dt, 0, TOP_SPEED * 1.1);
  if (state.speed < 0.05 && !input.power) state.speed = 0;
  state.position = mod(state.position + state.speed * dt, state.routeLength);
}

function doors(state, dt) {
  const { events } = state;
  const before = state.doorTime;
  state.doorTime += dt;
  const t = state.doorTime;
  const ex = state.exchange;
  const station = state.nextStation;

  // Alight over the first half of the exchange, board over the second.
  const alightEnd = DOORS_OPEN + EXCHANGE / 2;
  const boardEnd = DOORS_OPEN + EXCHANGE;
  const gone = Math.floor(ex.alight * clamp((t - DOORS_OPEN) / (EXCHANGE / 2), 0, 1));
  const come = Math.floor(ex.board * clamp((t - alightEnd) / (EXCHANGE / 2), 0, 1));
  state.aboard = ex.start - gone + come;

  if (before < DOORS_OPEN && t >= DOORS_OPEN) {
    events.push({ type: 'doors-open', station });
    events.push({ type: 'paid', coins: ex.pay, station });
    state.coins += ex.pay;
  }
  if (before < boardEnd && t >= boardEnd) events.push({ type: 'exchanged', station, alighted: ex.alight, boarded: ex.board });

  const total = DOORS_OPEN + EXCHANGE + DOORS_CLOSE;
  state.doorsOpen = t < DOORS_OPEN ? t / DOORS_OPEN : t < boardEnd ? 1 : clamp((total - t) / DOORS_CLOSE, 0, 1);

  if (t >= total) {
    state.doorsOpen = 0;
    state.exchange = null;
    events.push({ type: 'doors-closed', station });
    state.fromIndex = state.nextIndex;
    state.nextIndex = (state.nextIndex + 1) % state.stations.length;
    state.comfort = 1;
    state.phase = 'departing';
    events.push({ type: 'departing', from: state.stations[state.fromIndex].name, to: state.stations[state.nextIndex].name });
  }
}

/**
 * One step of the ride. Mutates and returns `state`; `state.events` holds
 * only this step's events.
 * @param {ReturnType<typeof createTramDrive>} state
 * @param {{ power?: boolean, brake?: boolean, lean?: number, openDoors?: boolean, grade?: number }} input
 *   lean -1 (left) .. 1 (right), leaning into the wind's sign cancels it;
 *   grade is the track's slope (rise over run, + uphill), optional.
 * @param {number} dt seconds, clamped to 0.1
 */
export function stepTramDrive(state, input = {}, dt = 1 / 60) {
  dt = clamp(dt, 0, 0.1);
  state.events = [];
  state.time += dt;

  if (state.phase === 'doors') {
    state.speed = 0;
    state.speedKmh = 0;
    doors(state, dt);
    state.canOpenDoors = false;
    label(state);
    return state;
  }

  blow(state, dt);
  move(state, input, dt);
  ride(state, input, dt);
  label(state);

  const { stations, events } = state;
  const d = state.distanceToNext;

  if (state.phase === 'departing') {
    if (state.travelled > PLATFORM_WINDOW) state.phase = 'cruising';
  } else {
    if (d < -PLATFORM_WINDOW) {
      // Sailed past the platform: nobody gets on or off, no tips.
      events.push({ type: 'missed-station', station: state.nextStation });
      state.fromIndex = state.nextIndex;
      state.nextIndex = (state.nextIndex + 1) % stations.length;
      state.comfort = 1;
      state.phase = 'cruising';
      label(state);
    } else if (Math.abs(d) <= PLATFORM_WINDOW && state.speed < STOPPED) {
      if (state.phase !== 'stopped') events.push({ type: 'stopped', station: state.nextStation });
      state.phase = 'stopped';
    } else {
      state.phase = d < ARRIVE_ZONE ? 'arriving' : 'cruising';
    }
  }

  state.canOpenDoors = state.phase === 'stopped';
  if (state.canOpenDoors && input.openDoors) {
    const start = state.aboard;
    const alight = Math.floor(rand(state) * (start * 0.6 + 1));
    const room = state.capacity - (start - alight);
    const board = Math.min(room, Math.floor(rand(state) * 7));
    state.exchange = { start, alight, board, pay: state.arrivalTips };
    state.phase = 'doors';
    state.doorTime = 0;
    state.speed = 0;
    state.canOpenDoors = false;
    events.push({ type: 'doors-opening', station: state.nextStation });
  }
  state.speedKmh = Math.round(state.speed * 3.6);
  return state;
}
