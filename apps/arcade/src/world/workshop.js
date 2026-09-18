import { CanvasTexture, CatmullRomCurve3, Color, Group, LineCurve3, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, SRGBColorSpace, Vector3 } from 'three';

import { PLAIN, box, createBuilder } from './builder.js';
import { bench } from './town.js';

/**
 * Pingo Cloudworks, the tram workshop, after the film's yard at dusk: long
 * sheds of brick-red planks under dark navy roofs, a timber gantry crane over
 * the bay where the tram is fitted (posts, cross beams, knee braces, a trolley
 * with a hook on a rope), a navy sign board hanging from the gantry, parallel
 * tracks on wooden sleepers across pale paving, crates and a bench, open
 * shelters, a timber two-storey house with lit windows at the exit, and the
 * yard of diverging tracks the tram leaves through.
 *
 * Built round its own origin; the lead places the group in the world.
 * Local frame: ground at y = 0, the bay track runs along z and the tram
 * leaves towards +z. The workshop's own sheds stand on -x (behind the tram)
 * and the small sheds and the house on +x (the camera side in the film).
 *
 * Draw calls: the solid mesh (vertex colours, Lambert), the lit mesh (sign
 * face, windows, lamp glass - unlit, sampling the sign's canvas), the hook
 * and its rope.
 *
 * Track height follows railway.js: sleeper tops 0.12 m, rail tops 0.34 m over
 * the track's centre line, and the tram rides at the line's y + 0.3.
 */

const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

const C = {
  paving: new Color('#b6b3c6'),
  pavingAlt: new Color('#aba8bd'),
  grout: new Color('#8d8aa0'),
  brick: new Color('#8f3d34'),
  brickDark: new Color('#6e2e29'),
  plank: new Color('#7e342d'),
  navy: new Color('#27305a'),
  navyDark: new Color('#1b2240'),
  wood: new Color('#b27b4c'),
  woodDark: new Color('#7d5537'),
  timber: new Color('#664737'),
  sleeper: new Color('#7a5a40'),
  sleeperDark: new Color('#553e2c'),
  rail: new Color('#2d3552'),
  railTop: new Color('#5b6282'),
  brass: new Color('#c9a24a'),
  iron: new Color('#2f3238'),
  crate: new Color('#a8774b'),
  window: new Color('#ffdc9a'),
  slit: new Color('#f0b866'),
  white: new Color('#ffffff'),
};

/** The sign canvas: the board on top, a plain white strip below that lit parts sample. */
const SIGN_V0 = 32 / 192;
const LIT = [[0.5, 0.06], [0.52, 0.06], [0.52, 0.1], [0.5, 0.1]];

function signTexture(name) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 160, 1024, 32);
  c.fillStyle = '#243056';
  c.fillRect(0, 0, 1024, 160);
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = 4;
  c.strokeRect(10, 10, 1004, 140);
  c.fillStyle = '#f7f3ea';
  c.font = "700 76px system-ui, -apple-system, 'Segoe UI', sans-serif";
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(name, 512, 84, 960);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const at0 = (x, y, z) => [x, y, z];

/** A flat face looking along +x (dir 1) or -x (dir -1). */
function xFace(b, x, z0, z1, y0, y1, colour, dir, uvs) {
  const [za, zb] = dir > 0 ? [z1, z0] : [z0, z1];
  b.quad([x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za], colour, uvs);
}

/** A flat face looking along +z (dir 1) or -z (dir -1). */
function zFace(b, z, x0, x1, y0, y1, colour, dir, uvs) {
  const [xa, xb] = dir > 0 ? [x0, x1] : [x1, x0];
  b.quad([xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z], colour, uvs);
}

