import { BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Mesh, MeshLambertMaterial, SRGBColorSpace } from 'three';

import { PLAIN, createBuilder, leaf } from './builder.js';

/**
 * The tram as in the film: a short open wooden driving car coupled to a long
 * teal carriage with a rounded, overhanging roof, big arched windows full of
 * passengers lit warm from inside, cargo and lanterns on the roof, iron bogies.
 *
 * Both cars share one material and one texture atlas. The atlas keeps the
 * builder's PLAIN spot white, so plain parts are coloured by vertex colour
 * alone; the other cells hold window bays, wood planks, framed panels and the
 * carriage's ribbed skirt, all near-white where a vertex colour tints them.
 */

const W = 1024;
const H = 512;
const CELL_W = 160;
const CELL_H = 224;

/** Atlas rectangles in canvas pixels: [x0, y0, x1, y1]. */
const CELLS = {
  window: (i) => [i * CELL_W, 0, (i + 1) * CELL_W, CELL_H],
  planks: [0, 240, 512, 368],
  panel: [512, 240, 768, 368],
  ribs: [768, 240, 1024, 368],
};
/** The window cell that is a door rather than a window. */
const DOOR = 5;
/** A spot that glows at night and by day alike: lamps and lanterns. */
const GLOW = [320 / W, 1 - 448 / H];

/** A point inside an atlas rectangle, fu left to right and fv bottom to top, kept 2 px off the edges. */
function uvIn(rect, fu, fv) {
  const [x0, y0, x1, y1] = rect;
  return [(x0 + 2 + (x1 - x0 - 4) * fu) / W, 1 - (y1 - 2 - (y1 - y0 - 4) * fv) / H];
}

/** UVs for a quad a-b-c-d (bottom-left, bottom-right, top-right, top-left) over part of a rectangle. */
function rectUV(rect, u0 = 0, u1 = 1, v0 = 0, v1 = 1) {
  return [uvIn(rect, u0, v0), uvIn(rect, u1, v0), uvIn(rect, u1, v1), uvIn(rect, u0, v1)];
}

/** A small repeatable random stream, so the passengers are the same every load. */
function random(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** A colour scaled towards black, for the passengers as seen in the glow map. */
function dim(hex, f) {
  return `#${new Color(hex).multiplyScalar(f).getHexString()}`;
}

const SKIN = ['#f1c9a0', '#e0ac69', '#c68642', '#8d5524', '#f5d6ba'];
const HAIR = ['#2b1d14', '#5a3a22', '#c9a25a', '#1d1d24', '#8a4a2a', '#d8d2c8'];
const CLOTHES = ['#c8463c', '#3f7f5a', '#e0b040', '#4a6fa5', '#d77aa0', '#7a4f8a', '#e07a3a', '#2f6f7a'];

/** The arched opening of a window cell, in cell coordinates. */
function archPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(20, 206);
  ctx.lineTo(20, 82);
  ctx.arc(80, 82, 60, Math.PI, 0);
  ctx.lineTo(140, 206);
  ctx.closePath();
}

