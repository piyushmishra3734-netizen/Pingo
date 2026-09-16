/**
 * A boxing match: two boxers on a line across the ring, jabs and power
 * punches, guard and slips, stamina, rounds.
 *
 * One call to `stepMatch` is one 1/60 s step. No drawing, no DOM, no clock,
 * no randomness - the same inputs always make the same match, on any device.
 * That is what lets two phones box each other later: both run this from the
 * same inputs, in lockstep, and never disagree.
 *
 * Everything is integers: positions in centimetres, health and stamina in
 * tenths, so nothing hangs on float rounding. Boxer 0 starts on the left
 * facing right, boxer 1 on the right facing left; "forward" is towards the
 * other one.
 */

/** One byte of intent per boxer per step. LEFT/RIGHT are screen directions. */
export const IN = { LEFT: 1, RIGHT: 2, JAB: 4, POWER: 8, BLOCK: 16, DODGE: 32, STAR: 64 };

export const MAX_HEALTH = 1000;
export const MAX_STAMINA = 1000;
export const ROUND_FRAMES = 60 * 60;
export const ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 3;
/** The ropes: centres never pass these, in cm from the middle. */
export const ROPE = 230;
/** Closer than this the boxers are in a clinch and simply stop. */
const MIN_GAP = 70;
const START_GAP = 190;

const FORWARD_SPEED = 3;
const BACK_SPEED = 2;

const INTRO_FRAMES = 100;
const KO_FRAMES = 180;
const TIMEUP_FRAMES = 140;
export const REMATCH_AFTER = 150;

/*
 * Frame data, in steps. `startup` is committed but harmless, `active` is when
 * it lands, `recovery` is when you are open. The jab is quick and cheap; the
 * power punch is slow, costly and hurts - and whiffing it leaves you wide open.
 */
export const PUNCHES = {
  jab: { startup: 6, active: 4, recovery: 11, reach: 105, damage: 55, stamina: 40, hitstun: 12, blockstun: 8, push: 10 },
  power: { startup: 14, active: 4, recovery: 22, reach: 115, damage: 140, stamina: 120, hitstun: 22, blockstun: 14, push: 28 },
  // The star punch: earned, never spammed. Slow enough to see coming, and a
  // guard only halves it.
  star: { startup: 16, active: 5, recovery: 24, reach: 125, damage: 240, stamina: 0, hitstun: 34, blockstun: 22, push: 60 },
};

/*
 * Hit stop: the whole match holds still for a few steps when a punch lands -
 * it is what makes a hit feel like it connected. Part of the match, not the
 * drawing, so two phones hold for exactly the same steps.
 */
export const HITSTOP = { block: 3, jab: 4, power: 8, star: 14, counter: 4, knockdown: 22 };

/*
 * Stars, as in Punch-Out: a counter punch, or a slip that makes the other
 * boxer whiff, earns one. STAR spends one on a star punch.
 */
export const MAX_STARS = 3;

/*
 * Knockdowns: at zero health you go down and the referee counts. Mash jab or
 * power to get up before ten; each knockdown needs more presses and gives
 * back less. One more knockdown than GET_UP lists ends the round.
 */
export const COUNT_STEPS = 50;
export const DOWN_SETTLE = 40;
export const GET_UP = [
  { presses: 10, health: 450 },
  { presses: 18, health: 280 },
];

/** A slip: out of the way from step 3 to 16, then a moment to recover. */
export const DODGE = { length: 26, from: 3, to: 16, stamina: 70 };

/** Blocked punches still cost a little health and some stamina. */
const BLOCK_DAMAGE = 0.15;
const BLOCK_STAMINA = { jab: 30, power: 90, star: 150 };
/** Hitting someone who is mid-punch counts extra. */
const COUNTER = 1.5;
/** Below this, guard breaks and punches lose their sting. */
const TIRED = 200;
const REGEN = { idle: 4, block: 1 };

function boxer(x, facing) {
  return { x, facing, health: MAX_HEALTH, stamina: MAX_STAMINA, state: 'idle', t: 0, stun: 0, hit: false, prev: 0, walk: 0, knockdowns: 0, stars: 0, mash: 0, count: 0, combo: 0, comboT: 0 };
}

const startingBoxers = () => [boxer(-START_GAP / 2, 1), boxer(START_GAP / 2, -1)];

export function createMatch() {
  return {
    phase: 'intro',
    t: 0,
    round: 1,
    wins: [0, 0],
    timer: ROUND_FRAMES,
    boxers: startingBoxers(),
    hitstop: 0,
    roundWinner: null,
    winner: null,
    events: [],
  };
}

function set(b, state) {
  if (b.state === state) return;
  b.state = state;
  b.t = 0;
  b.hit = false;
}

const clampX = (b) => {
  b.x = Math.min(ROPE, Math.max(-ROPE, b.x));
};

function spend(b, amount) {
  b.stamina = Math.max(0, b.stamina - amount);
}

