/**
 * The fight: two fighters, four moves, hits, rounds.
 *
 * One call to `stepBout` is one 1/60 s step. No drawing, no DOM, no clock, no
 * randomness - the same inputs always make the same fight, on any device. That
 * is not tidiness: online play runs both players' copies of this in lockstep
 * from inputs alone, and any difference would split one fight into two.
 *
 * Positions are integers in 1/16 px (`SUB`), so fighters move at speeds a
 * whole pixel per step cannot express, and nothing hangs on float rounding.
 * Heights run upward from the floor (y = 0).
 */

export const SUB = 16;

/** One byte of intent per player per step. */
export const IN = { LEFT: 1, RIGHT: 2, UP: 4, PUNCH: 8, KICK: 16, BLOCK: 32 };

export const MAX_HP = 100;
export const ROUND_FRAMES = 60 * 60;
export const ROUNDS_TO_WIN = 2;
export const BODY_W = 20;
export const BODY_H = 46;

const STAGE_MIN = 16 * SUB;
const STAGE_MAX = 304 * SUB;
/** Fighters on the ground never stand closer than this - no walking through. */
const MIN_GAP = 18 * SUB;
const WALK_FORWARD = 24;
const WALK_BACK = 18;
const JUMP_SPEED = 88;
const GRAVITY = 5;

const INTRO_FRAMES = 90;
const KO_FRAMES = 150;
const TIMEUP_FRAMES = 120;
/** How long the result shows before a punch can start a rematch. */
export const REMATCH_AFTER = 150;

/*
 * Frame data, in steps. A move is `startup` (committed, not yet dangerous),
 * `active` (the hitbox is out), `recovery` (open to punishment). Reach and
 * height are the hitbox, measured from the attacker's feet in the direction
 * it faces. The punch is fast and short, the kick slower and longer - the
 * whole of the game's decision-making, in two rows.
 */
export const MOVES = {
  punch: { startup: 4, active: 3, recovery: 9, damage: 7, reach: [8, 26], height: [26, 34], hitstun: 14, blockstun: 8, push: 20, sound: 'hit' },
  kick: { startup: 8, active: 4, recovery: 14, damage: 11, reach: [6, 34], height: [10, 22], hitstun: 18, blockstun: 11, push: 28, sound: 'hit-heavy' },
  airkick: { startup: 3, active: 14, recovery: 0, damage: 9, reach: [4, 28], height: [0, 16], hitstun: 16, blockstun: 9, push: 24, sound: 'hit-heavy' },
};

function fighter(px, facing) {
  return { x: px * SUB, y: 0, vx: 0, vy: 0, facing, hp: MAX_HP, state: 'idle', t: 0, stun: 0, hit: false, prev: 0, airAttacked: false };
}

const startingFighters = () => [fighter(100, 1), fighter(220, -1)];

export function createBout() {
  return {
    phase: 'intro',
    t: 0,
    round: 1,
    wins: [0, 0],
    timer: ROUND_FRAMES,
    fighters: startingFighters(),
    roundWinner: null,
    winner: null,
    sparks: [],
    shake: 0,
    events: [],
    p1prev: 0,
  };
}

const airborne = (f) => f.y > 0 || f.vy > 0;

function set(f, state) {
  if (f.state === state) return;
  f.state = state;
  f.t = 0;
  f.hit = false;
}

function clampX(f) {
  f.x = Math.min(STAGE_MAX, Math.max(STAGE_MIN, f.x));
}

function physics(f) {
  f.x += f.vx;
  clampX(f);
  if (!airborne(f)) return;
  f.vy -= GRAVITY;
  f.y += f.vy;
  if (f.y <= 0) {
    f.y = 0;
    f.vy = 0;
    if (f.state === 'jump' || f.state === 'airkick') {
      set(f, 'idle');
      f.vx = 0;
    }
  }
}

/** Knockback bleeds off by 2 subpixels a step. */
function slow(f) {
  f.vx -= Math.sign(f.vx) * Math.min(Math.abs(f.vx), 2);
}