/** One person seen through the glass: shoulders, head, hair or a hat. */
function drawPerson(ctx, rng, x, headY, scale, f) {
  const skin = SKIN[Math.floor(rng() * SKIN.length)];
  const hair = HAIR[Math.floor(rng() * HAIR.length)];
  const clothes = CLOTHES[Math.floor(rng() * CLOTHES.length)];
  const r = 14 * scale;
  ctx.fillStyle = dim(clothes, f);
  ctx.beginPath();
  ctx.ellipse(x, headY + r * 2.6, r * 1.7, r * 1.5, 0, Math.PI, 0);
  ctx.rect(x - r * 1.7, headY + r * 2.6, r * 3.4, 200);
  ctx.fill();
  ctx.fillStyle = dim(skin, f);
  ctx.beginPath();
  ctx.arc(x, headY, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dim(hair, f);
  ctx.beginPath();
  if (rng() < 0.25) {
    // A hat: crown and brim.
    ctx.rect(x - r * 0.8, headY - r * 1.6, r * 1.6, r * 0.9);
    ctx.rect(x - r * 1.35, headY - r * 0.8, r * 2.7, r * 0.3);
  } else {
    ctx.arc(x, headY - r * 0.15, r * 1.05, Math.PI * 1.05, Math.PI * 1.95);
    if (rng() < 0.4) ctx.arc(x + r * 0.9, headY + r * 0.6, r * 0.45, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * One window bay. In the colour map: cream frame, salmon arch, warm interior
 * with the far windows showing through, two or three passengers. In the glow
 * map: the same interior bright and the passengers darker, so at night they
 * read as figures against the lamplight.
 */
function paintWindow(ctx, variant, glow) {
  const rng = random(variant * 977 + 13);
  const f = glow ? 0.4 : 1;
  ctx.save();
  if (!glow) {
    ctx.fillStyle = '#efe3c8';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
  }
  archPath(ctx);
  ctx.save();
  ctx.clip();
  const warm = ctx.createLinearGradient(0, 20, 0, 206);
  warm.addColorStop(0, glow ? '#fff0c8' : '#ffe2b0');
  warm.addColorStop(1, glow ? '#f4a860' : '#e89a5c');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, CELL_W, CELL_H);
  // The far side's windows, a cooler band behind the people.
  ctx.fillStyle = glow ? 'rgba(90,50,20,0.35)' : 'rgba(70,90,120,0.45)';
  ctx.fillRect(0, 70, CELL_W, 56);
  ctx.fillStyle = glow ? 'rgba(120,70,30,0.5)' : 'rgba(150,90,60,0.6)';
  ctx.fillRect(74, 64, 12, 70);
  // A ceiling lamp.
  const lamp = ctx.createRadialGradient(80, 34, 2, 80, 34, 40);
  lamp.addColorStop(0, 'rgba(255,250,225,0.95)');
  lamp.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, CELL_W, 90);
  const count = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i += 1) {
    const x = 20 + ((i + 0.5) * 120) / count + (rng() - 0.5) * 14;
    drawPerson(ctx, rng, x, 118 + rng() * 34, 0.8 + rng() * 0.4, f);
  }
  if (!glow) {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(30, 206);
    ctx.lineTo(70, 20);
    ctx.lineTo(92, 20);
    ctx.lineTo(52, 206);
    ctx.fill();
  }
  ctx.restore();
  if (!glow) {
    archPath(ctx);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#d9876c';
    ctx.stroke();
    ctx.fillStyle = '#d6c4a0';
    ctx.fillRect(10, 202, 140, 14);
  }
  ctx.restore();
}

/** The door bay: a teal door with a glazed top and one person standing behind it. */
function paintDoor(ctx, glow) {
  const rng = random(4242);
  if (!glow) {
    ctx.fillStyle = '#efe3c8';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    ctx.fillStyle = '#24584f';
    ctx.fillRect(22, 14, 116, 206);
    ctx.fillStyle = '#1b463f';
    ctx.fillRect(34, 140, 40, 66);
    ctx.fillRect(86, 140, 40, 66);
    ctx.fillStyle = '#e0b040';
    ctx.beginPath();
    ctx.arc(124, 128, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(34, 26, 92, 100);
  ctx.clip();
  ctx.fillStyle = glow ? '#ffe2b0' : '#f2b878';
  ctx.fillRect(34, 26, 92, 100);
  drawPerson(ctx, rng, 80, 66, 1.1, glow ? 0.4 : 1);
  ctx.restore();
}

/** The atlas: colour map and glow map, painted cell for cell. */
function tramTexture() {
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    return [canvas, canvas.getContext('2d')];
  };
  const [colour, c] = make();
  const [glow, e] = make();
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, W, H);

  for (let i = 0; i <= DOOR; i += 1) {
    for (const [ctx, isGlow] of [
      [c, false],
      [e, true],
    ]) {
      ctx.save();
      ctx.translate(i * CELL_W, 0);
      if (i === DOOR) paintDoor(ctx, isGlow);
      else paintWindow(ctx, i, isGlow);
      ctx.restore();
    }
  }

  // Planks: near-white boards with seams and grain, tinted by vertex colour.
  const rng = random(7);
  {
    const [x0, y0, x1, y1] = CELLS.planks;
    for (let y = y0; y < y1; y += 16) {
      const tone = 225 + Math.floor(rng() * 30);
      c.fillStyle = `rgb(${tone},${tone},${tone})`;
      c.fillRect(x0, y, x1 - x0, 16);
      c.fillStyle = 'rgba(90,60,40,0.12)';
      for (let g = 0; g < 6; g += 1) c.fillRect(x0 + rng() * 480, y + 3 + rng() * 10, 30 + rng() * 80, 1);
      c.fillStyle = 'rgba(70,45,30,0.55)';
      c.fillRect(x0, y + 14, x1 - x0, 2);
    }
  }
  // A framed, recessed panel, for the wooden car's lower walls.
  {
    const [x0, y0, x1, y1] = CELLS.panel;
    c.fillStyle = '#f6f6f6';
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.fillStyle = '#d8d8d8';
    c.fillRect(x0 + 22, y0 + 22, x1 - x0 - 44, y1 - y0 - 44);
    c.fillStyle = 'rgba(40,25,15,0.35)';
    c.fillRect(x0 + 22, y0 + 22, x1 - x0 - 44, 4);
    c.fillRect(x0 + 22, y0 + 22, 4, y1 - y0 - 44);
    c.fillStyle = '#ffffff';
    c.fillRect(x0 + 22, y1 - 26, x1 - x0 - 44, 4);
    c.fillStyle = 'rgba(40,25,15,0.4)';
    c.fillRect(x0, y0, x1 - x0, 3);
    c.fillRect(x0, y1 - 3, x1 - x0, 3);
    c.fillRect(x0, y0, 3, y1 - y0);
    c.fillRect(x1 - 3, y0, 3, y1 - y0);
  }
  // Ribs: the carriage's pressed-metal skirt, one rounded rib every 16 px.
  {
    const [x0, y0, x1, y1] = CELLS.ribs;
    for (let x = x0; x < x1; x += 16) {
      const g = c.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, '#c4c4c4');
      g.addColorStop(0.45, '#ffffff');
      g.addColorStop(1, '#bdbdbd');
      c.fillStyle = g;
      c.fillRect(x, y0, 16, y1 - y0);
    }
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(x0, y0, x1 - x0, 6);
  }
  // The lamp spot glows in both maps.
  c.fillStyle = '#fffbe8';
  c.fillRect(256, 384, 128, 128);
  e.fillStyle = '#fff0c0';
  e.fillRect(256, 384, 128, 128);

  const texture = (canvas) => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  return { map: texture(colour), emissive: texture(glow) };
}