function stepBoxer(b, bits, other) {
  const pressed = bits & ~b.prev;
  b.prev = bits;
  b.t += 1;
  b.walk = 0;

  if (b.state === 'ko' || b.state === 'win') return;

  if (b.state === 'down') {
    // Presses before the fall settles are wasted: nobody bounces straight up.
    if (b.t > DOWN_SETTLE && pressed & (IN.JAB | IN.POWER | IN.STAR)) b.mash += 1;
    return;
  }
  if (b.state === 'rise') {
    if (b.t >= 30) set(b, 'idle');
    return;
  }

  if (b.state === 'hurt' || b.state === 'blockstun') {
    b.stun -= 1;
    if (b.stun <= 0) set(b, 'idle');
    return;
  }

  const punch = PUNCHES[b.state];
  if (punch) {
    if (b.t >= punch.startup + punch.active + punch.recovery + (b.whiffed ? 8 : 0)) {
      b.whiffed = false;
      set(b, 'idle');
    }
    return;
  }
  if (b.state === 'dodge') {
    if (b.t >= DODGE.length) set(b, 'idle');
    return;
  }

  // Free: punch on the press, slip on the press, guard while held, else move.
  const tired = b.stamina < TIRED;
  if (pressed & IN.STAR && b.stars > 0) {
    set(b, 'star');
    b.stars -= 1;
  } else if (pressed & IN.POWER && b.stamina >= PUNCHES.power.stamina / 2) {
    set(b, 'power');
    spend(b, PUNCHES.power.stamina);
  } else if (pressed & IN.JAB) {
    set(b, 'jab');
    spend(b, PUNCHES.jab.stamina);
  } else if (pressed & IN.DODGE && b.stamina >= DODGE.stamina / 2) {
    set(b, 'dodge');
    spend(b, DODGE.stamina);
  } else if (bits & IN.BLOCK && !tired) {
    set(b, 'block');
    b.stamina = Math.min(MAX_STAMINA, b.stamina + REGEN.block);
  } else {
    const screen = (bits & IN.RIGHT ? 1 : 0) - (bits & IN.LEFT ? 1 : 0);
    const forward = screen * b.facing;
    if (forward) {
      set(b, 'walk');
      b.walk = forward;
      b.x += screen * (forward > 0 ? FORWARD_SPEED : BACK_SPEED);
      // No walking through the other one.
      const gap = (other.x - b.x) * b.facing;
      if (gap < MIN_GAP) b.x = other.x - b.facing * MIN_GAP;
      clampX(b);
    } else {
      set(b, 'idle');
    }
    b.stamina = Math.min(MAX_STAMINA, b.stamina + REGEN.idle);
  }
}

/** Resolves `attacker`'s punch against `defender`, once per punch. */
function land(match, attacker, defender, index) {
  const punch = PUNCHES[attacker.state];
  if (!punch || attacker.hit || defender.state === 'ko' || defender.state === 'down' || defender.state === 'rise') return;
  if (attacker.t < punch.startup || attacker.t >= punch.startup + punch.active) return;

  const distance = (defender.x - attacker.x) * attacker.facing;
  const slipping = defender.state === 'dodge' && defender.t >= DODGE.from && defender.t <= DODGE.to;
  if (slipping && distance <= punch.reach) {
    // Slipped at the moment it would have landed: that punch is spent, and it
    // left its thrower open. It does not get to try again when the slip ends.
    attacker.hit = true;
    attacker.whiffed = true;
    // Slipping a big punch earns a star; slipping jabs does not farm them.
    match.events.push({ type: 'whiff', boxer: index, dodged: true });
    if (attacker.state !== 'jab' && defender.stars < MAX_STARS) {
      defender.stars += 1;
      match.events.push({ type: 'star', boxer: 1 - index });
    }
    return;
  }
  if (distance > punch.reach) {
    // Only a miss at the last active step counts as a whiff: long recovery.
    if (attacker.t === punch.startup + punch.active - 1) {
      attacker.whiffed = true;
      match.events.push({ type: 'whiff', boxer: index, dodged: slipping });
    }
    return;
  }

  attacker.hit = true;
  const weak = attacker.stamina < TIRED ? 0.6 : 1;
  const blocked = (defender.state === 'block' || defender.state === 'blockstun') && defender.stamina >= TIRED / 2;
  const kind = attacker.state;

  if (blocked) {
    defender.health -= Math.floor(punch.damage * (kind === 'star' ? 0.5 : BLOCK_DAMAGE) * weak);
    attacker.combo = 0;
    match.hitstop = HITSTOP.block;
    spend(defender, BLOCK_STAMINA[kind]);
    set(defender, 'blockstun');
    defender.stun = punch.blockstun;
    defender.x += attacker.facing * Math.floor(punch.push / 2);
    match.events.push({ type: 'block', boxer: 1 - index, punch: kind });
  } else {
    const counter = PUNCHES[defender.state] ? COUNTER : 1;
    const damage = Math.floor(punch.damage * weak * counter);
    defender.health -= damage;
    set(defender, 'hurt');
    defender.stun = punch.hitstun;
    defender.x += attacker.facing * punch.push;
    attacker.combo = attacker.comboT > 0 ? attacker.combo + 1 : 1;
    attacker.comboT = 50;
    match.hitstop = HITSTOP[kind] + (counter > 1 ? HITSTOP.counter : 0);
    match.events.push({ type: 'hit', boxer: 1 - index, punch: kind, counter: counter > 1, damage, combo: attacker.combo });
    if (counter > 1 && kind !== 'star' && attacker.stars < MAX_STARS) {
      attacker.stars += 1;
      match.events.push({ type: 'star', boxer: index });
    }
  }
  clampX(defender);

  if (defender.health <= 0) {
    defender.health = 0;
    defender.knockdowns += 1;
    match.hitstop = HITSTOP.knockdown;
    attacker.combo = 0;
    if (defender.knockdowns > GET_UP.length) {
      set(defender, 'ko');
      match.events.push({ type: 'ko', boxer: 1 - index });
    } else {
      set(defender, 'down');
      defender.count = 0;
      defender.mash = 0;
      match.phase = 'down';
      match.t = 0;
      match.events.push({ type: 'down', boxer: 1 - index });
    }
  }
}