/** A square timber from p0 to p1 (four sides, no ends): braces and rods. */
function strut(b, p0, p1, r, colour) {
  const dir = new Vector3().subVectors(p1, p0).normalize();
  const u = new Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? X : UP).normalize().multiplyScalar(r);
  const v = new Vector3().crossVectors(dir, u);
  const corners = [u, v, u.clone().negate(), v.clone().negate()];
  const shade = colour.clone().multiplyScalar(0.85);
  for (let k = 0; k < 4; k += 1) {
    const c0 = corners[k];
    const c1 = corners[(k + 1) % 4];
    const a = p0.clone().add(c0);
    const bq = p0.clone().add(c1);
    const c = p1.clone().add(c1);
    const d = p1.clone().add(c0);
    b.quad([a.x, a.y, a.z], [bq.x, bq.y, bq.z], [c.x, c.y, c.z], [d.x, d.y, d.z], k % 2 ? shade : colour);
  }
}

/**
 * A gable roof with its ridge along z over walls x0..x1, z0..z1 of height h:
 * two navy slopes, gable ends in the wall colour, a navy fascia under the
 * eaves and pale timber barge boards up the gables (the film's light trim).
 */
function gableRoof(b, { x0, x1, z0, z1, h, rise, o = 0.6, wall, detail }) {
  const xc = (x0 + x1) / 2;
  const top = h + rise;
  const [ex0, ex1, ez0, ez1] = [x0 - o, x1 + o, z0 - o, z1 + o];
  // Eaves drop a little below the wall top, so the slope overhangs.
  const eh = h - o * (rise / ((x1 - x0) / 2));
  b.quad([ex1, eh, ez1], [ex1, eh, ez0], [xc, top, ez0], [xc, top, ez1], C.navy);
  b.quad([ex0, eh, ez0], [ex0, eh, ez1], [xc, top, ez1], [xc, top, ez0], C.navy.clone().multiplyScalar(0.8));
  b.tri([x0, h, z1], [x1, h, z1], [xc, top - 0.05, z1], [PLAIN, PLAIN, PLAIN], wall);
  b.tri([x1, h, z0], [x0, h, z0], [xc, top - 0.05, z0], [PLAIN, PLAIN, PLAIN], wall.clone().multiplyScalar(0.88));
  xFace(b, ex1, ez0, ez1, eh - 0.22, eh, C.navyDark, 1);
  xFace(b, ex0, ez0, ez1, eh - 0.22, eh, C.navyDark, -1);
  if (detail < 1) return;
  const t = 0.24;
  for (const [zf, dir] of [
    [ez1, 1],
    [ez0, -1],
  ]) {
    const halves = [
      [[ex0, eh - t, zf], [xc, top - t, zf], [xc, top, zf], [ex0, eh, zf]],
      [[xc, top - t, zf], [ex1, eh - t, zf], [ex1, eh, zf], [xc, top, zf]],
    ];
    for (const q of halves) {
      if (dir > 0) b.quad(q[0], q[1], q[2], q[3], C.wood);
      else b.quad(q[1], q[0], q[3], q[2], C.wood);
    }
  }
}

/**
 * A plank shed: brick-red walls, a darker base, vertical board lines and navy
 * posts on the face towards the yard (`face`: +1 looks along +x, -1 along -x),
 * with a door and, on the long workshop sheds, rows of lit slits.
 */
