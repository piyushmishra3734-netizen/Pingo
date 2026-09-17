import { Color, Mesh, Vector3 } from 'three';

import { box, createBuilder } from './builder.js';
import { bench, lamp } from './town.js';

/**
 * The line and its stations: the elevated track (sleepers, rails, girder)
 * along the loop curve, and platforms with canopies where it crosses towns.
 */

/**
 * The elevated line: a smooth closed curve through the islands, two rails and
 * wooden sleepers, and a slim post down to the island or rock beneath where
 * one is close enough to stand on.
 */
function railway(b, { curve, gauge = 2.4, sleeperEvery = 2.2, railEvery = 4.5 }) {
  const length = curve.getLength();
  const wood = new Color('#7a5a40');
  const woodDark = new Color('#5e4431');
  const steel = new Color('#4a4f58');
  const up = new Vector3(0, 1, 0);
  const sample = (every) => {
    const count = Math.ceil(length / every);
    return Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count;
      const tangent = curve.getTangentAt(t);
      return { p: curve.getPointAt(t), tangent, side: new Vector3().crossVectors(tangent, up).normalize() };
    });
  };
  // Sleepers close together, the long parts (rails, girder) in coarser steps:
  // on a smooth curve 4.5 m chords cannot be told from a true curve.
  const sleepers = sample(sleeperEvery);
  const frames = sample(railEvery);
  const v = (vec) => [vec.x, vec.y, vec.z];
  const offset = (f, across, height, along = 0) =>
    v(f.p.clone().addScaledVector(f.side, across).addScaledVector(up, height).addScaledVector(f.tangent, along));

  // Sleepers: a flat plank with a front and back edge.
  // The top and the side that faces along the line are all that ever shows.
  for (const f of sleepers.slice(0, -1)) {
    const w = gauge / 2 + 0.75;
    const l = 0.34;
    const a = offset(f, -w, 0.12, -l);
    const bq = offset(f, w, 0.12, -l);
    const c = offset(f, w, 0.12, l);
    const d = offset(f, -w, 0.12, l);
    b.quad(a, bq, c, d, wood);
    b.quad(offset(f, w, 0, -l), offset(f, -w, 0, -l), a, bq, woodDark);
  }
  // Rails: continuous ribbons with a top and two sides.
  for (const across of [-gauge / 2, gauge / 2]) {
    for (let i = 0; i < frames.length - 1; i += 1) {
      const f0 = frames[i];
      const f1 = frames[i + 1];
      const r = 0.1;
      b.quad(offset(f0, across - r, 0.34), offset(f0, across + r, 0.34), offset(f1, across + r, 0.34), offset(f1, across - r, 0.34), steel);
      b.quad(offset(f0, across + r, 0.12), offset(f1, across + r, 0.12), offset(f1, across + r, 0.34), offset(f0, across + r, 0.34), steel);
      b.quad(offset(f1, across - r, 0.12), offset(f0, across - r, 0.12), offset(f0, across - r, 0.34), offset(f1, across - r, 0.34), steel);
    }
  }
  // Under-girder: one dark beam beneath the centre line, so the track reads as a bridge.
  for (let i = 0; i < frames.length - 1; i += 1) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    const g = 0.6;
    b.quad(offset(f1, -g, -0.9), offset(f1, g, -0.9), offset(f0, g, -0.9), offset(f0, -g, -0.9), woodDark);
    b.quad(offset(f0, g, -0.9), offset(f1, g, -0.9), offset(f1, g, 0), offset(f0, g, 0), woodDark);
    b.quad(offset(f1, -g, -0.9), offset(f0, -g, -0.9), offset(f0, -g, 0), offset(f1, -g, 0), woodDark);
  }
  return curve;
}

/**
 * A station: a raised platform beside the line, a canopy on slim posts along
 * it, benches under the canopy and lamps at the ends.
 *
 * @param {{ curve: import('three').Curve<Vector3>, from: number, to: number, side?: 1 | -1 }} spec
 *   from/to: where along the line (0-1) the platform runs; side: which side of the track
 */
function station(b, { curve, from, to, side = 1 }) {
  const up = new Vector3(0, 1, 0);
  const steps = Math.max(4, Math.round((to - from) * curve.getLength() / 3));
  const stone = new Color('#e7dfcf');
  const edge = new Color('#c9bda6');
  const post = new Color('#2f5446');
  // Red and cream stripes, as the film's platform awning.
  const stripes = [new Color('#b8453a'), new Color('#ece6da')];
  const frame = (t) => {
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const across = new Vector3().crossVectors(tangent, up).normalize().multiplyScalar(side);
    return { p, across };
  };
  const at = (f, out, height) => [f.p.x + f.across.x * out, f.p.y + height, f.p.z + f.across.z * out];
  for (let i = 0; i < steps; i += 1) {
    const f0 = frame(from + ((to - from) * i) / steps);
    const f1 = frame(from + ((to - from) * (i + 1)) / steps);
    // Platform top (from 2.1 m to 5.6 m off the centre line), and its face to the track.
    const flip = side < 0;
    const q = (a, bq, c, d, colour) => (flip ? b.quad(d, c, bq, a, colour) : b.quad(a, bq, c, d, colour));
    q(at(f0, 2.1, 0.75), at(f0, 5.6, 0.75), at(f1, 5.6, 0.75), at(f1, 2.1, 0.75), stone);
    q(at(f1, 2.1, -0.3), at(f1, 2.1, 0.75), at(f0, 2.1, 0.75), at(f0, 2.1, -0.3), edge);
    // Canopy: a sloped roof over the back half of the platform, both faces.
    const canopy = stripes[i % 2];
    q(at(f0, 2.4, 3.9), at(f0, 5.8, 4.4), at(f1, 5.8, 4.4), at(f1, 2.4, 3.9), canopy);
    q(at(f1, 2.4, 3.9), at(f1, 5.8, 4.4), at(f0, 5.8, 4.4), at(f0, 2.4, 3.9), canopy.clone().multiplyScalar(0.7));
    if (i % 3 === 1) b.lights.push(at(f0, 4.2, 0.75));
    if (i % 2 === 0) {
      const [px, py, pz] = at(f0, 4.9, 0.75);
      const at2 = (dx, dy, dz) => [px + dx, py + dy, pz + dz];
      box(b, at2, { cx: 0, cy: 1.8, cz: 0, sx: 0.06, sy: 1.8, sz: 0.06 }, post);
    }
    if (i % 4 === 1) {
      const [px, py, pz] = at(f0, 4.6, 0.75);
      bench(b, { x: px, y: py, z: pz, turn: Math.atan2(f0.across.x, f0.across.z) + Math.PI });
    }
  }
  const [lx, ly, lz] = at(frame(from), 3.2, 0.75);
  lamp(b, { x: lx, y: ly, z: lz });
  const [mx, my, mz] = at(frame(to), 3.2, 0.75);
  lamp(b, { x: mx, y: my, z: mz });
}

/** The track round the whole loop, as one mesh. */
export function createRailway(curve, material, quality = { sleeperEvery: 2.2 }) {
  const b = createBuilder();
  railway(b, { curve, sleeperEvery: quality.sleeperEvery });
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