function finishRound(match) {
  if (match.roundWinner === null) {
    match.wins[0] += 1;
    match.wins[1] += 1;
  } else {
    match.wins[match.roundWinner] += 1;
  }
  const [w0, w1] = match.wins;
  if (w0 >= ROUNDS_TO_WIN || w1 >= ROUNDS_TO_WIN || match.round >= MAX_ROUNDS) {
    match.phase = 'over';
    match.t = 0;
    match.winner = w0 === w1 ? null : w0 > w1 ? 0 : 1;
    match.events.push({ type: 'over', winner: match.winner });
    return;
  }
  match.round += 1;
  match.boxers = startingBoxers();
  match.timer = ROUND_FRAMES;
  match.phase = 'intro';
  match.t = 0;
  match.roundWinner = null;
}

/**
 * One step of the match.
 * @param {ReturnType<typeof createMatch>} match - mutated in place
 * @param {[number, number]} inputs - each boxer's `IN` bits this step
 */
export function stepMatch(match, inputs) {
  match.events = [];
  if (match.hitstop > 0) {
    match.hitstop -= 1;
    return;
  }
  match.t += 1;
  const [a, b] = match.boxers;
  const live = match.phase === 'fight';
  // During a count only the boxer on the floor has anything to press.
  const hands = (x, bits) => (live || x.state === 'down' ? bits : 0);
  stepBoxer(a, hands(a, inputs[0]), b);
  stepBoxer(b, hands(b, inputs[1]), a);
  for (const x of match.boxers) if (x.comboT > 0) x.comboT -= 1;
  if (live) {
    land(match, a, b, 0);
    land(match, b, a, 1);
  }

  switch (match.phase) {
    case 'intro':
      if (match.t >= INTRO_FRAMES) {
        match.phase = 'fight';
        match.t = 0;
        match.events.push({ type: 'fight' });
      }
      break;
    case 'fight': {
      match.timer -= 1;
      const down = [a.state === 'ko', b.state === 'ko'];
      if (down[0] || down[1]) {
        match.roundWinner = down[0] && down[1] ? null : down[0] ? 1 : 0;
        match.phase = 'ko';
        match.t = 0;
      } else if (match.timer <= 0) {
        match.roundWinner = a.health === b.health ? null : a.health > b.health ? 0 : 1;
        match.phase = 'timeup';
        match.t = 0;
        match.events.push({ type: 'timeup' });
      }
      break;
    }
    case 'down': {
      const index = a.state === 'down' ? 0 : 1;
      const fallen = match.boxers[index];
      const standing = match.boxers[1 - index];
      // The one still standing backs off to give the count room.
      if (Math.abs(standing.x - fallen.x) < 150) {
        standing.x -= standing.facing;
        clampX(standing);
      }
      if (match.t > DOWN_SETTLE && (match.t - DOWN_SETTLE) % COUNT_STEPS === 0) {
        fallen.count += 1;
        match.events.push({ type: 'count', boxer: index, count: fallen.count });
      }
      const need = GET_UP[fallen.knockdowns - 1];
      if (fallen.mash >= need.presses) {
        fallen.health = need.health;
        set(fallen, 'rise');
        match.phase = 'fight';
        match.t = 60;
        match.events.push({ type: 'rise', boxer: index });
      } else if (fallen.count >= 10) {
        set(fallen, 'ko');
        match.roundWinner = 1 - index;
        match.phase = 'ko';
        match.t = 0;
        match.events.push({ type: 'ko', boxer: index });
      }
      break;
    }
    case 'ko':
    case 'timeup':
      if (match.t === 50 && match.roundWinner !== null) {
        const winner = match.boxers[match.roundWinner];
        if (winner.state !== 'ko') set(winner, 'win');
      }
      if (match.t >= (match.phase === 'ko' ? KO_FRAMES : TIMEUP_FRAMES)) finishRound(match);
      break;
    default:
  }
}
