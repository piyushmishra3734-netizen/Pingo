import { CanvasTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { CABINET } from './cabinet.js';

/**
 * Screens that are on: each cabinet on the back wall plays its own game's
 * attract loop - a shooter, a brick-breaker, a snake.
 *
 * One canvas holds a 96 x 60 cell per machine (the screens' own 16:10),
 * redrawn about twelve times a second, and the screens are one merged mesh
 * with each plane's UVs on its own cell: a row of running machines for one
 * draw call and one small texture upload per tick.
 */

const CELL_W = 96;
const CELL_H = 60;
const TICK_MS = 80;
/** In front of the cabinet's own screen plane. */
const LIFT = 0.003;

const INVADER = ['..#..#..', '...##...', '..####..', '.##..##.', '########', '#.#..#.#'];

function insertCoin(ctx, frame, y) {
  if (frame % 16 >= 10) return;
  ctx.fillStyle = '#ffcf4a';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('INSERT COIN', CELL_W / 2, y);
}

/** Space shooter: stars falling, invaders stepping, a ship sweeping under them. */
function shooter() {
  const stars = Array.from({ length: 24 }, (_, i) => ({ x: (i * 37) % CELL_W, y: (i * 23) % CELL_H, speed: 1 + (i % 3) }));
  return (ctx, frame) => {
    ctx.fillStyle = '#07051a';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    for (const star of stars) {
      star.y = (star.y + star.speed) % CELL_H;
      ctx.fillStyle = star.speed === 3 ? '#ffffff' : '#7f8cff';
      ctx.fillRect(star.x, star.y, 1, 1);
    }
    const march = Math.floor(frame / 6) % 8;
    ctx.fillStyle = `hsl(${(frame * 3) % 360} 90% 65%)`;
    for (let n = 0; n < 5; n += 1) {
      INVADER.forEach((row, r) => {
        for (let c = 0; c < row.length; c += 1) if (row[c] === '#') ctx.fillRect(10 + n * 16 + march + c, 10 + r, 1, 1);
      });
    }
    const shipX = 44 + Math.round(Math.sin(frame / 9) * 30);
    ctx.fillStyle = '#38e0d0';
    ctx.fillRect(shipX, 50, 7, 2);
    ctx.fillRect(shipX + 3, 48, 1, 2);
    insertCoin(ctx, frame, 36);
  };
}

/** Brick-breaker: a wall of bricks, a paddle following a bouncing ball. */
function breakout() {
  const colours = ['#ff4f8b', '#ffb347', '#ffcf4a', '#38e0d0', '#8b5cff'];
  return (ctx, frame) => {
    ctx.fillStyle = '#0a0716';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    colours.forEach((colour, row) => {
      ctx.fillStyle = colour;
      for (let col = 0; col < 8; col += 1) {
        // A few bricks already knocked out, so it reads as a game in progress.
        if ((row * 8 + col) % 7 === 3) continue;
        ctx.fillRect(4 + col * 11, 6 + row * 4, 10, 3);
      }
    });
    // The ball bounces between the walls; a triangle wave on each axis.
    const bounce = (t, span) => span - Math.abs((t % (2 * span)) - span);
    const bx = 4 + bounce(frame * 2.2, CELL_W - 10);
    const by = 28 + bounce(frame * 1.4, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(bx), Math.round(by), 2, 2);
    ctx.fillStyle = '#38e0d0';
    ctx.fillRect(Math.round(Math.min(CELL_W - 18, Math.max(0, bx - 8))), 54, 18, 2);
    insertCoin(ctx, frame, 44);
  };
}

/** Snake: the snake winding round a loop, an apple blinking ahead of it. */
function snake() {
  const GRID = 4;
  const cols = CELL_W / GRID;
  const rows = CELL_H / GRID;
  // A rectangle inset from the edges, walked cell by cell.
  const path = [];
  for (let x = 2; x < cols - 2; x += 1) path.push([x, 2]);
  for (let y = 2; y < rows - 2; y += 1) path.push([cols - 2, y]);
  for (let x = cols - 2; x > 2; x -= 1) path.push([x, rows - 2]);
  for (let y = rows - 2; y > 2; y -= 1) path.push([2, y]);
  return (ctx, frame) => {
    ctx.fillStyle = '#04120c';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    const head = frame % path.length;
    for (let i = 0; i < 14; i += 1) {
      const [x, y] = path[(head - i + path.length) % path.length];
      ctx.fillStyle = i === 0 ? '#b6ff6a' : '#3fcf5a';
      ctx.fillRect(x * GRID, y * GRID, GRID - 1, GRID - 1);
    }
    const [ax, ay] = path[(head + 12) % path.length];
    if (frame % 6 < 4) {
      ctx.fillStyle = '#ff4f8b';
      ctx.fillRect(ax * GRID, ay * GRID, GRID - 1, GRID - 1);
    }
    insertCoin(ctx, frame, 32);
  };
}

const GAMES = { shooter, breakout, snake };

/**
 * @param {Array<{ x: number, z: number, rot?: number, game: keyof typeof GAMES }>} machines - PINGO cabinets, by origin
 */
export function createLiveScreens(machines) {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * machines.length;
  canvas.height = CELL_H;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;

  const { screen } = CABINET;
  const planes = machines.map(({ x, z, rot = 0 }, index) => {
    const plane = new PlaneGeometry(screen.width, screen.height);
    const uv = plane.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setX(i, (index + uv.getX(i)) / machines.length);
    plane.rotateX(screen.tilt);
    plane.translate(0, screen.y, screen.z + LIFT);
    plane.rotateY(rot);
    plane.translate(x, 0, z);
    return plane;
  });
  const mesh = new Mesh(mergeGeometries(planes), new MeshBasicMaterial({ map: texture }));
  const drawers = machines.map(({ game }) => GAMES[game]());

  let frame = 0;
  let last = 0;
  function draw() {
    drawers.forEach((drawCell, index) => {
      ctx.save();
      ctx.translate(index * CELL_W, 0);
      ctx.beginPath();
      ctx.rect(0, 0, CELL_W, CELL_H);
      ctx.clip();
      drawCell(ctx, frame);
      ctx.restore();
    });
    texture.needsUpdate = true;
  }
  draw();

  return {
    mesh,
    update(now) {
      if (now - last < TICK_MS) return;
      last = now;
      frame += 1;
      draw();
    },
  };
}