function stepFighter(f, bits, other) {
  const pressed = bits & ~f.prev;
  f.prev = bits;
  f.t += 1;

  if (f.state === 'ko' || f.state === 'win') {
    slow(f);
    physics(f);
    return;
  }

  if (f.state === 'hurt' || f.state === 'blockstun') {
    f.stun -= 1;
    slow(f);
    physics(f);
    if (f.stun <= 0 && !airborne(f)) set(f, 'idle');
    return;
  }

  const move = MOVES[f.state];
  if (move) {
    if (f.t >= move.startup + move.active + move.recovery) set(f, airborne(f) ? 'jump' : 'idle');
    physics(f);
    return;
  }

  if (airborne(f)) {
    if (pressed & IN.KICK && !f.airAttacked) {
      set(f, 'airkick');
      f.airAttacked = true;
    }
    physics(f);
    return;
  }

  // On the ground and free: face the other one, then act. Attacks go off on
  // the press, never on the hold - holding punch does not machine-gun.
  if (other.x !== f.x) f.facing = other.x > f.x ? 1 : -1;
  const horizontal = (bits & IN.RIGHT ? 1 : 0) - (bits & IN.LEFT ? 1 : 0);

  if (pressed & IN.PUNCH) {
    set(f, 'punch');
    f.vx = 0;
  } else if (pressed & IN.KICK) {
    set(f, 'kick');
    f.vx = 0;
  } else if (bits & IN.UP) {
    set(f, 'jump');
    f.vy = JUMP_SPEED;
    f.vx = horizontal * WALK_FORWARD;
    f.airAttacked = false;
  } else if (bits & IN.BLOCK) {
    set(f, 'block');
    f.vx = 0;
  } else if (horizontal) {
    set(f, 'walk');
    f.vx = horizontal * (horizontal === f.facing ? WALK_FORWARD : WALK_BACK);
  } else {
    set(f, 'idle');
    f.vx = 0;
  }
  physics(f);
}

/** Resolves `attacker`'s move against `defender`, once per move. */
function strike(bout, attacker, defender) {
  const move = MOVES[attacker.state];
  if (!move || attacker.hit || defender.state === 'ko') return;
  if (attacker.t < move.startup || attacker.t >= move.startup + move.active) return;

  const ax = attacker.x / SUB;
  const ay = attacker.y / SUB;
  const near = ax + attacker.facing * move.reach[0];
  const far = ax + attacker.facing * move.reach[1];
  const box = { x0: Math.min(near, far), x1: Math.max(near, far), y0: ay + move.height[0], y1: ay + move.height[1] };
  const dx = defender.x / SUB;
  const dy = defender.y / SUB;
  const body = { x0: dx - BODY_W / 2, x1: dx + BODY_W / 2, y0: dy, y1: dy + BODY_H };
  if (box.x1 <= body.x0 || box.x0 >= body.x1 || box.y1 <= body.y0 || box.y0 >= body.y1) return;

  attacker.hit = true;
  // Blocking works facing the attack, on the ground - no blocking a cross-up
  // with your back turned, none in the air.
  const facingIt = (attacker.x > defender.x ? 1 : -1) === defender.facing;
  const blocked = (defender.state === 'block' || defender.state === 'blockstun') && facingIt && !airborne(defender);
  defender.vx = attacker.facing * move.push;

  if (blocked) {
    defender.hp -= Math.floor(move.damage / 5);
    set(defender, 'blockstun');
    defender.stun = move.blockstun;
    bout.events.push('block');
  } else {
    defender.hp -= move.damage;
    set(defender, 'hurt');
    defender.stun = move.hitstun;
    if (airborne(defender)) defender.vy = Math.max(defender.vy, 24);
    bout.events.push(move.sound);
    bout.shake = 4;
  }

  bout.sparks.push({
    x: (Math.max(box.x0, body.x0) + Math.min(box.x1, body.x1)) / 2,
    y: (Math.max(box.y0, body.y0) + Math.min(box.y1, body.y1)) / 2,
    t: 0,
    blocked,
  });

  if (defender.hp <= 0) {
    defender.hp = 0;
    set(defender, 'ko');
    defender.vx = attacker.facing * 32;
    defender.vy = 36;
    bout.events.push('ko');
  }
}

