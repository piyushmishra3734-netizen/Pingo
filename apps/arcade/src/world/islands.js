import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Floating islands, shaped as the film draws them: a broad flat top, paved in
 * pale stone to a thin grass rim; a short, steep cliff band under the rim; and
 * then a big smooth belly that rounds in and narrows to a point, dark
 * teal-green getting darker towards the tip. Slim rock spikes (tall, narrow
 * specs) are drawn as inverted cones with a grassy cap instead.
 *
 * Everything is coloured per vertex - no textures - and every island in the
 * world is one merged mesh and one draw call. The stone flags on paved tops
 * are drawn in the fragment shader from world position.
 *
 * Normals are smooth within each band and split between bands (the rim, the
 * foot of the cliff), so low geometry reads as soft painted forms with a few
 * crisp folds rather than crude facets.
 *
 * Detail follows `segments` (which the world scales by quality): the number of
 * rings down the belly and the hanging moss both grow with it.
 */

const TOPS = {
  grass: ['#5f9a5c', '#4f8a55'],
  meadow: ['#78a862', '#5f9a5a'],
  stone: ['#e0dcd8', '#d6d1cc', '#c9c4bf'],
  // A paved town top ringed with grass, as the islands in the film are.
  town: ['#dedad6', '#d3cfcb', '#5a8f5b'],
};
/** Which tops are paved: they get stone flags drawn in the shader. */
const PAVED = { stone: 1, town: 1 };
/** Where the paving stops and the rim begins, as a fraction of the radius. */
const PAVED_TO = 0.94;
/** The rolled edge just under each kind of top. */
const LIPS = { grass: '#4a7f58', meadow: '#4f8458', stone: '#9a968f', town: '#4a7f58' };
const CLIFF = [new Color('#35573f'), new Color('#2c4a3d')];
const BELLY = [new Color('#3c5a55'), new Color('#2e4847'), new Color('#1b2a30')];
const SPIKE = [new Color('#6f8a7a'), new Color('#4a625f'), new Color('#243439')];
const MOSS = [new Color('#3f7048'), new Color('#2b513d')];

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

/** Three colours as a gradient over t in [0, 1]. */
function ramp([a, b, c], t, out = new Color()) {
  return t < 0.5 ? out.copy(a).lerp(b, t * 2) : out.copy(b).lerp(c, t * 2 - 1);
}

/**
 * @param {{
 *   x: number, y: number, z: number, radius: number, depth?: number, seed?: number,
 *   top?: keyof typeof TOPS, segments?: number, stretch?: number, dome?: number,
 *   cliff?: number, spike?: boolean, moss?: boolean,
 * }} spec
 *   cliff: height of the steep band under the rim (default about a seventh of
 *     the depth); a raised terrace sitting on another island wants it as tall
 *     as the step, so no belly shows above the lower top.
 *   spike: draw a slim inverted cone (default: when the spec is much deeper
 *     than it is wide).
 *   moss: hang moss strips from the rim (default: grass-rimmed islands with
 *     enough segments, i.e. higher quality).
 */