function shed(b, lit, { x0, x1, z0, z1, h, rise, face, slits = false, door = true, detail }) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  box(b, at0, { cx, cy: h / 2, cz, sx: (x1 - x0) / 2, sy: h / 2, sz: (z1 - z0) / 2 }, C.brick);
  gableRoof(b, { x0, x1, z0, z1, h, rise, wall: C.brick, detail });
  const fx = face > 0 ? x1 : x0;
  const out = (d) => fx + face * d;
  // Base course and a timber beam under the eaves.
  xFace(b, out(0.03), z0, z1, 0, 0.9, C.brickDark, face);
  if (detail >= 1) box(b, at0, { cx: out(0.12), cy: h - 0.35, cz, sx: 0.12, sy: 0.14, sz: (z1 - z0) / 2 + 0.1 }, C.wood);
  // Board lines.
  if (detail >= 3) {
    for (let z = z0 + 0.7; z < z1 - 0.3; z += 0.7) xFace(b, out(0.015), z, z + 0.06, 0.9, h - 0.5, C.plank, face);
  }
  // Navy posts every bay; lit slits between them on the workshop sheds.
  const bays = Math.max(1, Math.round((z1 - z0) / 5));
  const bay = (z1 - z0) / bays;
  for (let i = 0; i <= bays; i += 1) {
    const z = z0 + bay * i;
    if (detail >= 1 || i === 0 || i === bays) box(b, at0, { cx: out(0.12), cy: h / 2, cz: z, sx: 0.12, sy: h / 2, sz: 0.18 }, C.navyDark);
    if (!slits || i === bays || detail < 1) continue;
    const n = detail >= 2 ? 4 : 2;
    for (let k = 0; k < n; k += 1) {
      const sz = z + (bay * (k + 1)) / (n + 1);
      xFace(lit, out(0.03), sz - 0.06, sz + 0.06, h * 0.52, h * 0.52 + 0.9, C.slit, face, LIT);
    }
    // Low lit hatches along the base, as in the film's workshop wall.
    if (detail >= 2) xFace(lit, out(0.035), z + bay * 0.3, z + bay * 0.36, 0.45, 0.6, C.slit, face, LIT);
  }
  if (!door) return;
  const dw = Math.min(1.4, (z1 - z0) * 0.25);
  xFace(b, out(0.04), cz - dw, cz + dw, 0, Math.min(h - 0.6, 2.6), C.navyDark, face);
  if (detail >= 2) box(b, at0, { cx: out(0.06), cy: 2.7, cz, sx: 0.06, sy: 0.1, sz: dw + 0.15 }, C.wood);
}

