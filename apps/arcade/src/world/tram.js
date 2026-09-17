import { CanvasTexture, Color, Mesh, MeshLambertMaterial, RepeatWrapping, SRGBColorSpace } from 'three';

import { createBuilder } from './builder.js';

/** The tram's own window tile: an arched window with passengers in it, over wood panelling. */
function tramTexture() {
  const w = 128;
  const h = 128;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
  };
  const [colour, c] = make();
  const [glow, e] = make();
  c.fillStyle = '#f2ece0';
  c.fillRect(0, 0, w, h);
  // Panelling below the windows.
  c.fillStyle = '#d9cfbd';
  c.fillRect(0, 84, w, 44);
  c.fillStyle = 'rgba(80,60,40,0.25)';
  for (let x = 0; x < w; x += 16) c.fillRect(x, 88, 2, 40);
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);
  // The arched window and the people behind it.
  const arch = (ctx, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(18, 78);
    ctx.lineTo(18, 34);
    ctx.arc(64, 34, 46, Math.PI, 0);
    ctx.lineTo(110, 78);
    ctx.closePath();
    ctx.fill();
  };
  arch(c, '#2b3a4f');
  const warm = e.createLinearGradient(0, 10, 0, 78);
  warm.addColorStop(0, '#ffe2ad');
  warm.addColorStop(1, '#f6b46f');
  arch(e, warm);
  for (const [ctx, fill] of [
    [c, '#1d2533'],
    [e, '#7a3f1f'],
  ]) {
    ctx.fillStyle = fill;
    for (const [x, s] of [
      [44, 1],
      [82, 0.9],
    ]) {
      ctx.beginPath();
      ctx.arc(x, 50, 9 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, 78, 16 * s, 16 * s, 0, Math.PI, 0);
      ctx.fill();
    }
  }
  const texture = (canvas) => {
    const t = new CanvasTexture(canvas);
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  return { map: texture(colour), emissive: texture(glow) };
}

/**
 * The tram: a wooden driving car and a long green carriage, arched windows
 * with passengers lit warm down both sides, a headlamp and a trolley pole.
 * Built along +z around its own origin; the world moves it along the line.
 */
export function createTram(palette) {
  const { map, emissive } = tramTexture();
  const material = new MeshLambertMaterial({
    map,
    vertexColors: true,
    emissive: new Color('#ffb45c'),
    emissiveMap: emissive,
    // Lit a little even by day: people are aboard.
    emissiveIntensity: Math.max(0.2, palette.windows * 0.7),
  });
  const PLAIN_T = [0.05, 0.95];
  const cars = [
    { length: 5.5, body: '#8a5c3e', roof: '#4e3526', front: true },
    { length: 10, body: '#3d8a7b', roof: '#28604f', front: false },
  ];
  return cars.map(({ length, body, roof, front }) => {
    const b = createBuilder();
    const at = (px, py, pz) => [px, py, pz];
    const hw = 1.35;
    const hl = length / 2;
    const base = 0.7;
    const top = 3.3;
    const wall = new Color(body);
    const bays = Math.max(2, Math.round(length / 1.7));
    const side = (ax, az, bx, bz, count, colour) =>
      b.quad(at(ax, base, az), at(bx, base, bz), at(bx, top, bz), at(ax, top, az), colour, [
        [0, 0],
        [count, 0],
        [count, 1],
        [0, 1],
      ]);
    const light = new Color('#ffffff').lerp(wall, 0.35);
    side(-hw, hl, hw, hl, 1, light);
    side(hw, hl, hw, -hl, bays, light);
    side(hw, -hl, -hw, -hl, 1, light);
    side(-hw, -hl, -hw, hl, bays, light);
    // Coloured skirt and roof line in the car's own colour.
    const plain = [PLAIN_T, PLAIN_T, PLAIN_T, PLAIN_T];
    for (const [ax, az, bx, bz] of [
      [-hw - 0.02, hl + 0.02, hw + 0.02, hl + 0.02],
      [hw + 0.02, hl + 0.02, hw + 0.02, -hl - 0.02],
      [hw + 0.02, -hl - 0.02, -hw - 0.02, -hl - 0.02],
      [-hw - 0.02, -hl - 0.02, -hw - 0.02, hl + 0.02],
    ]) {
      b.quad(at(ax, base, az), at(bx, base, bz), at(bx, base + 0.75, bz), at(ax, base + 0.75, az), wall, plain);
      b.quad(at(ax, top - 0.35, az), at(bx, top - 0.35, bz), at(bx, top, bz), at(ax, top, az), wall, plain);
    }
    const r = new Color(roof);
    b.quad(at(-hw - 0.15, top, hl + 0.2), at(0, top + 0.45, hl + 0.2), at(0, top + 0.45, -hl - 0.2), at(-hw - 0.15, top, -hl - 0.2), r, plain);
    b.quad(at(0, top + 0.45, hl + 0.2), at(hw + 0.15, top, hl + 0.2), at(hw + 0.15, top, -hl - 0.2), at(0, top + 0.45, -hl - 0.2), r, plain);
    b.quad(at(-hw - 0.15, top, -hl - 0.2), at(hw + 0.15, top, -hl - 0.2), at(hw + 0.15, top, hl + 0.2), at(-hw - 0.15, top, hl + 0.2), r.clone().multiplyScalar(0.6), plain);
    const dark = new Color('#2f3238');
    const tbox = (spec, colour) => {
      const p = (dx, dy, dz) => at(spec.cx + dx * spec.sx, spec.cy + dy * spec.sy, spec.cz + dz * spec.sz);
      const sideC = colour.clone().multiplyScalar(0.88);
      b.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), colour, plain);
      b.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), sideC, plain);
      b.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), sideC, plain);
      b.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), colour, plain);
      b.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), colour, plain);
    };
    tbox({ cx: 0, cy: 0.45, cz: 0, sx: hw * 0.8, sy: 0.3, sz: hl * 0.85 }, dark);
    // Bogies at each end.
    for (const z of [-hl * 0.65, hl * 0.65]) tbox({ cx: 0, cy: 0.25, cz: z, sx: hw * 0.9, sy: 0.22, sz: 0.7 }, new Color('#23262b'));
    if (front) {
      // Headlamp: a small lit box on the nose (window-glass UVs glow).
      const g = [0.2, 0.62];
      b.quad(at(-0.25, 1.6, hl + 0.06), at(0.25, 1.6, hl + 0.06), at(0.25, 2.0, hl + 0.06), at(-0.25, 2.0, hl + 0.06), new Color('#ffffff'), [g, g, g, g]);
      // Trolley pole reaching back up to the (unseen) wire.
      tbox({ cx: 0, cy: top + 0.6, cz: -0.4, sx: 0.05, sy: 0.05, sz: 2.2 }, dark);
      tbox({ cx: 0, cy: top + 0.5, cz: 1.4, sx: 0.25, sy: 0.08, sz: 0.25 }, dark);
    }
    const geometry = b.build();
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.userData.length = length;
    return mesh;
  });
}
