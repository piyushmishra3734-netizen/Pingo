import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { loadGltf } from '../../lobby/kit.js';
import { contactShadowTexture, glowTexture } from '../../lobby/textures.js';
import { DRIFT_LEVELS } from './race.js';
import { HALF_ROAD, TILE } from './track.js';

/**
 * The race, drawn: Kenney's Racing Kit road and props, baked into a single
 * mesh; four karts from the Car Kit with their drivers; wheels drawn
 * instanced; a chase camera. Nothing here decides anything.
 *
 * Draw calls: track 1, ground 1, pads 1, karts 4, wheels 1, shadows 1,
 * sparks and flame 3.
 */

/** Car Kit karts are 1.43 long; this makes them about 2.7 m. */
const KART_SCALE = 1.9;
const WHEELS = [
  [0.277, 0.21, 0.324, true],
  [-0.277, 0.21, 0.324, true],
  [0.277, 0.21, -0.361, false],
  [-0.277, 0.21, -0.361, false],
];
const SPARK = [0xffffff, 0x4fb3ff, 0xff9a2e, 0xff4fd8];
const GRASS = new Color(0x62b04e);
/** Who drives which kart: you first. */
export const KARTS = ['kart-oobi', 'kart-oodi', 'kart-ooli', 'kart-oopi'];

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

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Chevrons for the boost pads, drawn once. */
function padTexture() {
  const element = document.createElement('canvas');
  element.width = 64;
  element.height = 128;
  const ctx = element.getContext('2d');
  ctx.fillStyle = '#ff7a1a';
  ctx.fillRect(0, 0, 64, 128);
  ctx.strokeStyle = '#ffe14a';
  ctx.lineWidth = 12;
  for (const y of [30, 70, 110]) {
    ctx.beginPath();
    ctx.moveTo(6, y);
    ctx.lineTo(32, y - 24);
    ctx.lineTo(58, y);
    ctx.stroke();
  }
  const texture = new CanvasTexture(element);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function sprite(color, size) {
  const s = new Sprite(new SpriteMaterial({ map: glowTexture(), color, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  s.scale.setScalar(size);
  return s;
}

export function createRacingScene() {
  const scene = new Scene();
  scene.background = new Color(0x8fd3ff);
  scene.fog = new Fog(0x8fd3ff, 90, 320);
  scene.add(new HemisphereLight(0xeaf6ff, 0x4a6a3a, 1.6));
  const sun = new DirectionalLight(0xfff3dd, 1.6);
  sun.position.set(-40, 80, 30);
  scene.add(sun);

  const ground = new Mesh(new PlaneGeometry(1200, 1200), new MeshLambertMaterial({ color: GRASS }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  const camera = new PerspectiveCamera(68, 1, 0.3, 500);
  const palette = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const scratch = new Object3D();
  const matrix = new Matrix4();
  const eye = new Vector3();
  const focus = new Vector3();
  const aim = new Vector3();
  const look = new Vector3();
  const up = new Vector3(0, 1, 0);

  let track;
  let karts = [];
  let wheels;
  let shadows;
  const sparks = [sprite(0x4fb3ff, 1.1), sprite(0x4fb3ff, 1.1)];
  const flame = sprite(0xff8a2a, 2.2);
  scene.add(...sparks, flame);
  let rolled = 0;
  let fovBoost = 0;
  let baseFov = 68;

  const assets = Promise.all([loadGltf('models/racing/track.glb'), loadGltf('models/racing/karts.glb')]).then(([parts, kartFile]) => {
    const geometry = {};
    parts.scene.traverse((o) => {
      if (o.isMesh) geometry[o.name] = o.geometry;
    });
    const models = {};
    kartFile.scene.traverse((o) => {
      if (o.isMesh) models[o.name] = o;
    });
    return { geometry, models };
  });

  /** Lays out one circuit: road, scenery and the karts on the grid. */
  async function build(race, seed = 7) {
    const { geometry, models } = await assets;
    if (track) {
      scene.remove(track.mesh, track.pads);
      track.mesh.geometry.dispose();
      track.pads.geometry.dispose();
    }
    const pieces = [];
    const add = (part, x, y, z, yaw, scale) => {
      const g = geometry[part]?.clone();
      if (!g) return;
      scratch.position.set(x, y, z);
      scratch.rotation.set(0, yaw, 0);
      scratch.scale.setScalar(scale);
      scratch.updateMatrix();
      pieces.push(g.applyMatrix4(scratch.matrix));
    };

    for (const piece of race.track.pieces) add(piece.part, piece.x, 0, piece.z, piece.yaw, TILE);

    const { points, cells } = race.track;
    const n = points.length;
    const random = mulberry32(seed);
    const side = (p, lateral) => [p.x + -Math.cos(p.yaw) * lateral, p.z + Math.sin(p.yaw) * lateral];

    // Tyre barriers round the outside of every bend.
    let colour = 0;
    for (let i = 0; i < n; i += 3) {
      const bend = wrap(points[(i + 4) % n].yaw - points[(i - 4 + n) % n].yaw);
      if (Math.abs(bend) < 0.05) continue;
      const [x, z] = side(points[i], (bend < 0 ? -1 : 1) * (HALF_ROAD + 3.6));
      add((colour += 1) % 2 ? 'barrierRed' : 'barrierWhite', x, 0, z, points[i].yaw + Math.PI / 2, TILE);
    }

    // The start: the arch over the line, stands and pits beside the grid.
    const line = points[0];
    add('roadStart', line.x, 0, line.z, line.yaw, TILE);
    for (const [at, lateral, part, turn] of [
      [4, -(HALF_ROAD + 12), 'grandStandCovered', -Math.PI / 2],
      [15, -(HALF_ROAD + 12), 'grandStandCovered', -Math.PI / 2],
      [10, HALF_ROAD + 12, 'pitsGarage', Math.PI / 2],
    ]) {
      const p = points[(at + n) % n];
      const [x, z] = side(p, lateral);
      add(part, x, 0, z, p.yaw + turn, part === 'lightPostModern' ? TILE : TILE * 0.8);
    }
    // Banner towers and tents at a few bends.
    for (const [f, part] of [[0.3, 'bannerTowerRed'], [0.65, 'bannerTowerGreen'], [0.48, 'tent'], [0.85, 'tent']]) {
      const p = points[Math.floor(f * n)];
      const [x, z] = side(p, (random() < 0.5 ? -1 : 1) * (HALF_ROAD + 12));
      add(part, x, 0, z, p.yaw, part === 'tent' ? TILE * 0.8 : TILE * 0.8);
    }

    // Trees on the grass, never on or right beside the road.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const key of cells) {
      const [cx, cz] = key.split(',').map(Number);
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minZ = Math.min(minZ, cz);
      maxZ = Math.max(maxZ, cz);
    }
    const near = (cx, cz) => {
      for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) if (cells.has(`${cx + dx},${cz + dz}`)) return true;
      return false;
    };
    let trees = 0;
    for (let tries = 0; tries < 400 && trees < 46; tries += 1) {
      const fx = minX - 3 + random() * (maxX - minX + 7);
      const fz = minZ - 3 + random() * (maxZ - minZ + 7);
      if (near(Math.floor(fx), Math.floor(fz))) continue;
      add(random() < 0.5 ? 'treeLarge' : 'treeSmall', fx * TILE, 0, fz * TILE, random() * 6.3, TILE * (0.45 + random() * 0.3));
      trees += 1;
    }

    const mesh = new Mesh(mergeGeometries(pieces), palette);
    pieces.forEach((g) => g.dispose());

    // Boost pads: flat chevrons on the road.
    const padPieces = race.pads.map((index) => {
      const p = points[index];
      const g = new PlaneGeometry(5, 7);
      scratch.position.set(p.x, 0.05, p.z);
      scratch.rotation.set(0, p.yaw, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      g.rotateX(-Math.PI / 2);
      return g.applyMatrix4(scratch.matrix);
    });
    const pads = new Mesh(mergeGeometries(padPieces), new MeshBasicMaterial({ map: padTexture(), side: DoubleSide }));
    padPieces.forEach((g) => g.dispose());
    scene.add(mesh, pads);
    track = { mesh, pads };

    // Karts.
    if (!karts.length) {
      karts = race.karts.map((_, i) => {
        const source = models[KARTS[i % KARTS.length]];
        const body = new Mesh(source.geometry, new MeshLambertMaterial({ map: source.material.map, flatShading: true }));
        body.material.map.magFilter = NearestFilter;
        body.scale.setScalar(KART_SCALE);
        scene.add(body);
        return body;
      });
      const wheel = models.wheel;
      wheels = new InstancedMesh(wheel.geometry, new MeshLambertMaterial({ map: wheel.material.map, flatShading: true }), race.karts.length * 4);
      shadows = new InstancedMesh(new PlaneGeometry(2.4, 3.4).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }), race.karts.length);
      scene.add(wheels, shadows);
    }
  }

  const ready = assets;

  return {
    scene,
    camera,
    ready,
    build,

    /** Where kart `index` is on screen, in CSS pixels. */
    kartOnScreen(race, index, width, height) {
      const k = race.karts[index];
      aim.set(k.x, 3, k.z).project(camera);
      return { x: ((aim.x + 1) / 2) * width, y: ((1 - aim.y) / 2) * height };
    },

    update(race, dt, you = 0) {
      if (!karts.length) return;
      rolled += dt;
      race.karts.forEach((k, i) => {
        const body = karts[i];
        body.position.set(k.x, Math.abs(Math.sin(rolled * 18 + i)) * 0.03 * Math.min(1, k.speed / 10), k.z);
        // Karts model faces +z; yaw 0 drives towards -z.
        body.rotation.set(0, k.yaw + Math.PI, k.drift ? k.drift * 0.1 : -k.steer * 0.04, 'YXZ');
        body.updateMatrix();
        body.updateMatrixWorld();
        WHEELS.forEach(([x, y, z, front], w) => {
          scratch.position.set(x, y, z);
          scratch.rotation.set(rolled * k.speed * 1.6, front ? -k.steer * 0.35 : 0, 0, 'YXZ');
          if (x < 0) scratch.rotation.z = Math.PI;
          scratch.scale.setScalar(1);
          scratch.updateMatrix();
          matrix.multiplyMatrices(body.matrixWorld, scratch.matrix);
          wheels.setMatrixAt(i * 4 + w, matrix);
        });
        scratch.position.set(k.x, 0.03, k.z);
        scratch.rotation.set(0, k.yaw, 0);
        scratch.scale.setScalar(1);
        scratch.updateMatrix();
        shadows.setMatrixAt(i, scratch.matrix);
      });
      wheels.instanceMatrix.needsUpdate = true;
      shadows.instanceMatrix.needsUpdate = true;

      // Your sparks and your flame.
      const k = race.karts[you];
      const hx = -Math.sin(k.yaw);
      const hz = -Math.cos(k.yaw);
      const level = k.drift ? DRIFT_LEVELS.filter((need) => k.charge >= need).length : 0;
      sparks.forEach((s, i) => {
        const across = i ? 1 : -1;
        s.position.set(k.x - hx * 1.3 + -hz * across * 0.9, 0.35, k.z - hz * 1.3 + hx * across * 0.9);
        s.material.color.set(SPARK[level]);
        s.material.opacity = k.drift ? (level ? 1 : 0.35) * (0.7 + 0.3 * Math.sin(rolled * 60 + i)) : 0;
        s.scale.setScalar(level ? 0.9 + level * 0.35 : 0.6);
      });
      flame.position.set(k.x - hx * 1.9, 0.6, k.z - hz * 1.9);
      flame.material.opacity = k.boost > 0 ? 0.75 + 0.25 * Math.sin(rolled * 50) : 0;

      // Chase camera: behind where the kart is going, a little above.
      // Upright phones get a higher camera: more road ahead, less sky.
      const portrait = camera.aspect < 1;
      const behind = portrait ? 9.5 : 8.5;
      aim.set(k.x + Math.sin(k.travel) * behind, portrait ? 6 : 4.3, k.z + Math.cos(k.travel) * behind);
      look.set(k.x - Math.sin(k.yaw) * 10, portrait ? 0 : 1.0, k.z - Math.cos(k.yaw) * 10);
      if (race.phase === 'countdown' && race.t < 2) {
        eye.copy(aim);
        focus.copy(look);
      }
      const follow = 1 - Math.exp(-dt * 7);
      eye.lerp(aim, follow);
      focus.lerp(look, 1 - Math.exp(-dt * 12));
      camera.position.copy(eye);
      camera.up.copy(up);
      camera.lookAt(focus);
      fovBoost += ((k.boost > 0 ? 1 : 0) - fovBoost) * Math.min(1, dt * 5);
      const fov = baseFov + fovBoost * 10 + Math.min(1, k.speed / 26) * 4;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },

    resize(width, height) {
      camera.aspect = width / height;
      // A phone held upright needs more view to see the road ahead.
      baseFov = camera.aspect < 1 ? 80 : 66;
      camera.updateProjectionMatrix();
    },
  };
}
