import { CanvasTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { KENNEY_SCREEN as SCREEN } from './cabinet.js';

/**
 * Screens that are on: the other machines in the shop play their attract
 * loop - a starfield, a row of invaders, a ship, INSERT COIN blinking.
 *
 * One tiny canvas (96 x 60, the screens' own 16:10) is redrawn about twelve
 * times a second and shared by every screen, and the screens are one merged
 * mesh: a whole row of running machines for one draw call and one 23 KB
 * texture upload per tick.
 */

const W = 96;
const H = 60;
const TICK_MS = 80;
/** How far in front of the model's own glass, in model units. */
const LIFT = 0.004;

const INVADER = ['..#..#..', '...##...', '..####..', '.##..##.', '########', '#.#..#.#'];

/**
 * @param {Array<{ x: number, z: number, rot?: number }>} machines - Kenney arcade machines, by pivot
 * @param {number} scale - the machines' scale
 */
export function createLiveScreens(machines, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;

  const planes = machines.map(({ x, z, rot = 0 }) => {
    const plane = new PlaneGeometry(SCREEN.width, SCREEN.height);
    plane.rotateX(SCREEN.tilt);
    plane.translate(0, SCREEN.y + Math.sin(-SCREEN.tilt) * LIFT, SCREEN.z + Math.cos(SCREEN.tilt) * LIFT);
    plane.scale(scale, scale, scale);
    plane.rotateY(rot);
    plane.translate(x, 0, z);
    return plane;
  });
  const mesh = new Mesh(mergeGeometries(planes), new MeshBasicMaterial({ map: texture }));

  const stars = Array.from({ length: 26 }, (_, i) => ({ x: (i * 37) % W, y: (i * 23) % H, speed: 1 + (i % 3) }));
  let frame = 0;
  let last = 0;

  function draw() {
    const hue = (frame * 3) % 360;
    ctx.fillStyle = '#07051a';
    ctx.fillRect(0, 0, W, H);
    for (const star of stars) {
      star.y = (star.y + star.speed) % H;
      ctx.fillStyle = star.speed === 3 ? '#ffffff' : '#7f8cff';
      ctx.fillRect(star.x, star.y, 1, 1);
    }
    // A row of invaders stepping side to side.
    const march = Math.floor(frame / 6) % 8;
    ctx.fillStyle = `hsl(${hue} 90% 65%)`;
    for (let n = 0; n < 5; n += 1) {
      const ox = 10 + n * 16 + march;
      INVADER.forEach((row, r) => {
        for (let c = 0; c < row.length; c += 1) if (row[c] === '#') ctx.fillRect(ox + c, 10 + r, 1, 1);
      });
    }
    // The player's ship, sweeping under them.
    const shipX = 44 + Math.round(Math.sin(frame / 9) * 30);
    ctx.fillStyle = '#38e0d0';
    ctx.fillRect(shipX, 50, 7, 2);
    ctx.fillRect(shipX + 3, 48, 1, 2);
    if (frame % 16 < 10) {
      ctx.fillStyle = '#ffcf4a';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('INSERT COIN', W / 2, 36);
    }
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
