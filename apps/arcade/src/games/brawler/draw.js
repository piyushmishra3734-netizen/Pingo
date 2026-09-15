import { MAX_HP, MOVES, REMATCH_AFTER, ROUNDS_TO_WIN, SUB } from './bout.js';

/**
 * Drawing the bout: a night street, two pixel fighters, the HUD.
 *
 * The fighters are rectangles, posed per state - no sprite sheet to fetch,
 * and every limb sits exactly where its hitbox in bout.js says it reaches,
 * which a borrowed sheet would not. The street is drawn once into its own
 * canvas and copied each frame: one drawImage instead of a hundred windows.
 */

const W = 320;
const H = 200;
const FLOOR = 176;
const DARK = '#1b1826';
const SKIN = '#f2c49b';
const TEAMS = [
  { gi: '#ff4f8b', pants: '#b8336a', band: '#ffffff' },
  { gi: '#38e0d0', pants: '#23998f', band: '#ffffff' },
];

let street;

function drawStreet() {
  if (street) return street;
  street = document.createElement('canvas');
  street.width = W;
  street.height = H;
  const g = street.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, FLOOR);
  sky.addColorStop(0, '#120a24');
  sky.addColorStop(1, '#3b1a4a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, FLOOR);

  // A skyline from a tiny fixed-seed generator: the same street every time.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let x = 0; x < W; ) {
    const w = 18 + Math.floor(rnd() * 26);
    const h = 40 + Math.floor(rnd() * 70);
    g.fillStyle = '#1d1230';
    g.fillRect(x, FLOOR - 26 - h, w, h + 26);
    for (let wy = FLOOR - 20 - h; wy < FLOOR - 32; wy += 7) {
      for (let wx = x + 3; wx < x + w - 4; wx += 6) {
        if (rnd() < 0.35) {
          g.fillStyle = rnd() < 0.5 ? '#ffd27a' : '#7be0ff';
          g.fillRect(wx, wy, 2, 3);
        }
      }
    }
    x += w + 2;
  }

  g.textAlign = 'center';
  g.font = 'bold 14px ui-monospace, Menlo, monospace';
  g.fillStyle = 'rgba(255, 79, 139, 0.35)';
  g.fillText('PINGO', 161, 53);
  g.fillStyle = '#ff7aa8';
  g.fillText('PINGO', 160, 52);

  g.fillStyle = '#2a2034';
  g.fillRect(0, FLOOR, W, H - FLOOR);
  g.strokeStyle = '#3a2d48';
  g.beginPath();
  for (let i = -8; i <= 8; i += 1) {
    g.moveTo(160 + i * 14, FLOOR);
    g.lineTo(160 + i * 44, H);
  }
  g.stroke();
  g.fillStyle = '#4a3a5c';
  g.fillRect(0, FLOOR, W, 1);
  return street;
}

/**
 * The fighter's rectangles for its state, facing right, origin at its feet,
 * y upward: [x, y, w, h, colour]. Drawn in order, back to front.
 */
function pose(f, team) {
  const parts = [];
  const add = (x, y, w, h, colour) => parts.push([x, y, w, h, colour]);
  const legs = ([x0, y0, h0 = 16], [x1, y1, h1 = 16]) => {
    add(x0, y0, 5, h0, team.pants);
    add(x1, y1, 5, h1, team.pants);
    add(x0 - 1, y0, 7, 2, DARK);
    add(x1 - 1, y1, 7, 2, DARK);
  };
  const body = (lean = 0, rise = 0) => {
    add(-7 + lean, 16 + rise, 14, 16, team.gi);
    add(-7 + lean, 17 + rise, 14, 2, DARK);
    add(-5 + lean, 33 + rise, 10, 10, SKIN);
    add(-6 + lean, 41 + rise, 12, 3, DARK);
    add(-6 + lean, 38 + rise, 12, 2, team.band);
    add(2 + lean, 36 + rise, 2, 2, DARK);
  };
  const backArm = (rise = 0) => {
    add(-2, 24 + rise, 4, 8, team.gi);
    add(0, 29 + rise, 5, 5, SKIN);
  };
  const guard = (rise = 0) => {
    add(4, 24 + rise, 4, 8, team.gi);
    add(6, 30 + rise, 5, 5, SKIN);
  };

  switch (f.state) {
    case 'walk': {
      const step = (f.t >> 3) & 1;
      backArm();
      legs(step ? [-8, 0] : [-5, 1], step ? [3, 1] : [0, 0]);
      body();
      guard();
      break;
    }
    case 'jump':
      backArm(2);
      legs([-7, 6, 10], [2, 8, 10]);
      body();
      guard(4);
      break;
    case 'punch': {
      const out = f.t >= MOVES.punch.startup;
      backArm();
      legs([-9, 0], [3, 0]);
      body(1);
      if (out) {
        add(4, 29, 18, 4, team.gi);
        add(20, 28, 6, 6, SKIN);
      } else {
        add(-1, 28, 5, 4, team.gi);
        add(-3, 27, 5, 5, SKIN);
      }
      break;
    }
    case 'kick': {
      const out = f.t >= MOVES.kick.startup;
      backArm();
      if (out) {
        legs([-7, 0], [2, 13, 5]);
        add(2, 13, 24, 5, team.pants);
        add(26, 12, 7, 7, SKIN);
      } else {
        legs([-7, 0], [2, 8, 8]);
      }
      body(-3);
      guard();
      break;
    }
    case 'airkick':
      backArm(2);
      legs([-7, 8, 8], [2, 4, 4]);
      add(2, 2, 22, 5, team.pants);
      add(22, 0, 7, 6, SKIN);
      body();
      guard(2);
      break;
    case 'block':
    case 'blockstun':
      legs([-8, 0], [2, 0]);
      body(-1);
      add(1, 24, 4, 12, team.gi);
      add(5, 24, 5, 14, team.gi);
      add(5, 37, 5, 5, SKIN);
      break;
    case 'hurt':
      legs([-8, 0], [1, 0]);
      body(-4);
      add(-12, 30, 6, 4, team.gi);
      add(-15, 29, 4, 5, SKIN);
      break;
    case 'ko':
      if (f.y > 0) {
        legs([-8, 0], [1, 0]);
        body(-5);
      } else {
        add(-8, 0, 18, 6, team.pants);
        add(-24, 0, 16, 9, team.gi);
        add(-34, 0, 10, 9, SKIN);
        add(-34, 6, 10, 3, DARK);
      }
      break;
    case 'win':
      backArm();
      legs([-7, 0], [2, 0]);
      body();
      add(4, 32, 4, 14, team.gi);
      add(3, 44, 6, 6, SKIN);
      break;
    default: {
      const bob = (f.t >> 4) & 1;
      backArm(bob);
      legs([-7, 0], [2, 0]);
      body(0, bob);
      guard(bob);
    }
  }
  return parts;
}

