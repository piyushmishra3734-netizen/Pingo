import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry } from 'three';

/**
 * The shared kit every procedural world piece is built with: a triangle
 * builder (position, normal, uv, colour per vertex, plus light points), a box,
 * smooth leaf blobs, and the two UV spots on the shared window tile - plain
 * plaster for flat colours, window glass for things that glow at night.
 */

/** A plain plaster spot in the tile, for everything that is not a wall. */
export const PLAIN = [0.08, 0.2];

/** A spot on the window glass: things that glow at night (lamps, the lighthouse). */
export const GLASS = [0.42, 0.62];

/** A growing pile of triangles, each with position, normal, uv and colour. */
export function createBuilder() {
  const position = [];
  const normal = [];
  const uv = [];
  const color = [];
  /** Where lamps and lanterns are, for the light pools drawn beneath them. */
  const lights = [];
  const scratch = new Color();

  function tri(a, b, c, uvs, colour) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const [p, t] of [
      [a, uvs[0]],
      [b, uvs[1]],
      [c, uvs[2]],
    ]) {
      position.push(...p);
      normal.push(nx, ny, nz);
      uv.push(...t);
      color.push(colour.r, colour.g, colour.b);
    }
  }

  /** A quad a-b-c-d (counter-clockwise seen from outside). */
  function quad(a, b, c, d, colour, uvs = [PLAIN, PLAIN, PLAIN, PLAIN]) {
    tri(a, b, c, [uvs[0], uvs[1], uvs[2]], colour);
    tri(a, c, d, [uvs[0], uvs[2], uvs[3]], colour);
  }

  return {
    tri,
    quad,
    lights,
    /** Adds a smooth-shaded geometry (leaves, domes) in one colour, UVs on the plain patch. */
    addGeometry(geometry, colour) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      for (let i = 0; i < p.count; i += 1) {
        position.push(p.getX(i), p.getY(i), p.getZ(i));
        normal.push(n.getX(i), n.getY(i), n.getZ(i));
        uv.push(...PLAIN);
        // A little variation per vertex, so leaves read as painted, not flat.
        scratch.copy(colour).offsetHSL(0, 0, (((i * 7919) % 13) / 13 - 0.5) * 0.06);
        color.push(scratch.r, scratch.g, scratch.b);
      }
    },
    build() {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
      geometry.userData.lights = lights;
      return geometry;
    },
  };
}

/** A box from its centre and half-sizes, in a house's local frame (`at`). Top and four sides. */
export function box(b, at, { cx, cy, cz, sx, sy, sz }, colour) {
  const p = (dx, dy, dz) => at(cx + dx * sx, cy + dy * sy, cz + dz * sz);
  const side = colour.clone().multiplyScalar(0.88);
  b.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), colour);
  b.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), side);
  b.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), side);
  b.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), colour);
  b.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), colour);
}

/**
 * Leaf blobs, smooth-shaded: on a unit sphere the normal is the position, and
 * `scale()` carries normals along correctly - so a squashed blob still shades
 * like a soft cushion of leaves rather than a cut gem.
 */
function blob(detail) {
  const g = new IcosahedronGeometry(1, detail);
  g.setAttribute('normal', g.getAttribute('position').clone());
  return g;
}

/** Leaf smoothness, set per world from the graphics quality. */
let leafDetail = 1;

const blobs = new Map();

export const leaf = (detail) => {
  const d = Math.max(0, detail);
  if (!blobs.has(d)) blobs.set(d, blob(d));
  return blobs.get(d);
};

/** Leaf smoothness for everything built after this call (graphics quality). */
export function setLeafDetail(detail) {
  leafDetail = detail;
}

/** The current leaf detail, for builders that pick a coarser blob for small things. */
export function getLeafDetail() {
  return leafDetail;
}
