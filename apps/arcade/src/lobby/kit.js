import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Cache,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Kenney's CC0 kits, placed and baked into a handful of meshes.
 *
 * ## One mesh per kit
 *
 * The shop is ~90 placed models. As 90 meshes that is 90+ draw calls - three
 * times the mobile budget. But every model in a Kenney kit samples the same
 * palette texture, so every placement of every model in a kit can share one
 * material, and one material means the lot can be one geometry: `bake` moves
 * each placement's triangles into place on the CPU, once, and merges them.
 * The street is one draw call, the shop another.
 *
 * Three kinds of surface, three buckets:
 * - textured (the palette): one bucket per kit folder, since each kit has its own palette
 * - `paint`: the Furniture Kit uses flat colours, not a texture - baked into vertex colours
 * - `glass`: the windows and machine tops, transparent, drawn after everything else
 *
 * Licences sit next to the models in public/models/ (all CC0).
 */

// Every GLB in a kit points at the same palette PNG: with the cache on, that
// is fetched once, not once per model.
Cache.enabled = true;

let loader;

/** GLTFLoader is 104 KB; fetched with the first model, not in the main bundle. */
export async function loadGltf(url) {
  loader ??= import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader());
  return (await loader).loadAsync(url);
}

const kitOf = (url) => url.slice(0, url.lastIndexOf('/') + 1);
/** One palette per kit, taken from the first of its models to arrive. */
const palettes = new Map();
const materials = new Map();

function material(key) {
  if (!materials.has(key)) {
    let made;
    if (key === 'glass') {
      // The kits' own glass colour and opacity.
      made = new MeshBasicMaterial({ color: 0x0f141c, transparent: true, opacity: 0.3, depthWrite: false });
    } else if (key === 'paint') {
      made = new MeshLambertMaterial({ vertexColors: true });
    } else {
      made = new MeshLambertMaterial({ map: palettes.get(key) });
    }
    materials.set(key, made);
  }
  return materials.get(key);
}

function bucketOf(source, kit) {
  if (source.transparent) return 'glass';
  return source.map ? kit : 'paint';
}

/** A model flattened to one geometry per bucket, in model units. */
function toTemplate(gltf, kit) {
  gltf.scene.updateMatrixWorld(true);
  const lists = new Map();
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const source = object.material;
    const key = bucketOf(source, kit);
    if (key === kit && !palettes.has(kit)) palettes.set(kit, source.map);

    // Only what the bucket's material reads: merging needs every geometry in
    // a bucket to carry the same attributes.
    const from = object.geometry;
    const geometry = new BufferGeometry();
    geometry.setIndex(from.index.clone());
    geometry.setAttribute('position', from.attributes.position.clone());
    geometry.setAttribute('normal', from.attributes.normal.clone());
    if (key === kit) geometry.setAttribute('uv', from.attributes.uv.clone());
    if (key === 'paint') {
      const { r, g, b } = source.color;
      const colours = new Float32Array(from.attributes.position.count * 3);
      for (let i = 0; i < colours.length; i += 3) colours.set([r, g, b], i);
      geometry.setAttribute('color', new BufferAttribute(colours, 3));
    }
    geometry.applyMatrix4(object.matrixWorld);
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key).push(geometry);
  });

  const parts = new Map([...lists].map(([key, list]) => [key, mergeGeometries(list)]));
  const box = new Box3();
  for (const geometry of parts.values()) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  return { parts, box };
}

const templates = new Map();

function template(url) {
  if (!templates.has(url)) templates.set(url, loadGltf(url).then((gltf) => toTemplate(gltf, kitOf(url))));
  return templates.get(url);
}

/** A placed box's footprint on the ground: [minX, minZ, maxX, maxZ]. */
function footprint(box, matrix) {
  const corner = new Vector3();
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const x of [box.min.x, box.max.x]) {
    for (const z of [box.min.z, box.max.z]) {
      corner.set(x, 0, z).applyMatrix4(matrix);
      x0 = Math.min(x0, corner.x);
      z0 = Math.min(z0, corner.z);
      x1 = Math.max(x1, corner.x);
      z1 = Math.max(z1, corner.z);
    }
  }
  return [x0, z0, x1, z1];
}

const UP = new Vector3(0, 1, 0);

/**
 * @typedef {{
 *   url: string, x: number, z: number, y?: number, rot?: number,
 *   scale?: number | number[], centre?: boolean, solid?: boolean,
 * }} Placement
 * `centre` puts the model's footprint centre on (x, z) - the Furniture Kit's
 * pivots are at a corner. `solid` makes its footprint something to walk into.
 */

/**
 * Places every model and merges each bucket into one mesh.
 * @param {Placement[]} placements
 * @returns {Promise<{ meshes: Mesh[], colliders: number[][] }>}
 */
export async function bake(placements) {
  const loaded = await Promise.all(placements.map(({ url }) => template(url)));
  const buckets = new Map();
  const colliders = [];

  placements.forEach((place, index) => {
    const { parts, box } = loaded[index];
    const scale = Array.isArray(place.scale) ? place.scale : Array(3).fill(place.scale ?? 1);
    const matrix = new Matrix4().compose(
      new Vector3(place.x, place.y ?? 0, place.z),
      new Quaternion().setFromAxisAngle(UP, place.rot ?? 0),
      new Vector3(...scale),
    );
    if (place.centre) {
      const centre = box.getCenter(new Vector3());
      matrix.multiply(new Matrix4().makeTranslation(-centre.x, 0, -centre.z));
    }
    for (const [key, geometry] of parts) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(geometry.clone().applyMatrix4(matrix));
    }
    if (place.solid) colliders.push(footprint(box, matrix));
  });

  const meshes = [...buckets].map(([key, list]) => new Mesh(mergeGeometries(list), material(key)));
  return { meshes, colliders };
}

/**
 * A model kept whole - one that moves, or one composed offline like the
 * storefront - its PBR materials swapped for Lambert like everything else.
 * Vertex colours carry through (the storefront's tints live there), and a
 * material named `glow` - the lit windows - is drawn unlit: it gives light.
 */
export async function loadLive(url) {
  const gltf = await loadGltf(url);
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const source = object.material;
    const vertexColors = Boolean(object.geometry.attributes.color);
    if (source.transparent) object.material = material('glass');
    else if (source.name === 'glow') object.material = new MeshBasicMaterial({ vertexColors });
    else object.material = new MeshLambertMaterial({ map: source.map, vertexColors });
    source.dispose();
  });
  return gltf;
}