/** An open shelter: a navy roof slab with timber edge on four thin dark posts. */
function shelter(b, { x, z, w, d, h = 2.8 }) {
  for (const [px, pz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    box(b, at0, { cx: x + px * (w / 2 - 0.2), cy: h / 2, cz: z + pz * (d / 2 - 0.2), sx: 0.07, sy: h / 2, sz: 0.07 }, C.navyDark);
  }
  box(b, at0, { cx: x, cy: h + 0.12, cz: z, sx: w / 2 + 0.3, sy: 0.12, sz: d / 2 + 0.3 }, C.navy);
  zFace(b, z + d / 2 + 0.31, x - w / 2 - 0.3, x + w / 2 + 0.3, h + 0.2, h + 0.3, C.wood, 1);
}

/**
 * A track: sleepers and two rails along a curve, laid as railway.js lays
 * them, with sleeper spacing and chord length following detail.
 */
function track(b, points, detail, gauge = 2.4) {
  const vecs = points.map(([x, y, z]) => new Vector3(x, y, z));
  const curve = vecs.length === 2 ? new LineCurve3(vecs[0], vecs[1]) : new CatmullRomCurve3(vecs);
  const length = curve.getLength();
  const frame = (t) => {
    const tangent = curve.getTangentAt(t);
    return { p: curve.getPointAt(t), tangent, side: new Vector3().crossVectors(tangent, UP).normalize() };
  };
  const offset = (f, across, height, along = 0) => [f.p.x + f.side.x * across + f.tangent.x * along, f.p.y + height, f.p.z + f.side.z * across + f.tangent.z * along];

  const spacing = [1.6, 1.1, 0.85, 0.75][detail];
  const count = Math.floor(length / spacing);
  const w = gauge / 2 + 0.5;
  const l = 0.15;
  for (let i = 0; i < count; i += 1) {
    const f = frame((i + 0.5) / count);
    const top = C.sleeper.clone().multiplyScalar(0.92 + ((i * 7) % 5) * 0.03);
    b.quad(offset(f, -w, 0.12, -l), offset(f, w, 0.12, -l), offset(f, w, 0.12, l), offset(f, -w, 0.12, l), top);
    if (detail < 1) continue;
    b.quad(offset(f, -w, 0, -l), offset(f, w, 0, -l), offset(f, w, 0.12, -l), offset(f, -w, 0.12, -l), C.sleeperDark);
    b.quad(offset(f, w, 0, l), offset(f, -w, 0, l), offset(f, -w, 0.12, l), offset(f, w, 0.12, l), C.sleeperDark);
    if (detail >= 3) {
      b.quad(offset(f, w, 0, -l), offset(f, w, 0, l), offset(f, w, 0.12, l), offset(f, w, 0.12, -l), C.sleeperDark);
      b.quad(offset(f, -w, 0, l), offset(f, -w, 0, -l), offset(f, -w, 0.12, -l), offset(f, -w, 0.12, l), C.sleeperDark);
    }
  }

  const chords = vecs.length === 2 ? 1 : Math.max(2, Math.ceil(length / (detail >= 2 ? 2.5 : 5)));
  const frames = Array.from({ length: chords + 1 }, (_, i) => frame(i / chords));
  const r = 0.08;
  for (let i = 0; i < chords; i += 1) {
    for (const a of [-gauge / 2, gauge / 2]) {
      for (const [a0, h0, a1, h1, colour] of [
        [a - r, 0.34, a + r, 0.34, C.railTop],
        [a + r, 0.34, a + r, 0.12, C.rail],
        [a - r, 0.12, a - r, 0.34, C.rail],
      ]) {
        b.quad(offset(frames[i], a0, h0), offset(frames[i], a1, h1), offset(frames[i + 1], a1, h1), offset(frames[i + 1], a0, h0), colour);
      }
    }
  }
}

/** The pale paving: slabs over grout, one quad at the lowest detail. */
function paving(b, { x0, x1, z0, z1, detail }) {
  b.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], detail < 1 ? C.paving : C.grout);
  if (detail < 1) return;
  const size = [0, 6, 4, 3][detail];
  const g = 0.05;
  for (let x = x0, i = 0; x < x1 - 0.01; x += size, i += 1) {
    for (let z = z0, j = 0; z < z1 - 0.01; z += size, j += 1) {
      const colour = (i * 3 + j * 5) % 4 === 0 ? C.pavingAlt : C.paving;
      const xa = x + g;
      const xb = Math.min(x + size, x1) - g;
      const za = z + g;
      const zb = Math.min(z + size, z1) - g;
      b.quad([xa, 0.004, zb], [xb, 0.004, zb], [xb, 0.004, za], [xa, 0.004, za], colour);
    }
  }
}

/** The timber two-storey house at the exit, its lit windows facing the tracks (-x). */
function house(b, lit, { x0, x1, z0, z1, detail }) {
  const h = 6.2;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  box(b, at0, { cx, cy: h / 2, cz, sx: (x1 - x0) / 2, sy: h / 2, sz: (z1 - z0) / 2 }, C.timber);
  gableRoof(b, { x0, x1, z0, z1, h, rise: 1.6, o: 0.5, wall: C.timber, detail });
  // A navy band between the storeys, and corner posts.
  xFace(b, x0 - 0.03, z0, z1, 3.0, 3.2, C.navy, -1);
  if (detail >= 1) {
    for (const z of [z0, z1]) box(b, at0, { cx: x0, cy: h / 2, cz: z, sx: 0.1, sy: h / 2, sz: 0.1 }, C.wood);
  }
  const cols = 3;
  const span = (z1 - z0) / cols;
  for (const fy of [0.9, 4.0]) {
    for (let i = 0; i < cols; i += 1) {
      const zc = z0 + span * (i + 0.5);
      if (fy < 1 && i === 1) continue;
      xFace(lit, x0 - 0.04, zc - 0.55, zc + 0.55, fy, fy + 1.5, C.window, -1, LIT);
      if (detail >= 2) {
        xFace(b, x0 - 0.06, zc - 0.04, zc + 0.04, fy, fy + 1.5, C.timber, -1);
        xFace(b, x0 - 0.06, zc - 0.55, zc + 0.55, fy + 0.72, fy + 0.8, C.timber, -1);
        box(b, at0, { cx: x0 - 0.1, cy: fy - 0.05, cz: zc, sx: 0.1, sy: 0.05, sz: 0.65 }, C.wood);
      }
    }
  }
  // The door where the middle ground-floor window would be.
  const zc = z0 + span * 1.5;
  xFace(b, x0 - 0.04, zc - 0.6, zc + 0.6, 0, 2.4, C.navyDark, -1);
  if (detail >= 2) box(b, at0, { cx: x0 - 0.1, cy: 2.5, cz: zc, sx: 0.1, sy: 0.1, sz: 0.8 }, C.brass.clone().multiplyScalar(0.7));
}