function drawFighter(ctx, f, team) {
  const px = Math.round(f.x / SUB);
  const py = Math.round(f.y / SUB);
  const shadow = 20 - Math.min(12, py >> 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(px - (shadow >> 1), FLOOR - 1, shadow, 3);
  for (const [x, y, w, h, colour] of pose(f, team)) {
    const rx = f.facing === 1 ? x : -(x + w);
    ctx.fillStyle = colour;
    ctx.fillRect(px + rx, FLOOR - py - (y + h), w, h);
  }
}

function text(ctx, value, x, y, size, colour = '#ffffff', align = 'center') {
  ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = DARK;
  ctx.fillText(value, x + 1, y + 1);
  ctx.fillStyle = colour;
  ctx.fillText(value, x, y);
}

function healthBar(ctx, x, hp, fromRight, colour) {
  const w = 124;
  ctx.fillStyle = DARK;
  ctx.fillRect(x - 1, 7, w + 2, 10);
  ctx.fillStyle = '#3a1020';
  ctx.fillRect(x, 8, w, 8);
  const fill = Math.round((w * hp) / MAX_HP);
  ctx.fillStyle = hp > 30 ? colour : '#ffcf4a';
  ctx.fillRect(fromRight ? x + w - fill : x, 8, fill, 8);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import('./bout.js').createBout>} bout
 * @param {[string, string]} names
 */
export function drawBout(ctx, bout, names) {
  const [a, b] = bout.fighters;

  ctx.save();
  if (bout.shake > 0) ctx.translate(bout.t % 2 ? 2 : -2, 0);
  ctx.drawImage(drawStreet(), 0, 0);
  // The one attacking is drawn in front, so a punch never vanishes behind a head.
  const order = MOVES[a.state] ? [b, a] : [a, b];
  for (const f of order) drawFighter(ctx, f, TEAMS[f === a ? 0 : 1]);
  for (const spark of bout.sparks) {
    const size = 3 + spark.t;
    const sx = Math.round(spark.x);
    const sy = FLOOR - Math.round(spark.y);
    ctx.fillStyle = spark.blocked ? '#9fd8ff' : '#fff2a8';
    ctx.fillRect(sx - size, sy, size * 2 + 1, 1);
    ctx.fillRect(sx, sy - size, 1, size * 2 + 1);
  }
  ctx.restore();

  healthBar(ctx, 8, a.hp, false, TEAMS[0].gi);
  healthBar(ctx, W - 132, b.hp, true, TEAMS[1].gi);
  text(ctx, names[0], 8, 25, 8, '#ffffff', 'left');
  text(ctx, names[1], W - 8, 25, 8, '#ffffff', 'right');
  for (let i = 0; i < ROUNDS_TO_WIN; i += 1) {
    ctx.fillStyle = bout.wins[0] > i ? '#ffcf4a' : DARK;
    ctx.fillRect(126 - i * 8, 21, 5, 5);
    ctx.fillStyle = bout.wins[1] > i ? '#ffcf4a' : DARK;
    ctx.fillRect(W - 131 + i * 8, 21, 5, 5);
  }
  text(ctx, String(Math.ceil(bout.timer / 60)).padStart(2, '0'), W / 2, 13, 14);

  const mid = 88;
  if (bout.phase === 'intro') {
    text(ctx, `ROUND ${bout.round}`, W / 2, mid, 24);
    if (bout.round === 1) text(ctx, '← → MOVE   ↑ JUMP   J PUNCH   K KICK   L BLOCK', W / 2, H - 10, 7, '#d9d2ee');
  } else if (bout.phase === 'fight' && bout.t < 45) {
    text(ctx, 'FIGHT!', W / 2, mid, 28, '#ffcf4a');
  } else if (bout.phase === 'ko') {
    text(ctx, 'K.O.', W / 2, mid, 30, '#ff5a5a');
  } else if (bout.phase === 'timeup') {
    text(ctx, 'TIME', W / 2, mid, 26);
  } else if (bout.phase === 'over') {
    const result = bout.winner === null ? 'DRAW' : bout.winner === 0 ? `${names[0]} WIN!` : `${names[1]} WINS`;
    text(ctx, result, W / 2, mid, 24, bout.winner === 0 ? '#ffcf4a' : '#ffffff');
    if (bout.t >= REMATCH_AFTER && bout.t % 60 < 40) text(ctx, 'PUNCH TO PLAY AGAIN', W / 2, mid + 26, 9);
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
}
