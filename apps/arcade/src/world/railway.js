import { Color, Mesh, Vector3 } from 'three';

import { GLASS, box, createBuilder } from './builder.js';
import { bench } from './town.js';

/**
 * The line and its stations, after the film: an open ladder of wooden
 * sleepers and two dark rails carried on steel side girders, standing on
 * slim trestles over the rock spikes, with lanterns hanging under the high
 * arcs; and long white platforms with a green railing, hedge planters, a red
 * and cream canopy, benches and black lamp posts.
 *
 * The track's centre line is the curve; sleeper tops are 0.12 m above it and
 * rail tops 0.34 m (the tram rides at curve y + 0.3).
 */

const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

/** Lanterns hang wherever the line is higher than this - the arcs into the sky. */
const HIGH = 22;

/** The line's frame at t: the point, the tangent, and the horizontal side vector (to the right). */
function frameAt(curve, t) {
  const tangent = curve.getTangentAt(t);
  return { p: curve.getPointAt(t), tangent, side: new Vector3().crossVectors(tangent, UP).normalize() };
}

/** A point `across` to the side, `height` up and `along` ahead of a frame. */
const offset = (f, across, height, along = 0) => [
  f.p.x + f.side.x * across + f.tangent.x * along,
  f.p.y + height + f.tangent.y * along,
  f.p.z + f.side.z * across + f.tangent.z * along,
];

/**
 * A frame as box()'s local space: x across, y up, z back along the line -
 * right-handed, so box faces point outward. Mirrored frames (a station on
 * the left) mirror z as well, which keeps it right-handed.
 */
const boxFrame = (f, mirror = 1) => (px, py, pz) => offset(f, px, py, -pz * mirror);

const toVec = ([x, y, z]) => new Vector3(x, y, z);

/** A square rod from p0 to p1 (four sides, no ends): trestle legs, braces, chains. */
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
 * A lantern: four glowing glass sides (window-glass UVs, lit at dusk) under a
 * dark pyramid cap; `bottom` closes it for lanterns seen from below.
 */
function lanternHead(b, [x, y, z], { r = 0.16, h = 0.42, bottom = false } = {}) {
  const glass = new Color('#ffffff');
  const cap = new Color('#1f2227');
  const g = GLASS;
  const corners = [
    [-r, r, r, r],
    [r, r, r, -r],
    [r, -r, -r, -r],
    [-r, -r, -r, r],
  ];
  const apex = [x, y + h + r * 1.3, z];
  for (const [ax, az, bx, bz] of corners) {
    b.quad([x + ax, y, z + az], [x + bx, y, z + bz], [x + bx, y + h, z + bz], [x + ax, y + h, z + az], glass, [g, g, g, g]);
    // The cap overhangs the glass a little.
    const o = 1.35;
    b.tri([x + ax * o, y + h, z + az * o], [x + bx * o, y + h, z + bz * o], apex, [g, g, g], cap);
  }
  if (bottom) b.quad([x - r, y, z - r], [x + r, y, z - r], [x + r, y, z + r], [x - r, y, z + r], cap);
}

/**
 * Faces swept between consecutive frames. Each edge [a0, h0, a1, h1, colour]
 * runs clockwise round the cross-section (seen looking along the line, the
 * side vector to the right), so its face points outward.
 */
function sweep(b, frames, edges) {
  for (let i = 0; i < frames.length - 1; i += 1) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    for (const [a0, h0, a1, h1, colour] of edges) b.quad(offset(f0, a0, h0), offset(f0, a1, h1), offset(f1, a1, h1), offset(f1, a0, h0), colour);
  }
}

/**
 * The elevated line. Detail follows the graphics quality: sleeper spacing
 * (closer on high and ultra, as the film's), how finely rails and girders
 * follow the curve, their profile (flat bars, or I-sections with flanges),
 * cross-beams, trestle bracing and lantern spacing.
 */