export function islandGeometry({
  x,
  y,
  z,
  radius,
  depth = radius * 1.1,
  seed = 1,
  top = 'grass',
  segments = 28,
  stretch = 1,
  dome = radius * 0.02,
  cliff = Math.min(5, Math.max(0.8, depth * 0.14)),
  spike = depth > radius * 2,
  moss = !spike && top !== 'stone' && segments >= 56,
}) {
  const random = mulberry32(seed);
  const phase = random() * 6.28;
  // Gentle, low-frequency wobble only: the film's silhouettes are clean.
  const outline = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    const wobble = 1 + 0.07 * Math.sin(2 * a + phase) + 0.04 * Math.sin(3 * a + phase * 2) + (random() - 0.5) * 0.02;
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
  /**
   * A ring following the outline at `scale` and `height`. `jitter` roughens it
   * (in metres, radial) and `shade` varies the tone vertex to vertex, for a
   * painted, slightly rocky face.
   */
  const ring = (scale, height, colour, { jitter = 0, shade = 0 } = {}) =>
    outline.map(([ox, oz]) => {
      const k = scale + ((random() - 0.5) * jitter) / Math.hypot(ox, oz);
      const c = colour.clone();
      if (shade) c.multiplyScalar(1 + (random() - 0.5) * shade);
      return add(ox * k, height, oz * k, c);
    });
  /** The same ring again in a new colour: a crisp fold with no crack. */
  const split = (from, colour) =>
    from.map((i) => add(positions[i * 3] - x, positions[i * 3 + 1] - y, positions[i * 3 + 2] - z, colour));
  const band = (a, b) => {
    for (let i = 0; i < segments; i += 1) {
      const n = (i + 1) % segments;
      indices.push(a[i], a[n], b[i], a[n], b[n], b[i]);
    }
  };
  const fan = (centre, around, down) => {
    for (let i = 0; i < segments; i += 1) {
      const n = (i + 1) % segments;
      if (down) indices.push(around[i], around[n], centre);
      else indices.push(centre, around[n], around[i]);
    }
  };

  // Top: flat where dome is 0 (people and buildings stand at y), paved to
  // PAVED_TO on paved tops, then a thin rim of grass to the edge.
  const [inner, outer, rimColour] = TOPS[top].map((hex) => new Color(hex));
  paved = PAVED[top] ?? 0;
  const centre = add(0, dome, 0, inner);
  let last;
  if (dome > 0) {
    const mid = ring(0.55, dome * 0.75, inner.clone().lerp(outer, 0.5));
    fan(centre, mid);
    last = ring(PAVED_TO, dome * 0.1, outer);
    band(mid, last);
  } else {
    last = ring(PAVED_TO, 0, outer);
    fan(centre, last);
  }
  paved = 0;
  if (rimColour) {
    // Same positions as the paving's edge, split so the colour change is crisp.
    last = split(last, rimColour);
  }
  const edge = ring(1, 0, rimColour ?? outer);
  band(last, edge);

  // The lip: the edge again (split, so the fold is crisp) rolling over and out
  // a touch, like a kerb of turf.
  const lipColour = new Color(LIPS[top]);
  const lipTop = split(edge, lipColour);
  const lipDrop = spike ? 0.35 : Math.min(0.6, cliff * 0.3);
  const lip = ring(1.008, -lipDrop, lipColour);
  band(lipTop, lip);

  if (spike) {
    // A slim cone: pale sage under the grass, darkening to a sharp point.
    const rings = Math.min(6, Math.max(2, Math.round(segments / 6)));
    let previous = lip;
    for (let k = 1; k <= rings; k += 1) {
      const t = k / (rings + 1);
      const colour = ramp(SPIKE, t);
      const next = ring(1.0 * Math.pow(1 - t, 1.15), -lipDrop - (depth - lipDrop) * t, colour, { jitter: 0.08, shade: 0.06 });
      band(previous, next);
      previous = next;
    }
    fan(add((random() - 0.5) * radius * 0.1, -depth, (random() - 0.5) * radius * 0.1, SPIKE[2]), previous, true);
    return finish();
  }

  // The cliff: a near-vertical band, dark green and a little rocky.
  const cliffMid = ring(1.0, -lipDrop - (cliff - lipDrop) * 0.5, CLIFF[0], { jitter: radius * 0.012, shade: 0.12 });
  band(lip, cliffMid);
  const cliffFoot = ring(0.985, -cliff, CLIFF[1], { jitter: radius * 0.012, shade: 0.12 });
  band(cliffMid, cliffFoot);

  // The belly, split from the cliff so the foot reads as a fold: a smooth bowl
  // that holds its width, then rounds in to a point.
  const below = depth - cliff;
  const rings = Math.min(8, Math.max(3, Math.round(segments / 8)));
  let previous = split(cliffFoot, BELLY[0]);
  for (let k = 1; k <= rings; k += 1) {
    const t = k / (rings + 1);
    const scale = 0.985 * Math.pow(1 - Math.pow(t, 1.8), 0.75);
    const colour = ramp(BELLY, Math.pow(t, 0.8));
    const next = ring(scale, -cliff - below * t, colour, { jitter: radius * 0.02 * (1 - t), shade: 0.05 });
    band(previous, next);
    previous = next;
  }
  fan(add((random() - 0.5) * radius * 0.08, -depth, (random() - 0.5) * radius * 0.08, BELLY[2]), previous, true);

  // Moss and vines hanging from the rim down the cliff face: tapered strips,
  // three triangles each, standing just proud of the rock.
  if (moss) {
    const count = Math.round(segments * 0.4);
    for (let v = 0; v < count; v += 1) {
      const i = Math.floor(random() * segments);
      const [ox, oz] = outline[i];
      const len = Math.hypot(ox, oz);
      const nx = ox / len;
      const nz = oz / len;
      const width = 0.5 + random() * 1.4;
      const length = Math.min(cliff * 1.1, 0.8 + random() * cliff);
      const out = 1.008 * len + 0.12;
      const tx = -nz * width * 0.5;
      const tz = nx * width * 0.5;
      const at = (s, h, colour, off = out) => add(nx * off + tx * s, h, nz * off + tz * s, colour);
      const topY = -lipDrop * 0.6;
      const midY = topY - length * 0.55;
      const a = at(-1, topY, MOSS[0]);
      const b = at(1, topY, MOSS[0]);
      const c = at(-0.7, midY, MOSS[1], len * 0.995 + 0.12);
      const d = at(0.7, midY, MOSS[1], len * 0.995 + 0.12);
      const tip = add(nx * (len * 0.99 + 0.12) + tx * (random() - 0.5), topY - length, nz * (len * 0.99 + 0.12) + tz * (random() - 0.5), MOSS[1]);
      indices.push(a, b, c, b, d, c, c, d, tip);
    }
  }
  return finish();

  function finish() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute('paved', new BufferAttribute(new Float32Array(paving), 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}

/** Every island as one mesh. Near ones get more segments than distant ones. */
export function createIslands(specs) {
  const geometry = mergeGeometries(specs.map(islandGeometry));
  const material = new MeshLambertMaterial({ vertexColors: true });
  // Stone flags on paved tops, as on the film's promenades: long slabs laid in
  // rows, each row its own slab length and offset, thin darker joints, a soft
  // darkening at slab edges, and tone that varies slab to slab with the odd
  // warmer stone. Drawn from world position - no texture - and faded out with
  // distance (by screen-space derivative) so far tops do not shimmer.
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
          vec2 p = vGround;
          float rowH = 0.85;
          float row = floor(p.y / rowH);
          float rh = slabHash(vec2(row, 7.13));
          float slabW = 1.0 + rh * 0.8;
          float gx = p.x / slabW + rh * 5.0;
          vec2 cell = vec2(floor(gx), row);
          vec2 f = vec2(fract(gx) * slabW, fract(p.y / rowH) * rowH);
          vec2 edge = min(f, vec2(slabW, rowH) - f);
          float d = min(edge.x, edge.y);
          float px = max(fwidth(p.x), fwidth(p.y));
          float near = 1.0 - smoothstep(0.04, 0.3, px);
          float joint = 1.0 - smoothstep(0.018, 0.018 + px * 1.5, d);
          float bevel = smoothstep(0.02, 0.14, d);
          float h = slabHash(cell);
          float tone = 0.93 + h * 0.1;
          vec3 warm = mix(vec3(1.0), vec3(1.02, 0.99, 0.94), step(0.82, slabHash(cell + 3.7)));
          float grain = 0.97 + 0.05 * slabHash(floor(p * 7.0));
          vec3 slab = warm * tone * grain * mix(0.94, 1.0, bevel) * (1.0 - joint * 0.3);
          diffuseColor.rgb *= mix(vec3(0.98), slab, near);
        }`,
      );
  };
  return new Mesh(geometry, material);
}