/** A stack of crates: sizes and offsets are fixed, so every build looks the same. */
function crates(b, { x, z, detail }) {
  const stack = [
    [0, 0.35, 0, 0.35],
    [0.8, 0.3, 0.1, 0.3],
    [0.1, 0.95, 0.05, 0.25],
    [0.2, 0.25, 0.85, 0.25],
  ];
  for (const [dx, cy, dz, s] of detail >= 2 ? stack : stack.slice(0, 2)) {
    box(b, at0, { cx: x + dx, cy, cz: z + dz, sx: s, sy: s, sz: s }, C.crate.clone().multiplyScalar(0.9 + ((dx * 10) % 3) * 0.05));
  }
}

/** The film's brass box lamp on the beam: a brass body with glowing glass on its sides and underside. */
function beamLamp(b, lit, [x, y, z]) {
  box(b, at0, { cx: x, cy: y + 0.12, cz: z, sx: 0.32, sy: 0.12, sz: 0.24 }, C.brass);
  const g = LIT;
  const y0 = y - 0.22;
  lit.quad([x - 0.26, y0, z - 0.2], [x + 0.26, y0, z - 0.2], [x + 0.26, y0, z + 0.2], [x - 0.26, y0, z + 0.2], C.white, g);
  xFace(lit, x + 0.26, z - 0.2, z + 0.2, y0, y, C.window, 1, g);
  xFace(lit, x - 0.26, z - 0.2, z + 0.2, y0, y, C.window, -1, g);
  zFace(lit, z + 0.2, x - 0.26, x + 0.26, y0, y, C.window, 1, g);
  zFace(lit, z - 0.2, x - 0.26, x + 0.26, y0, y, C.window, -1, g);
  b.lights.push([x, 0, z]);
}

/**
 * The workshop.
 *
 * @param {{ detail?: number, name?: string }} options - detail 0 (low) ... 3 (ultra)
 * @returns {{
 *   group: Group,
 *   bay: { x: number, y: number, z: number, facing: number },
 *   hook: Object3D,
 *   exitCurvePoints: number[][],
 *   lights: number[][],
 *   update: (dt: number) => void,
 * }}
 *   - bay: where the tram's origin (rail top, centre of the carriage) goes;
 *     `facing` is the tram group's rotation.y (0: forward is local +z).
 *   - hook: rests under the gantry trolley straight above the bay; move its
 *     position and the rope follows on the next update().
 *   - exitCurvePoints: from the bay out through the yard, in railway.js's
 *     convention (track centre line; the tram rides at y + 0.3).
 */