/** A box from its centre and half-sizes, all six faces, on one atlas spot. */
function cube(b, [cx, cy, cz], [sx, sy, sz], colour, spot = PLAIN) {
  const p = (dx, dy, dz) => [cx + dx * sx, cy + dy * sy, cz + dz * sz];
  const uv = [spot, spot, spot, spot];
  const side = colour.clone().multiplyScalar(0.86);
  b.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), colour, uv);
  b.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), side, uv);
  b.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), side, uv);
  b.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), side, uv);
  b.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), colour, uv);
  b.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), colour, uv);
}

/** A smooth blob (sack, bush, head) at a point, from the shared leaf sphere. */
function blob(b, [x, y, z], [sx, sy, sz], colour, detail = 0) {
  b.addGeometry(leaf(detail).clone().scale(sx, sy, sz).translate(x, y, z), colour);
}

const hex = (h) => new Color(h);
const IRON = hex('#2a2d33');
const IRON_LIGHT = hex('#4a4f58');

/** An iron wheel on an axle across x: an octagon rim and an outer face. */
function wheel(b, x, y, z, r, outward) {
  const t = 0.06;
  const ring = (dx) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      return [x + dx, y + Math.sin(a) * r, z + Math.cos(a) * r];
    });
  const inner = ring(-t * outward);
  const outer = ring(t * outward);
  for (let i = 0; i < 8; i += 1) {
    const j = (i + 1) % 8;
    b.quad(inner[i], inner[j], outer[j], outer[i], IRON);
  }
  const hub = [x + t * outward, y, z];
  for (let i = 0; i < 8; i += 1) b.tri(hub, outer[i], outer[(i + 1) % 8], [PLAIN, PLAIN, PLAIN], IRON_LIGHT);
}

