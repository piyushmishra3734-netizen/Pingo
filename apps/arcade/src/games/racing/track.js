/**
 * A circuit, from a string: the Kenney Racing Kit's road tiles laid like a
 * turtle walks. `B` is the two-tile start grid, `S` a straight tile, `R` and
 * `L` the kit's large corner (a 2x2 block) turned right or left.
 *
 * From the layout come both what is drawn (each tile's position and turn)
 * and what is driven: the centre line, sampled every metre, which the race
 * uses for laps, positions, off-road and walls.
 *
 * Heading `yaw` is three.js's rotation.y: yaw 0 drives towards -z.
 */

/** One tile, in metres. The road fills the tile's width. */
export const TILE = 12;
export const HALF_ROAD = TILE / 2;

export const TRACKS = [
  {
    name: 'Pingo Park',
    nick: 'Easy · wide and friendly',
    layout: 'BSSSRRSSSLRSSRRLR',
    laps: 3,
    pads: [0.18, 0.62],
    pace: 0.9,
    medals: [34, 37, 41],
  },
  {
    name: 'Neon Loop',
    nick: 'Medium · tight corners',
    layout: 'BRRLSRLRRSSSRLSRS',
    laps: 3,
    pads: [0.12, 0.45, 0.8],
    pace: 1.0,
    medals: [37, 40, 45],
  },
  {
    name: 'Sultan Speedway',
    nick: 'Hard · the long one',
    layout: 'BSSSRSLSRSSRSLRSSRLSRLRRSLR',
    laps: 3,
    pads: [0.1, 0.4, 0.7],
    pace: 1.06,
    medals: [58, 63, 70],
  },
];

const heading = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
const axisX = (theta) => [Math.cos(theta), -Math.sin(theta)];
const axisZ = (theta) => [Math.sin(theta), Math.cos(theta)];

/**
 * @param {string} layout
 * @returns {{ pieces: Array<{ part: string, x: number, z: number, yaw: number }>, points: Array<{ x: number, z: number, yaw: number }>, cells: Set<string>, closed: boolean, overlaps: boolean }}
 */
export function buildTrack(layout) {
  let px = 0;
  let pz = 0;
  let yaw = 0;
  const pieces = [];
  const raw = [];
  const cells = new Set();
  let overlaps = false;

  const occupy = (ox, oz, theta, width, depth) => {
    const [xx, xz] = axisX(theta);
    const [zx, zz] = axisZ(theta);
    for (let i = 0; i < width; i += 1) {
      for (let j = 0; j < depth; j += 1) {
        const lx = i + 0.5;
        const lz = -(j + 0.5);
        const cx = ox / TILE + lx * xx + lz * zx;
        const cz = oz / TILE + lx * xz + lz * zz;
        const key = `${Math.floor(cx)},${Math.floor(cz)}`;
        if (cells.has(key)) overlaps = true;
        cells.add(key);
      }
    }
  };

  for (const kind of layout) {
    const [hx, hz] = heading(yaw);
    if (kind === 'S' || kind === 'B') {
      const length = kind === 'B' ? 2 : 1;
      const [xx, xz] = axisX(yaw);
      const ox = px - 0.5 * TILE * xx;
      const oz = pz - 0.5 * TILE * xz;
      pieces.push({ part: kind === 'B' ? 'roadStartPositions' : 'roadStraight', x: ox, z: oz, yaw });
      occupy(ox, oz, yaw, 1, length);
      for (let s = 0; s < length * TILE; s += 1) raw.push([px + hx * s, pz + hz * s]);
      px += hx * length * TILE;
      pz += hz * length * TILE;
    } else {
      const right = kind === 'R';
      const theta = right ? yaw : yaw - Math.PI / 2;
      const [xx, xz] = axisX(theta);
      const [zx, zz] = axisZ(theta);
      // Where the tile's origin goes so that the road's entry meets the turtle.
      const [ex, ez] = right ? [0.5, 0] : [2, -1.5];
      const ox = px - TILE * (ex * xx + ez * zx);
      const oz = pz - TILE * (ex * xz + ez * zz);
      pieces.push({ part: 'roadCornerLarge', x: ox, z: oz, yaw: theta });
      occupy(ox, oz, theta, 2, 2);
      const cx = ox + 2 * TILE * xx;
      const cz = oz + 2 * TILE * xz;
      const radius = 1.5 * TILE;
      const steps = Math.round((radius * Math.PI) / 2);
      for (let k = 0; k < steps; k += 1) {
        const a = (k / steps) * (Math.PI / 2);
        const [u, v] = right ? [Math.cos(a), Math.sin(a)] : [Math.sin(a), Math.cos(a)];
        raw.push([cx - radius * (u * xx + v * zx), cz - radius * (u * xz + v * zz)]);
      }
      const [nx, nz] = right ? [2, -1.5] : [0.5, 0];
      px = ox + TILE * (nx * xx + nz * zx);
      pz = oz + TILE * (nx * xz + nz * zz);
      yaw += right ? -Math.PI / 2 : Math.PI / 2;
    }
  }

  const points = raw.map(([x, z], i) => {
    const [nx, nz] = raw[(i + 1) % raw.length];
    return { x, z, yaw: Math.atan2(-(nx - x), -(nz - z)) };
  });
  const closed = Math.hypot(px, pz) < 0.01 && Math.abs(Math.sin(yaw)) < 1e-6 && Math.cos(yaw) > 0;
  return { pieces, points, cells, closed, overlaps };
}