function railway(b, { curve, gauge = 2.4, sleeperEvery = 2.2, detail = 1, props = 1 }) {
  const length = curve.getLength();
  const fine = detail >= 2;
  const ultra = detail >= 4;
  const wood = new Color('#7a5a40');
  const woodDark = new Color('#553e2c');
  const steel = new Color('#3a3e46');
  const railTop = new Color('#6a6f78');
  const girder = new Color('#2b2e34');
  const girderLit = new Color('#373b42');
  const sample = (every) => {
    const count = Math.ceil(length / every);
    return Array.from({ length: count + 1 }, (_, i) => frameAt(curve, i / count));
  };

  // Sleepers: planks overhanging the rails, with sky showing between them.
  // The film's are close together; on high and ultra they close up to match.
  const spacing = fine ? sleeperEvery / 1.6 : sleeperEvery;
  const sleepers = sample(spacing).slice(0, -1);
  const w = gauge / 2 + 0.55;
  const l = Math.max(0.17, spacing * 0.15);
  for (const [i, f] of sleepers.entries()) {
    // A little variation plank to plank, as weathered wood.
    const top = wood.clone().multiplyScalar(0.92 + ((i * 7) % 5) * 0.03);
    b.quad(offset(f, -w, 0.12, -l), offset(f, w, 0.12, -l), offset(f, w, 0.12, l), offset(f, -w, 0.12, l), top);
    // The face that looks back down the line (what the tram's camera sees ahead).
    b.quad(offset(f, -w, 0, -l), offset(f, w, 0, -l), offset(f, w, 0.12, -l), offset(f, -w, 0.12, -l), woodDark);
    if (detail >= 1) b.quad(offset(f, w, 0, l), offset(f, -w, 0, l), offset(f, -w, 0.12, l), offset(f, w, 0.12, l), woodDark);
    if (fine) {
      b.quad(offset(f, w, 0, -l), offset(f, w, 0, l), offset(f, w, 0.12, l), offset(f, w, 0.12, -l), woodDark);
      b.quad(offset(f, -w, 0, l), offset(f, -w, 0, -l), offset(f, -w, 0.12, -l), offset(f, -w, 0.12, l), woodDark);
    }
  }

  // Rails and girders follow the curve in chords; finer at higher quality.
  const frames = sample(ultra ? 2 : fine ? 3 : detail >= 1 ? 4.5 : 6);
  const edges = [];
  for (const a of [-gauge / 2, gauge / 2]) {
    if (ultra) {
      // Rail as an I: head, web, and the head's undersides.
      const r = 0.08;
      const web = 0.03;
      edges.push(
        [a - r, 0.34, a + r, 0.34, railTop],
        [a + r, 0.34, a + r, 0.27, steel],
        [a + r, 0.27, a + web, 0.27, steel],
        [a + web, 0.27, a + web, 0.12, steel],
        [a - web, 0.12, a - web, 0.27, steel],
        [a - web, 0.27, a - r, 0.27, steel],
        [a - r, 0.27, a - r, 0.34, steel],
      );
    } else {
      const r = 0.08;
      edges.push([a - r, 0.34, a + r, 0.34, railTop], [a + r, 0.34, a + r, 0.12, steel], [a - r, 0.12, a - r, 0.34, steel]);
    }
    // Side girders under each rail: the dark steel the film's track is carried on.
    const gw = 0.09;
    const deep = -0.8;
    const outer = Math.sign(a);
    if (fine) {
      // An I-girder: web, bottom flange (top faces, edges, underside).
      const fw = 0.22;
      const lip = deep + 0.1;
      edges.push(
        [a + gw, 0, a + gw, lip, outer > 0 ? girderLit : girder],
        [a + gw, lip, a + fw, lip, girder],
        [a + fw, lip, a + fw, deep, girder],
        [a + fw, deep, a - fw, deep, girder],
        [a - fw, deep, a - fw, lip, girder],
        [a - fw, lip, a - gw, lip, girder],
        [a - gw, lip, a - gw, 0, outer < 0 ? girderLit : girder],
      );
    } else {
      // Outer face and underside; the inner face only shows through the gaps.
      edges.push(outer > 0 ? [a + gw, 0, a + gw, deep, girderLit] : [a - gw, deep, a - gw, 0, girderLit], [a + gw, deep, a - gw, deep, girder]);
    }
  }
  sweep(b, frames, edges);

  // Cross-beams tying the girders together, seen through the sleeper gaps.
  if (fine) {
    for (let i = 0; i < frames.length - 1; i += 2) {
      box(b, boxFrame(frames[i]), { cx: 0, cy: -0.4, cz: 0, sx: gauge / 2, sy: 0.06, sz: 0.06 }, girder);
    }
  }

  // Trestles down to the rock spikes: world.js sets a spike every ~60 m at
  // these same positions. Legs splay out; a cap beam, and X-bracing on high.
  const spikes = Math.floor(length / 60);
  for (let i = 0; i < spikes; i += 1) {
    const f = frameAt(curve, (i + 0.5) / spikes);
    const at = (across, height) => toVec(offset(f, across, height));
    const foot = -6.5;
    const legTop = gauge / 2;
    const legFoot = gauge / 2 + 1;
    strut(b, at(-legTop, -0.8), at(-legFoot, foot), 0.08, girder);
    strut(b, at(legTop, -0.8), at(legFoot, foot), 0.08, girder);
    if (detail >= 1) strut(b, at(-legTop - 0.3, -0.85), at(legTop + 0.3, -0.85), 0.07, girder);
    if (fine) {
      const s = (h) => legTop + ((legFoot - legTop) * (-0.8 - h)) / (-0.8 - foot);
      strut(b, at(-s(-1.6), -1.6), at(s(-5), -5), 0.045, girder);
      strut(b, at(s(-1.6), -1.6), at(-s(-5), -5), 0.045, girder);
      strut(b, at(-s(-5), -5), at(s(-5), -5), 0.05, girder);
    }
  }

  // Lanterns hanging from the girders along the high arcs, on alternate sides.
  const lanternEvery = props >= 2 ? 9 : 14;
  const hangs = Math.ceil(length / lanternEvery);
  const iron = new Color('#1f2227');
  let flip = 1;
  for (let i = 0; i < hangs; i += 1) {
    const f = frameAt(curve, i / hangs);
    if (f.p.y < HIGH) continue;
    flip = -flip;
    const out = flip * (gauge / 2 + 0.55);
    if (detail >= 1) strut(b, toVec(offset(f, flip * (gauge / 2 + 0.09), -0.25)), toVec(offset(f, out, -0.25)), 0.03, iron);
    const hook = toVec(offset(f, out, -0.25));
    const head = hook.clone().add(new Vector3(0, -1.25, 0));
    strut(b, hook, head.clone().add(new Vector3(0, 0.62, 0)), 0.015, iron);
    lanternHead(b, [head.x, head.y, head.z], { r: 0.15, h: 0.4, bottom: true });
    // The warm pool lies on the sleepers above.
    b.lights.push(offset(f, 0, 0.13));
  }
  return curve;
}