/**
 * A bogie: four wheels sitting on the rails (the track's gauge is 2.4 m and
 * its rail tops are 0.04 above the car's origin), iron side frames outside
 * them with springs, and a bolster up to the floor.
 */
function bogie(b, z) {
  const r = 0.3;
  for (const s of [-1, 1]) {
    for (const dz of [-0.55, 0.55]) wheel(b, s * 1.2, 0.04 + r * Math.cos(Math.PI / 8), z + dz, r, s);
    cube(b, [s * 1.32, 0.4, z], [0.04, 0.09, 0.95], IRON_LIGHT);
    cube(b, [s * 1.33, 0.52, z], [0.05, 0.08, 0.16], IRON);
  }
  cube(b, [0, 0.52, z], [1.2, 0.07, 0.18], IRON);
}

/** A person: body, head and hair; seated ones are shorter. */
function person(b, [x, y, z], seed, seated = true) {
  const rng = random(seed * 131 + 7);
  const pick = (list) => hex(list[Math.floor(rng() * list.length)]);
  const tall = seated ? 0.24 : 0.42;
  cube(b, [x, y + tall, z], [0.17, tall, 0.11], pick(CLOTHES));
  const head = y + tall * 2 + 0.14;
  blob(b, [x, head, z], [0.13, 0.14, 0.13], pick(SKIN));
  blob(b, [x, head + 0.06, z - 0.01], [0.14, 0.1, 0.14], pick(HAIR));
}

/** A lantern: iron cap and base around a glowing lamp. */
function lantern(b, [x, y, z], size = 1) {
  cube(b, [x, y, z], [0.07 * size, 0.1 * size, 0.07 * size], hex('#ffffff'), GLOW);
  cube(b, [x, y + 0.12 * size, z], [0.09 * size, 0.025 * size, 0.09 * size], IRON);
  cube(b, [x, y - 0.11 * size, z], [0.06 * size, 0.015 * size, 0.06 * size], IRON);
}

/**
 * The wooden driving car: panelled lower walls, open above them with slim
 * posts, benches with passengers and the driver at the controller, a planked
 * pitched roof, a lamp on the nose and two low headlamps.
 */