function separate(a, b) {
  if (airborne(a) || airborne(b)) return;
  const gap = b.x - a.x;
  if (Math.abs(gap) >= MIN_GAP) return;
  const dir = gap === 0 ? a.facing : Math.sign(gap);
  const push = Math.ceil((MIN_GAP - Math.abs(gap)) / 2);
  a.x -= dir * push;
  b.x += dir * push;
  clampX(a);
  clampX(b);
  // Against a wall, the one in the open takes all of it.
  if (Math.abs(b.x - a.x) < MIN_GAP) {
    if (a.x === STAGE_MIN || a.x === STAGE_MAX) b.x = a.x + dir * MIN_GAP;
    else a.x = b.x - dir * MIN_GAP;
  }
}

function finishRound(bout) {
  if (bout.roundWinner === null) {
    bout.wins[0] += 1;
    bout.wins[1] += 1;
  } else {
    bout.wins[bout.roundWinner] += 1;
  }
  const [w0, w1] = bout.wins;
  if (w0 >= ROUNDS_TO_WIN || w1 >= ROUNDS_TO_WIN) {
    bout.phase = 'over';
    bout.t = 0;
    bout.winner = w0 === w1 ? null : w0 > w1 ? 0 : 1;
    bout.events.push('over');
    return;
  }
  bout.round += 1;
  bout.fighters = startingFighters();
  bout.timer = ROUND_FRAMES;
  bout.phase = 'intro';
  bout.t = 0;
  bout.roundWinner = null;
  bout.sparks = [];
}

/**
 * One step of the fight.
 * @param {ReturnType<typeof createBout>} bout - mutated in place
 * @param {[number, number]} inputs - each player's `IN` bits this step
 */
export function stepBout(bout, inputs) {
  bout.events = [];
  bout.t += 1;
  if (bout.shake > 0) bout.shake -= 1;
  for (const spark of bout.sparks) spark.t += 1;
  bout.sparks = bout.sparks.filter((spark) => spark.t < 8);

  const [a, b] = bout.fighters;
  const live = bout.phase === 'fight';
  stepFighter(a, live ? inputs[0] : 0, b);
  stepFighter(b, live ? inputs[1] : 0, a);
  separate(a, b);
  if (live) {
    strike(bout, a, b);
    strike(bout, b, a);
  }

  switch (bout.phase) {
    case 'intro':
      if (bout.t >= INTRO_FRAMES) {
        bout.phase = 'fight';
        bout.t = 0;
        bout.events.push('fight');
      }
      break;
    case 'fight': {
      bout.timer -= 1;
      const down = [a.state === 'ko', b.state === 'ko'];
      if (down[0] || down[1]) {
        bout.roundWinner = down[0] && down[1] ? null : down[0] ? 1 : 0;
        bout.phase = 'ko';
        bout.t = 0;
      } else if (bout.timer <= 0) {
        bout.roundWinner = a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1;
        bout.phase = 'timeup';
        bout.t = 0;
      }
      break;
    }
    case 'ko':
    case 'timeup':
      if (bout.t === 40 && bout.roundWinner !== null) {
        const winner = bout.fighters[bout.roundWinner];
        if (winner.state !== 'ko') set(winner, 'win');
      }
      if (bout.t >= (bout.phase === 'ko' ? KO_FRAMES : TIMEUP_FRAMES)) finishRound(bout);
      break;
    case 'over': {
      const pressed = inputs[0] & ~bout.p1prev;
      if (bout.t >= REMATCH_AFTER && pressed & IN.PUNCH) Object.assign(bout, createBout());
      break;
    }
    default:
  }
  bout.p1prev = inputs[0];
}
