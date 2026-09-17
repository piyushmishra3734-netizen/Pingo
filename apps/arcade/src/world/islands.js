import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Floating islands: an organic top (never a circle) that rolls over a grassy
 * lip into a rocky underside tapering to a point. A few hundred triangles
 * each, coloured per vertex - grass, earth, rock darkening towards the tip -
 * so they need no texture, and every island in the world is one merged mesh
 * and one draw call.
 *
 * Normals are smooth (shared vertices within each band, split between bands)
 * which is what makes low geometry read as soft painted forms rather than
 * crude facets.
 */

const TOPS = {
  grass: ['#5f9a5c', '#4f8a55'],
  meadow: ['#78a862', '#5f9a5a'],
  stone: ['#e0dcd8', '#d6d1cc'],
  // A paved town top ringed with grass, as the islands in the film are.
  town: ['#dcd9da', '#d2cfd1', '#4f8a57'],
};
/** Which tops are paved: they get stone flags drawn in the shader. */
const PAVED = { stone: 1, town: 1 };
/** The edge band under each kind of top. */
const LIPS = { grass: '#3f6f55', meadow: '#3f6f55', stone: '#9a968f', town: '#3f6f55' };
const EARTH = new Color('#35604c');
const ROCK = new Color('#3f5a58');
const TIP = new Color('#1c2a31');

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{ x: number, y: number, z: number, radius: number, depth?: number, seed?: number, top?: keyof typeof TOPS, segments?: number, stretch?: number }} spec
 */
export function islandGeometry({ x, y, z, radius, depth = radius * 1.1, seed = 1, top = 'grass', segments = 28, stretch = 1, dome = radius * 0.02 }) {
  const random = mulberry32(seed);
  const phase = random() * 6.28;
  const outline = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    const wobble = 1 + 0.1 * Math.sin(3 * a + phase) + 0.06 * Math.sin(5 * a + phase * 2) + (random() - 0.5) * 0.05;
    return [Math.cos(a) * radius * wobble * stretch, Math.sin(a) * radius * wobble];
  });

  const positions = [];
  const colors = [];
  const paving = [];
  let paved = 0;
  const indices = [];
  const add = (px, py, pz, colour) => {
    positions.push(px + x, py + y, pz + z);
    colors.push(colour.r, colour.g, colour.b);
    paving.push(paved);
    return positions.length / 3 - 1;
  };
  const ring = (scale, height, colour, jitter = 0) =>
    outline.map(([ox, oz]) => {
      const j = 1 + (random() - 0.5) * jitter;
      return add(ox * scale * j, height + (random() - 0.5) * jitter * radius * 0.2, oz * scale * j, colour);
    });
  const band = (a, b) => {
    for (let i = 0; i < segments; i += 1) {
      const n = (i + 1) % segments;
      indices.push(a[i], a[n], b[i], a[n], b[n], b[i]);
    }
  };

  // Top: a gentle dome, lighter in the middle.
  const [inner, outer, rim] = TOPS[top].map((hex) => new Color(hex));
  paved = PAVED[top] ?? 0;
  const centre = add(0, dome, 0, inner);
  const mid = ring(0.55, dome * 0.75, inner.clone().lerp(outer, 0.5));
  for (let i = 0; i < segments; i += 1) {
    const n = (i + 1) % segments;
    indices.push(centre, mid[n], mid[i]);
  }
  let last = mid;
  if (rim) {
    // Paving to 88%, then a band of grass to the edge.
    const flags = ring(0.88, dome * 0.2, outer);
    band(mid, flags);
    paved = 0;
    const grass = ring(0.9, dome * 0.15, rim);
    band(flags, grass);
    last = grass;
  }
  paved = 0;
  const edge = ring(1, 0, rim ?? outer);
  band(last, edge);

  // The lip: the top's edge again (split, so the fold is crisp) rolling down.
  const lipTop = ring(1, 0, new Color(LIPS[top]));
  const lipLow = ring(1.03, -Math.min(1.2, depth * 0.08), EARTH);
  band(lipTop, lipLow);

  // Underside: rings shrinking and darkening to a crooked point.
  let previous = lipLow;
  const rings = 4;
  for (let k = 1; k <= rings; k += 1) {
    const t = k / rings;
    const scale = 1.03 * (1 - Math.pow(t, 1.35) * 0.92);
    const colour = ROCK.clone().lerp(TIP, t);
    const next = ring(scale, -depth * (0.12 + 0.88 * Math.pow(t, 0.85)), colour, 0.18);
    band(previous, next);
    previous = next;
  }
  const tip = add((random() - 0.5) * radius * 0.15, -depth * 1.08, (random() - 0.5) * radius * 0.15, TIP);
  for (let i = 0; i < segments; i += 1) {
    const n = (i + 1) % segments;
    indices.push(previous[i], previous[n], tip);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute('paved', new BufferAttribute(new Float32Array(paving), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Every island as one mesh. Near ones get more segments than distant ones. */
export function createIslands(specs) {
  const geometry = mergeGeometries(specs.map(islandGeometry));
  const material = new MeshLambertMaterial({ vertexColors: true });
  // Stone flags on paved tops: offset rows of slabs with darker joints and a
  // little variation slab to slab, drawn from world position - no texture.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float paved;
        varying float vPaved;
        varying vec2 vGround;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPaved = paved;
        vGround = (modelMatrix * vec4(position, 1.0)).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vPaved;
        varying vec2 vGround;
        float slabHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vPaved > 0.5) {
          vec2 g = vGround / vec2(1.3, 0.9);
          float row = floor(g.y);
          g.x += mod(row, 2.0) * 0.5;
          vec2 cell = floor(g);
          vec2 f = fract(g);
          float joint = min(min(f.x, 1.0 - f.x) * 1.3, min(f.y, 1.0 - f.y) * 0.9);
          float line = 1.0 - smoothstep(0.02, 0.06, joint);
          diffuseColor.rgb *= (0.93 + slabHash(cell) * 0.1) * (1.0 - line * 0.22);
        }`,
      );
  };
  return new Mesh(geometry, material);
}