function frontCar(b) {
  const length = 5.5;
  const hl = length / 2;
  const hw = 1.3;
  const wood = hex('#8a5a3a');
  const woodLight = hex('#b07a4e');
  const woodDark = hex('#5e3d27');

  cube(b, [0, 0.62, 0], [1.0, 0.1, hl - 0.3], IRON);
  for (const z of [-1.5, 1.5]) bogie(b, z);
  cube(b, [0, 0.78, 0], [hw + 0.03, 0.06, hl + 0.03], woodDark);
  for (const s of [-1, 1]) cube(b, [0, 0.72, s * (hl + 0.1)], [0.95, 0.1, 0.07], IRON);
  cube(b, [0, 0.64, -(hl + 0.2)], [0.08, 0.06, 0.2], IRON);

  // Lower walls: framed panels, three down each side and two on each end.
  const low = 0.84;
  const waist = 1.56;
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k += 1) {
      const z0 = -hl + (k * length) / 3;
      const z1 = z0 + length / 3;
      b.quad([s * hw, low, z0], [s * hw, low, z1], [s * hw, waist, z1], [s * hw, waist, z0], wood, rectUV(CELLS.panel));
    }
    for (const k of [0, 1]) {
      const x0 = -hw + k * hw;
      b.quad([x0, low, s * hl], [x0 + hw, low, s * hl], [x0 + hw, waist, s * hl], [x0, waist, s * hl], wood, rectUV(CELLS.panel));
    }
    cube(b, [s * hw, waist + 0.02, 0], [0.07, 0.03, hl + 0.05], woodLight);
    cube(b, [0, waist + 0.02, s * hl], [hw + 0.05, 0.03, 0.07], woodLight);
    // Slim posts up to the roof, and the header rail they carry.
    for (let k = 0; k <= 4; k += 1) cube(b, [s * hw, 2.3, -hl + (k * length) / 4], [0.045, 0.72, 0.045], woodDark);
    for (const x of [-0.45, 0.45]) cube(b, [x, 2.3, s * hl], [0.04, 0.72, 0.04], woodDark);
    cube(b, [s * hw, 3.0, 0], [0.06, 0.05, hl + 0.05], wood);
    cube(b, [0, 3.0, s * hl], [hw + 0.05, 0.05, 0.06], wood);
  }

  // Pitched plank roof, overhanging, with fascia boards and gable ends.
  const eave = 3.06;
  const ridge = 3.32;
  const rw = 1.58;
  const rl = hl + 0.32;
  const roof = hex('#7a4c2e');
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k += 1) {
      const z0 = -rl + (k * 2 * rl) / 3;
      const z1 = z0 + (2 * rl) / 3;
      b.quad([s * rw, eave, z0], [0, ridge, z0], [0, ridge, z1], [s * rw, eave, z1], roof, rectUV(CELLS.planks));
    }
    cube(b, [s * rw, eave - 0.03, 0], [0.04, 0.06, rl], woodDark);
    cube(b, [0, eave - 0.03, s * rl], [rw + 0.02, 0.06, 0.04], woodDark);
    b.tri([-rw, eave, s * rl], [rw, eave, s * rl], [0, ridge, s * rl], [PLAIN, PLAIN, PLAIN], woodDark);
  }

  // Benches facing forward, passengers on two of them, the driver at the front.
  const cushion = hex('#44618c');
  for (const [z, riders] of [
    [0.9, [0.5]],
    [-0.4, [-0.5, 0.45]],
    [-1.7, []],
  ]) {
    cube(b, [0, 1.16, z], [0.95, 0.05, 0.24], cushion);
    cube(b, [0, 1.48, z - 0.24], [0.95, 0.28, 0.04], cushion.clone().multiplyScalar(0.8));
    cube(b, [0, 0.98, z], [0.9, 0.14, 0.03], woodDark);
    riders.forEach((x, i) => person(b, [x, 1.2, z + 0.02], Math.round(z * 10) + i));
  }
  cube(b, [-0.6, 1.25, 2.35], [0.1, 0.4, 0.1], IRON);
  cube(b, [-0.6, 1.68, 2.35], [0.14, 0.04, 0.14], hex('#c9a04a'));
  person(b, [-0.2, 0.84, 2.05], 99, false);

  // Lamps: one on the nose under the roof, two low on the front panel.
  cube(b, [0, 2.72, hl + 0.1], [0.15, 0.15, 0.08], hex('#6b5a3a'));
  cube(b, [0, 2.72, hl + 0.19], [0.1, 0.1, 0.02], hex('#ffffff'), GLOW);
  for (const x of [-0.85, 0.85]) {
    cube(b, [x, 1.1, hl + 0.03], [0.12, 0.12, 0.03], IRON);
    cube(b, [x, 1.1, hl + 0.07], [0.08, 0.08, 0.02], hex('#ffffff'), GLOW);
  }
  return length;
}