export function createWorkshop({ detail = 2, name = 'Pingo Cloudworks', yard = { x0: -43, x1: 23, z0: -42, z1: 63 } } = {}) {
  const d = Math.max(0, Math.min(3, Math.round(detail)));
  const b = createBuilder();
  const lit = createBuilder();

  paving(b, { ...yard, detail: d });

  // Tracks are drawn inside the yard: a smaller yard (a smaller island) keeps
  // the rails on the paving instead of running them off the edge.
  const held = ([x, y, z]) => [Math.min(yard.x1, Math.max(yard.x0, x)), y, Math.min(yard.z1, Math.max(yard.z0, z))];
  const rails = (points) => {
    const kept = points.map(held).filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[2] - all[i - 1][2]) > 1);
    if (kept.length >= 2) track(b, kept, d);
  };

  // Tracks: the bay line, one either side, and the yard beyond the switch.
  const exitCurvePoints = [
    [0, 0, 0],
    [0, 0, 18],
    [-2, 0, 30],
    [-9, 0, 42],
    [-22, 0, 50],
    [-40, 0, 53],
  ];
  rails([[0, 0, -38], [0, 0, 18]]);
  rails(exitCurvePoints.slice(1));
  rails([[0, 0, 18], [0, 0, 62]]);
  rails([[6.5, 0, -38], [6.5, 0, 14]]);
  if (d >= 1) {
    rails([[-6.4, 0, -38], [-6.4, 0, 8]]);
    rails([[0, 0, 18], [-3, 0, 25], [-10, 0, 31], [-24, 0, 36]]);
  }
  if (d >= 2) rails([[6.5, 0, 14], [7, 0, 24], [4, 0, 40], [2, 0, 62]]);

  // The workshop sheds behind the bay, and a second one across the yard.
  shed(b, lit, { x0: -17, x1: -9.2, z0: -40, z1: 14, h: 6.6, rise: 2, face: 1, slits: true, detail: d });
  shed(b, lit, { x0: 11.5, x1: 20, z0: -40, z1: -16, h: 7.2, rise: 2, face: -1, slits: true, door: d >= 1, detail: d });

  // Small sheds and open shelters on the camera side.
  shed(b, lit, { x0: 10.5, x1: 15, z0: -11, z1: -4.5, h: 3.4, rise: 1.3, face: -1, detail: Math.min(d, 2) });
  shed(b, lit, { x0: 10.5, x1: 15, z0: -1.5, z1: 5, h: 3.2, rise: 1.3, face: -1, detail: Math.min(d, 2) });
  shelter(b, { x: 12.5, z: 10, w: 4.2, d: 4.5 });
  if (d >= 1) {
    shed(b, lit, { x0: -21, x1: -17.5, z0: 20, z1: 26, h: 3.2, rise: 1.2, face: 1, detail: Math.min(d, 2) });
    shelter(b, { x: -13.5, z: 22, w: 4, d: 5 });
  }

  house(b, lit, { x0: 10.5, x1: 17, z0: 22, z1: 31, detail: d });

  // The gantry crane: posts either side of the bay, cross beams over it at the
  // hook and at the sign, runners joining them, knee braces into the beams.
  const beamY = 7.8;
  const postX = 3.9;
  for (const gz of [0, -9]) {
    for (const px of [-postX, postX]) {
      box(b, at0, { cx: px, cy: beamY / 2, cz: gz, sx: 0.22, sy: beamY / 2, sz: 0.22 }, C.wood);
      box(b, at0, { cx: px, cy: 0.12, cz: gz, sx: 0.4, sy: 0.12, sz: 0.4 }, C.navyDark);
      if (d >= 1) strut(b, new Vector3(px, beamY - 1.8, gz), new Vector3(px - Math.sign(px) * 1.6, beamY - 0.2, gz), 0.1, C.woodDark);
    }
    box(b, at0, { cx: 0, cy: beamY + 0.2, cz: gz, sx: postX + 0.7, sy: 0.24, sz: 0.24 }, C.wood);
  }
  for (const px of [-postX, postX]) box(b, at0, { cx: px, cy: beamY + 0.55, cz: -4.5, sx: 0.18, sy: 0.14, sz: 4.7 }, C.woodDark);

  // The trolley on the hook beam.
  box(b, at0, { cx: 0, cy: beamY - 0.15, cz: 0, sx: 0.35, sy: 0.16, sz: 0.4 }, C.iron);

  // The sign, hung by two rods from the far runner, facing the camera side.
  const signX = -postX;
  const signY = 5.5;
  const half = 3.6;
  const signZ = -4.5;
  box(b, at0, { cx: signX, cy: signY, cz: signZ, sx: 0.07, sy: 0.62, sz: half }, C.navyDark);
  xFace(lit, signX + 0.075, signZ - half + 0.04, signZ + half - 0.04, signY - 0.58, signY + 0.58, C.white, 1, [
    [0, SIGN_V0],
    [1, SIGN_V0],
    [1, 1],
    [0, 1],
  ]);
  if (d >= 2) {
    xFace(lit, signX - 0.075, signZ - half + 0.04, signZ + half - 0.04, signY - 0.58, signY + 0.58, C.white, -1, [
      [0, SIGN_V0],
      [1, SIGN_V0],
      [1, 1],
      [0, 1],
    ]);
  }
  for (const rz of [signZ - half + 0.6, signZ + half - 0.6]) {
    strut(b, new Vector3(signX, signY + 0.6, rz), new Vector3(signX, beamY + 0.42, rz), 0.03, C.iron);
  }

  // Lamps on the beams; small props.
  beamLamp(b, lit, [-1.8, beamY - 0.25, 0.4]);
  if (d >= 1) beamLamp(b, lit, [1.8, beamY - 0.25, -9.4]);
  crates(b, { x: 9.2, z: 8, detail: d });
  if (d >= 1) {
    crates(b, { x: -8, z: -18, detail: d });
    bench(b, { x: 9.3, z: -14.5, turn: Math.PI / 2 });
  }
  if (d >= 2) crates(b, { x: 10.2, z: 16.5, detail: d });

  const glow = signTexture(name);
  const solidMaterial = new MeshLambertMaterial({ vertexColors: true });
  const litMaterial = new MeshBasicMaterial({ vertexColors: true, map: glow });

  const group = new Group();
  group.name = 'workshop';
  const solid = b.build();
  solid.computeBoundingSphere();
  const lits = lit.build();
  lits.computeBoundingSphere();
  group.add(new Mesh(solid, solidMaterial), new Mesh(lits, litMaterial));

  // The hook: a pulley block, a shank and a curled hook; its origin is where
  // the rope ties on.
  const hb = createBuilder();
  box(hb, at0, { cx: 0, cy: -0.25, cz: 0, sx: 0.2, sy: 0.25, sz: 0.12 }, C.brass);
  box(hb, at0, { cx: 0, cy: -0.72, cz: 0, sx: 0.05, sy: 0.22, sz: 0.05 }, C.iron);
  strut(hb, new Vector3(0, -0.94, 0), new Vector3(0.22, -1.12, 0), 0.05, C.iron);
  strut(hb, new Vector3(0.22, -1.12, 0), new Vector3(0.3, -0.9, 0), 0.05, C.iron);
  const hookGeometry = hb.build();
  hookGeometry.computeBoundingSphere();
  const hook = new Object3D();
  hook.name = 'workshop-hook';
  hook.add(new Mesh(hookGeometry, solidMaterial));
  hook.position.set(0, 6.3, 0);

  // The rope: a unit-long cord hanging from its origin, stretched each update.
  const rb = createBuilder();
  box(rb, at0, { cx: 0, cy: -0.5, cz: 0, sx: 0.03, sy: 0.5, sz: 0.03 }, C.iron);
  const ropeGeometry = rb.build();
  ropeGeometry.computeBoundingSphere();
  const rope = new Mesh(ropeGeometry, solidMaterial);
  const ropeTop = beamY - 0.31;
  group.add(hook, rope);

  function update() {
    rope.position.set(hook.position.x, ropeTop, hook.position.z);
    rope.scale.y = Math.max(0.01, ropeTop - hook.position.y);
  }
  update();

  return {
    group,
    bay: { x: 0, y: 0.3, z: 0, facing: 0 },
    hook,
    exitCurvePoints,
    lights: b.lights,
    update,
  };
}