/**
 * A black lamp post with a lit lantern head, as on the film's platforms: a
 * plinth, a slim post and a glass lantern under a pointed cap.
 */
function platformLamp(b, [x, y, z]) {
  const black = new Color('#22252b');
  const at = (px, py, pz) => [x + px, y + py, z + pz];
  box(b, at, { cx: 0, cy: 0.12, cz: 0, sx: 0.14, sy: 0.12, sz: 0.14 }, black);
  box(b, at, { cx: 0, cy: 1.8, cz: 0, sx: 0.05, sy: 1.6, sz: 0.05 }, black);
  lanternHead(b, [x, y + 3.4, z], { r: 0.18, h: 0.45 });
  b.lights.push([x, y, z]);
}

/**
 * A station: a long white stone platform beside the line with a green railing
 * and hedge planters along its outer edge, a flat cream canopy with red
 * panels on slim green posts, benches beneath it and black lamps by the
 * platform edge.
 *
 * @param {{ curve: import('three').Curve<Vector3>, from: number, to: number, side?: 1 | -1 }} spec
 *   from/to: where along the line (0-1) the platform runs; side: which side of the track
 */
function station(b, { curve, from, to, side = 1 }) {
  const steps = Math.max(4, Math.round(((to - from) * curve.getLength()) / 3));
  const stone = [new Color('#e9e2d4'), new Color('#e1d9c8')];
  const coping = new Color('#f4efe6');
  const face = new Color('#c4b9a4');
  const green = new Color('#2f5446');
  const planter = new Color('#d3c9b6');
  const hedge = new Color('#4d7a45');
  const hedgeTop = new Color('#5f8f52');
  const cream = new Color('#f1ece2');
  const creamUnder = new Color('#b9b2a6');
  const red = new Color('#b8453a');
  const frame = (i) => {
    const f = frameAt(curve, from + ((to - from) * i) / steps);
    f.side.multiplyScalar(side);
    return f;
  };
  // A mirrored side reverses the winding; this puts it back.
  const q = (a, bq, c, d, colour) => (side < 0 ? b.quad(d, c, bq, a, colour) : b.quad(a, bq, c, d, colour));
  const span = (f0, f1, list) => {
    for (const [a0, h0, a1, h1, colour] of list) q(offset(f0, a0, h0), offset(f0, a1, h1), offset(f1, a1, h1), offset(f1, a0, h0), colour);
  };

  const inner = 2.1;
  const outer = 6.4;
  const deck = 0.75;
  const roofIn = [2.9, 4.1];
  const roofOut = [5.6, 4.35];
  const roofAt = (out) => roofIn[1] + ((out - roofIn[0]) * (roofOut[1] - roofIn[1])) / (roofOut[0] - roofIn[0]);
  const frames = Array.from({ length: steps + 1 }, (_, i) => frame(i));

  for (let i = 0; i < steps; i += 1) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    // Platform: a light coping along the track edge, paving, and its two faces.
    span(f0, f1, [
      [inner, deck, inner + 0.4, deck, coping],
      [inner + 0.4, deck, outer, deck, stone[i % 2]],
      [outer, deck, outer, -0.7, face],
      [inner, -0.7, inner, deck, face],
    ]);
    // Green railing on the outer edge: top and middle rails, a post every step.
    span(f0, f1, [
      [6.17, 1.85, 6.23, 1.85, green],
      [6.23, 1.85, 6.23, 1.77, green],
      [6.17, 1.77, 6.17, 1.85, green],
      [6.23, 1.3, 6.23, 1.24, green],
      [6.17, 1.24, 6.17, 1.3, green],
    ]);
    box(b, boxFrame(f0, side), { cx: 6.2, cy: (deck + 1.85) / 2, cz: 0, sx: 0.04, sy: (1.85 - deck) / 2, sz: 0.04 }, green);
    // Hedge planters inside the railing, two steps on and one off.
    if (i % 3 !== 2) {
      span(f0, f1, [
        [5.35, deck, 5.35, 1.15, planter],
        [5.4, 1.15, 5.4, 1.5, hedge],
        [5.4, 1.5, 6.0, 1.5, hedgeTop],
        [6.0, 1.5, 6.0, 1.15, hedge],
      ]);
      const cap = (f, dir) => {
        const quad = [offset(f, 5.35, deck), offset(f, 6.0, deck), offset(f, 6.0, 1.5), offset(f, 5.35, 1.5)];
        if (dir > 0) q(...quad, hedge);
        else q(quad[3], quad[2], quad[1], quad[0], hedge);
      };
      if (i % 3 === 0) cap(f0, 1);
      if (i % 3 === 1 || i === steps - 1) cap(f1, -1);
    }
    // Canopy: cream roof, both faces, a fascia along each edge, and a red panel per step.
    span(f0, f1, [
      [roofIn[0], roofIn[1], roofOut[0], roofOut[1], cream],
      [roofOut[0], roofOut[1], roofOut[0], roofOut[1] - 0.2, cream],
      [roofOut[0], roofOut[1] - 0.2, roofIn[0], roofIn[1] - 0.2, creamUnder],
      [roofIn[0], roofIn[1] - 0.2, roofIn[0], roofIn[1], cream],
    ]);
    const t0 = from + ((to - from) * (i + 0.14)) / steps;
    const t1 = from + ((to - from) * (i + 0.86)) / steps;
    const p0 = frameAt(curve, t0);
    const p1 = frameAt(curve, t1);
    p0.side.multiplyScalar(side);
    p1.side.multiplyScalar(side);
    const lift = 0.03;
    q(
      offset(p0, roofIn[0] + 0.25, roofAt(roofIn[0] + 0.25) + lift),
      offset(p0, roofOut[0] - 0.25, roofAt(roofOut[0] - 0.25) + lift),
      offset(p1, roofOut[0] - 0.25, roofAt(roofOut[0] - 0.25) + lift),
      offset(p1, roofIn[0] + 0.25, roofAt(roofIn[0] + 0.25) + lift),
      red,
    );
    // Slim posts, front and back, every other step.
    if (i % 2 === 0) {
      for (const out of [roofIn[0] + 0.3, roofOut[0] - 0.3]) {
        const topH = roofAt(out) - 0.2;
        box(b, boxFrame(f0, side), { cx: out, cy: (deck + topH) / 2, cz: 0, sx: 0.06, sy: (topH - deck) / 2, sz: 0.06 }, green);
      }
    }
    // Benches under the canopy, facing the track.
    if (i % 4 === 1) {
      const [px, py, pz] = offset(f0, 4.4, deck, (f0.p.distanceTo(f1.p)) / 2);
      bench(b, { x: px, y: py, z: pz, turn: Math.atan2(f0.side.x, -f0.side.z) });
    }
    // Lamps along the platform edge.
    if (i % 3 === 0) platformLamp(b, offset(f0, inner + 0.35, deck, f0.p.distanceTo(f1.p) / 2));
  }
  // Closing faces at both ends of the platform.
  const endFace = (f, dir) => {
    const quad = [offset(f, inner, -0.7), offset(f, outer, -0.7), offset(f, outer, deck), offset(f, inner, deck)];
    if (dir > 0) q(...quad, face);
    else q(quad[3], quad[2], quad[1], quad[0], face);
  };
  endFace(frames[0], 1);
  endFace(frames[steps], -1);
  platformLamp(b, offset(frames[steps], inner + 0.35, deck));
}

/** The track round the whole loop, as one mesh. */
export function createRailway(curve, material, quality = { sleeperEvery: 2.2, detail: 1, props: 1 }) {
  const b = createBuilder();
  railway(b, { curve, sleeperEvery: quality.sleeperEvery, detail: quality.detail ?? 1, props: quality.props ?? 1 });
  const geometry = b.build();
  geometry.computeBoundingSphere();
  return new Mesh(geometry, material);
}

/** Stations along the line, as one mesh. */
export function createStations(specs, material) {
  const b = createBuilder();
  for (const spec of specs) station(b, spec);
  const geometry = b.build();
  geometry.computeBoundingSphere();
  return new Mesh(geometry, material);
}