/**
 * The carriage: a ribbed skirt that tucks under (tumblehome), a teal belt
 * rail, nine arched window bays with salmon pillars and a door in the middle,
 * a rounded overhanging roof with a scalloped edge, and roof cargo - a railed
 * luggage rack with crates and a trunk, sacks, a fern, lanterns, a vent.
 */
function carriage(b) {
  const length = 10;
  const hl = length / 2;
  const teal = hex('#2f7f70');
  const tealDark = hex('#235f54');
  const skirt = hex('#d3dccd');
  const pillar = hex('#d9876c');

  cube(b, [0, 0.6, 0], [1.0, 0.12, hl - 0.4], IRON);
  for (const z of [-3.2, 3.2]) bogie(b, z);
  for (const s of [-1, 1]) cube(b, [0, 0.74, s * (hl + 0.08)], [1.0, 0.1, 0.07], IRON);
  cube(b, [0, 0.64, hl + 0.2], [0.08, 0.06, 0.2], IRON);

  // The skirt's profile, bottom to top: tucked in, bulging, up to the sill.
  const profile = [
    [1.12, 0.74],
    [1.3, 0.98],
    [1.36, 1.34],
    [1.345, 1.76],
  ];
  const fv = (y) => (y - 0.74) / (1.76 - 0.74);
  for (let j = 0; j < profile.length - 1; j += 1) {
    const [x0, y0] = profile[j];
    const [x1, y1] = profile[j + 1];
    for (const s of [-1, 1]) {
      b.quad([s * x0, y0, s * hl], [s * x0, y0, -s * hl], [s * x1, y1, -s * hl], [s * x1, y1, s * hl], skirt, rectUV(CELLS.ribs, 0, 1, fv(y0), fv(y1)));
      // The ends follow the same profile.
      b.quad([-s * x0, y0, s * hl], [s * x0, y0, s * hl], [s * x1, y1, s * hl], [-s * x1, y1, s * hl], skirt, rectUV(CELLS.ribs, 0.35, 0.65, fv(y0), fv(y1)));
    }
  }

  // Window bays and pillars down both sides.
  const sill = 1.76;
  const head = 2.96;
  const bays = 9;
  const bw = length / bays;
  for (const s of [-1, 1]) {
    const x = s * 1.345;
    for (let i = 0; i < bays; i += 1) {
      const z0 = -hl + i * bw;
      const z1 = z0 + bw;
      const cell = i === 4 ? DOOR : (i * 2 + (s > 0 ? 1 : 3)) % 5;
      const [za, zb] = s > 0 ? [z1, z0] : [z0, z1];
      b.quad([x, sill, za], [x, sill, zb], [x, head, zb], [x, head, za], hex('#ffffff'), rectUV(CELLS.window(cell)));
    }
    for (let i = 0; i <= bays; i += 1) cube(b, [s * 1.365, (sill + head) / 2, -hl + i * bw], [0.05, (head - sill) / 2, 0.05], pillar);
    cube(b, [s * 1.37, sill, 0], [0.035, 0.04, hl + 0.02], teal);
    b.quad([x, head, s * hl], [x, head, -s * hl], [x, 3.14, -s * hl], [x, 3.14, s * hl], teal);
    // Steps under the door.
    cube(b, [s * 1.45, 0.55, -hl + 4.5 * bw], [0.12, 0.035, 0.42], hex('#5e3d27'));

    // The ends: two windows either side of a centre pillar, lamps below.
    const z = s * hl;
    const ends = s > 0 ? [0, 3] : [2, 4];
    b.quad([-1.345, sill, z], [-0.04, sill, z], [-0.04, head, z], [-1.345, head, z], hex('#ffffff'), rectUV(CELLS.window(ends[0])));
    b.quad([0.04, sill, z], [1.345, sill, z], [1.345, head, z], [0.04, head, z], hex('#ffffff'), rectUV(CELLS.window(ends[1])));
    cube(b, [0, (sill + head) / 2, z + s * 0.02], [0.05, (head - sill) / 2, 0.03], pillar);
    cube(b, [0, sill, z + s * 0.02], [1.37, 0.04, 0.035], teal);
    b.quad([-1.345, head, z], [1.345, head, z], [1.345, 3.14, z], [-1.345, 3.14, z], teal);
    for (const lx of [-0.95, 0.95]) {
      cube(b, [lx, 1.2, z + s * 0.03], [0.12, 0.12, 0.03], IRON);
      cube(b, [lx, 1.2, z + s * 0.07], [0.08, 0.08, 0.02], hex('#ffffff'), GLOW);
    }
  }

  // The rounded roof: a smooth shell, flat-topped with steep eaves, overhanging.
  const eave = 3.12;
  const rise = 0.42;
  const ra = 1.62;
  const rl = hl + 0.35;
  const roofY = (x) => eave + rise * Math.cbrt(Math.max(0, 1 - Math.abs(x / ra) ** 3));
  const pts = Array.from({ length: 15 }, (_, i) => {
    const t = (i / 14) * Math.PI;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    return [ra * Math.sign(c) * Math.abs(c) ** (2 / 3), eave + rise * sn ** (2 / 3)];
  });
  b.addGeometry(shell(pts, eave, -rl, rl), teal);
  for (const s of [-1, 1]) {
    for (let i = 0; i < pts.length - 1; i += 1) {
      b.tri([0, eave, s * rl], [pts[i][0], pts[i][1], s * rl], [pts[i + 1][0], pts[i + 1][1], s * rl], [PLAIN, PLAIN, PLAIN], tealDark);
    }
    // Scalloped edge, like leaves hanging from the eaves.
    const n = 24;
    for (let k = 0; k < n; k += 1) {
      const z0 = -rl + (k * 2 * rl) / n;
      const z1 = z0 + (2 * rl) / n;
      b.tri([s * ra, eave, z0], [s * ra, eave, z1], [s * ra, eave - 0.14, (z0 + z1) / 2], [PLAIN, PLAIN, PLAIN], tealDark);
    }
    for (let k = 0; k < 7; k += 1) {
      const x0 = -ra + (k * 2 * ra) / 7;
      const x1 = x0 + (2 * ra) / 7;
      b.tri([x0, eave, s * rl], [x1, eave, s * rl], [(x0 + x1) / 2, eave - 0.14, s * rl], [PLAIN, PLAIN, PLAIN], tealDark);
    }
  }

  // A louvred vent on the front of the roof.
  const vent = hex('#8fcf9a');
  for (let k = 0; k < 4; k += 1) {
    const z = hl - 0.2 + k * 0.14;
    cube(b, [0, roofY(0.5) + 0.06 - k * 0.02, z], [0.45, 0.025, 0.045], vent);
  }

  // The luggage rack: posts and rails around the middle of the roof.
  const rack = hex('#3a3024');
  const top = roofY(1.0);
  const [rz0, rz1] = [-4.2, 1.8];
  for (const x of [-0.95, 0.95]) {
    for (let k = 0; k <= 3; k += 1) cube(b, [x, top + 0.16, rz0 + ((rz1 - rz0) * k) / 3], [0.025, 0.17, 0.025], rack);
    cube(b, [x, top + 0.3, (rz0 + rz1) / 2], [0.025, 0.025, (rz1 - rz0) / 2], rack);
  }
  for (const z of [rz0, rz1]) cube(b, [0, top + 0.3, z], [0.95, 0.025, 0.025], rack);

  // Cargo in the rack: crates, a banded trunk, a small box stacked on top, sacks.
  const crate = (x, z, [sx, sy, sz], colour) => {
    const y = roofY(Math.abs(x) + sx) + sy - 0.02;
    cube(b, [x, y, z], [sx, sy, sz], hex(colour));
    return y + sy;
  };
  crate(0.45, 1.1, [0.3, 0.22, 0.34], '#9a6a40');
  crate(-0.4, 0.5, [0.34, 0.28, 0.3], '#7a5234');
  const trunk = crate(0.35, -0.6, [0.36, 0.2, 0.5], '#3e5f7c');
  cube(b, [0.35, trunk - 0.2, -0.6], [0.37, 0.21, 0.04], hex('#c9a04a'));
  const stack = crate(-0.35, -1.6, [0.3, 0.3, 0.3], '#a8743f');
  cube(b, [-0.3, stack + 0.14, -1.55], [0.2, 0.14, 0.2], hex('#c49a5a'));
  crate(0.4, -2.6, [0.34, 0.24, 0.38], '#6d4a33');
  crate(0.3, -3.7, [0.26, 0.2, 0.26], '#8b5a3c');
  blob(b, [-0.35, roofY(0.6) + 0.14, -3.2], [0.32, 0.18, 0.4], hex('#c9b48a'));
  blob(b, [-0.45, roofY(0.8) + 0.16, 2.9], [0.3, 0.2, 0.3], hex('#b8433a'));

  // A fern in a pot at the front corner, and a round bush at the back.
  const potY = roofY(1.1) + 0.12;
  cube(b, [-0.9, potY, 3.9], [0.16, 0.14, 0.16], hex('#b86b45'));
  const fern = hex('#3f7a3a');
  for (let k = 0; k < 9; k += 1) {
    const a = (k / 9) * Math.PI * 2;
    const tip = [-0.9 + Math.cos(a) * 0.75, potY + 0.45 + (k % 3) * 0.12, 3.9 + Math.sin(a) * 0.75];
    const side = [-Math.sin(a) * 0.08, 0, Math.cos(a) * 0.08];
    const base = [-0.9, potY + 0.12, 3.9];
    b.tri([base[0] - side[0], base[1], base[2] - side[2]], [base[0] + side[0], base[1], base[2] + side[2]], tip, [PLAIN, PLAIN, PLAIN], fern);
  }
  blob(b, [0.7, roofY(0.7) + 0.25, -4.6], [0.4, 0.34, 0.4], hex('#4f8a45'), 1);

  // Lanterns on the rack's corner posts and one by the fern.
  lantern(b, [0.95, top + 0.46, rz1]);
  lantern(b, [-0.95, top + 0.46, rz0]);
  lantern(b, [0.95, top + 0.46, -1.2]);
  lantern(b, [-0.45, roofY(0.45) + 0.14, 4.3], 1.3);
  return length;
}

/**
 * A smooth roof shell swept along z through a cross-section, normals taken
 * across each point's neighbours so the curve shades without facets.
 */
function shell(pts, eave, z0, z1) {
  const position = [];
  const normal = [];
  const n = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(pts.length - 1, i + 1)];
    let nx = c[1] - a[1];
    let ny = -(c[0] - a[0]);
    if (nx * p[0] + ny * (p[1] - eave + 0.3) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const len = Math.hypot(nx, ny) || 1;
    return [nx / len, ny / len];
  });
  const v = (i, z) => {
    position.push(pts[i][0], pts[i][1], z);
    normal.push(n[i][0], n[i][1], 0);
  };
  for (let i = 0; i < pts.length - 1; i += 1) {
    // Points run from +x over the top to -x, so this winding faces outward.
    v(i, z0);
    v(i + 1, z0);
    v(i + 1, z1);
    v(i, z0);
    v(i + 1, z1);
    v(i, z1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  return g;
}

/**
 * The tram: [front, carriage], each built along +z around its own origin with
 * its wheels on the rails, one shared material, one draw call per car.
 */
export function createTram(palette) {
  const { map, emissive } = tramTexture();
  const material = new MeshLambertMaterial({
    map,
    vertexColors: true,
    side: DoubleSide,
    emissive: new Color('#ffffff'),
    emissiveMap: emissive,
    // Lit a little even by day: people are aboard and the lamps are on.
    emissiveIntensity: 0.3 + 0.7 * palette.windows,
  });
  return [frontCar, carriage].map((build) => {
    const b = createBuilder();
    const length = build(b);
    const geometry = b.build();
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.userData.length = length;
    return mesh;
  });
}
