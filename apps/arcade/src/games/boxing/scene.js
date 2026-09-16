import {
  AdditiveBlending,
  Color,
  DirectionalLight,
  Euler,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

import { loadLive } from '../../lobby/kit.js';
import { loadPerson } from '../../lobby/people.js';
import { glowTexture } from '../../lobby/textures.js';
import { DODGE, PUNCHES } from './match.js';

/**
 * The boxing match, drawn: the ring under a light rig, two boxers in gloves,
 * a ringside camera.
 *
 * The ring (Zaw Imagineering) and the gloves (Zsky) are Poly Pizza models,
 * CC-BY 3.0, prepared offline; the boxers are Quaternius's Modular Men with
 * their own punch, hit and knockout clips. Nothing here decides anything -
 * it only shows what match.js says happened.
 */

/** Measured from the prepared ring: the canvas is 0.92 m up. */
const CANVAS = 0.92;
const CM = 0.01;
/** A phone held upright still sees both boxers. */
const MIN_HORIZONTAL_FOV = 58;
const BASE_FOV = 38;

/** Where a glove sits on its wrist bone, in metres, and how it is turned. */
const GLOVE = { forward: 0.07, turn: [0, 0, 0] };

/*
 * The guard: extra rotation on each arm bone (radians, local XYZ), laid over
 * whatever clip is playing. The Modular Men have walk and punch clips but no
 * boxing stance, so the stance is made here.
 *
 * Found by turning one bone on one axis at a time and looking (pose-probe):
 * on these rigs Z swings the upper arm forward and folds the elbow, X tucks
 * the elbow in, and the right arm's axes are the left's mirrored.
 */
/** Fists up in front of the face, elbows in. */
const STANCE = { UpperArmL: [0.35, 0, -0.4], LowerArmL: [0, 0, -2.4], UpperArmR: [-0.35, 0, 0.4], LowerArmR: [0, 0, 2.4] };
/** Blocking: gloves up by the temples, covering the head. */
const COVER = { UpperArmL: [0, 0, -0.85], LowerArmL: [0, 0, -2.0], UpperArmR: [0, 0, 0.85], LowerArmR: [0, 0, 2.0] };
/** How much of the guard each arm keeps: the punching arm lets go for its punch. */
const ARM_WEIGHT = { jab: [0, 1], power: [1, 0], star: [1, 0], hurt: [0.5, 0.5], ko: [0, 0], down: [0, 0], rise: [0.4, 0.4], win: [0, 0] };
/** The wind-up glow: a power punch glows red on the way, a star punch gold. */
const TELL = { power: 0xff3b3b, star: 0xffc83a };

const scratch = new Vector3();
const aim = new Vector3();
const look = new Vector3();
const euler = new Euler();
const turn = new Quaternion();

/** Tuning hook for the probes; never set in a normal build. */
const debug = import.meta.env.DEV || new URLSearchParams(location.search).has('hud') ? (window.__boxing = { STANCE, COVER, freeze: false, camera: null }) : null;

function flashSprite() {
  const sprite = new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  sprite.scale.setScalar(0.6);
  return sprite;
}

/** The same glove, red turned blue: swap the red and blue channels as it is drawn. */
function blueCorner(material) {
  const blue = material.clone();
  blue.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = gl_FragColor.bgr;');
  };
  blue.customProgramCacheKey = () => 'boxing-blue-corner';
  return blue;
}

export function createBoxingScene() {
  const scene = new Scene();
  scene.background = new Color(0x07050c);
  scene.fog = new Fog(0x07050c, 10, 24);
  scene.add(new HemisphereLight(0xfff0e0, 0x1c1526, 1.0));
  // One directional light for the rig overhead: the boxers get a lit side
  // and a dark side, which is most of what makes a punch read.
  const rig = new DirectionalLight(0xfff6ea, 1.5);
  rig.position.set(1.5, 7, 5);
  scene.add(rig);

  const floor = new Mesh(new PlaneGeometry(40, 40), new MeshLambertMaterial({ color: 0x120e18 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // The pool of light on the canvas under the rig.
  const pool = new Mesh(
    new PlaneGeometry(7, 7),
    new MeshBasicMaterial({ map: glowTexture(), color: 0xffe2b8, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = CANVAS + 0.012;
  scene.add(pool);

  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 60);
  const flashes = [flashSprite(), flashSprite()];
  scene.add(...flashes);

  const views = [];
  let shake = 0;

  let zoom = 0;
  let baseFov = BASE_FOV;
  const eye = new Vector3(0, CANVAS + 2.6, 5.2);
  const focus = new Vector3(0, CANVAS + 1.0, 0);

  const gear = Promise.all([
    loadLive('models/boxing/ring.glb').then((gltf) => scene.add(gltf.scene)),
    loadLive('models/boxing/gloves.glb'),
  ]).then(([, gloves]) => gloves);

  /** Puts these two in the ring (boxer 0's look first), replacing whoever was there. */
  async function setLooks(looks) {
    const [gloves, ...people] = await Promise.all([gear, ...looks.map((name) => loadPerson(name))]);
    for (const view of views) scene.remove(view.person.body);
    views.length = 0;
    const left = gloves.scene.getObjectByName('glove-left');
    const right = gloves.scene.getObjectByName('glove-right');
    people.forEach((person, corner) => {
      scene.add(person.body);
      person.body.updateMatrixWorld(true);
      for (const [boneName, source] of [['WristL', left], ['WristR', right]]) {
        const bone = person.body.getObjectByName(boneName);
        if (!bone) continue;
        const glove = source.clone();
        // Red corner and blue corner: at a glance, whose gloves are whose.
        if (corner === 1) glove.traverse((part) => part.isMesh && (part.material = blueCorner(part.material)));
        bone.getWorldScale(scratch);
        glove.scale.setScalar(1 / scratch.x);
        glove.position.set(0, GLOVE.forward / scratch.x, 0);
        glove.rotation.set(...GLOVE.turn);
        bone.add(glove);
      }
      const tell = flashSprite();
      const wrist = person.body.getObjectByName('WristR');
      wrist?.getWorldScale(scratch);
      tell.scale.setScalar(0.5 / (scratch.x || 1));
      tell.position.set(0, (GLOVE.forward + 0.05) / (scratch.x || 1), 0);
      wrist?.add(tell);
      person.play('Idle');
      const bones = Object.fromEntries(Object.keys(STANCE).map((name) => [name, person.body.getObjectByName(name)]));
      const pose = Object.fromEntries(Object.keys(STANCE).map((name) => [name, [...STANCE[name]]]));
      views.push({ person, state: '', t: 0, hits: 0, bones, pose, tell });
    });
  }

  /** Starts the clip for a state the moment the boxer enters it. */
  function enter(view, boxer) {
    const { person } = view;
    switch (boxer.state) {
      case 'jab':
        person.once('Punch_Left', 'Idle', { speed: 2.6 });
        break;
      case 'power':
        person.once('Punch_Right', 'Idle', { speed: 1.5 });
        break;
      case 'star':
        person.once('Punch_Right', 'Idle', { speed: 1.1 });
        break;
      case 'down':
        person.once('Death', 'Idle', { speed: 1.2, hold: true });
        break;
      case 'rise':
        person.play('Idle', { fade: 0.5 });
        break;
      case 'hurt':
        view.hits += 1;
        person.once(view.hits % 2 ? 'HitRecieve' : 'HitRecieve_2', 'Idle', { speed: 1.3 });
        break;
      case 'ko':
        person.once('Death', 'Idle', { speed: 0.9, hold: true });
        break;
      case 'win':
        person.play('Wave');
        break;
      case 'walk':
        person.play('Walk', { speed: boxer.walk > 0 ? 1.4 : -1.2 });
        break;
      case 'idle':
        person.play('Idle');
        break;
      default:
    }
  }

  return {
    scene,
    camera,
    setLooks,

    /** Where boxer `index`'s head is on the screen, in CSS pixels. */
    headOnScreen(index, width, height) {
      const body = views[index]?.person.body;
      if (!body) return { x: width / 2, y: height / 3 };
      scratch.copy(body.position).setY(body.position.y + 1.9).project(camera);
      return { x: ((scratch.x + 1) / 2) * width, y: ((1 - scratch.y) / 2) * height };
    },

    /** A hit or a block: a flash where it landed, a jolt of the camera. */
    onEvent(event, match) {
      if (event.type !== 'hit' && event.type !== 'block') return;
      const struck = match.boxers[event.boxer];
      const flash = flashes[event.boxer];
      const blocked = event.type === 'block';
      const heavy = event.punch !== 'jab';
      flash.material.color.set(blocked ? 0x7fc8ff : event.punch === 'star' ? 0xffc83a : heavy ? 0xffd27a : 0xffffff);
      flash.material.opacity = 1;
      flash.scale.setScalar(event.punch === 'star' ? 1.6 : heavy ? 0.9 : 0.55);
      flash.position.set(struck.x * CM - struck.facing * 0.2, CANVAS + (blocked ? 1.25 : 1.5), 0.15);
      if (!blocked) shake = { star: 0.16, power: 0.07, jab: 0.03 }[event.punch] * (event.counter ? 1.5 : 1);
      if (!blocked && (event.punch === 'star' || event.counter)) zoom = 1;
    },

    update(match, dt) {
      match.boxers.forEach((boxer, index) => {
        const view = views[index];
        if (!view) return;
        if (boxer.state !== view.state || boxer.t < view.t) enter(view, boxer);
        view.state = boxer.state;
        view.t = boxer.t;

        const body = view.person.body;
        body.position.set(boxer.x * CM, CANVAS, 0);
        body.rotation.set(0, boxer.facing > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        // Guard: a small crouch behind the gloves. Slip: duck under it.
        if (boxer.state === 'block' || boxer.state === 'blockstun') {
          body.position.y -= 0.06;
          body.rotateX(-0.1);
        } else if (boxer.state === 'star' && boxer.t >= PUNCHES.star.startup - 4) {
          // The star punch throws the whole body in behind it.
          const lunge = Math.max(0, Math.sin((Math.PI * (boxer.t - PUNCHES.star.startup + 4)) / 20));
          body.position.x += boxer.facing * 0.25 * lunge;
          body.position.y += 0.08 * lunge;
        } else if (boxer.state === 'dodge') {
          const depth = Math.sin((Math.PI * Math.min(boxer.t, DODGE.length)) / DODGE.length);
          body.position.y -= 0.32 * depth;
          body.rotateX(0.38 * depth);
        }
        view.person.update(dt);

        // The guard goes on after the clip has posed the bones this frame,
        // easing towards the stance, the cover, or letting go for a punch.
        const target = boxer.state === 'block' || boxer.state === 'blockstun' ? COVER : STANCE;
        const [left, right] = ARM_WEIGHT[boxer.state] ?? [1, 1];
        const ease = Math.min(1, dt * 14);
        for (const name of Object.keys(STANCE)) {
          const bone = view.bones[name];
          if (!bone) continue;
          const weight = name.endsWith('L') ? left : right;
          const now = view.pose[name];
          for (let k = 0; k < 3; k += 1) now[k] += (target[name][k] * weight - now[k]) * ease;
          bone.quaternion.multiply(turn.setFromEuler(euler.set(now[0], now[1], now[2])));
        }

        // The tell: the punching glove glows through the wind-up, brightest
        // just before it lands - the thing a player learns to watch for.
        const punch = PUNCHES[boxer.state];
        const winding = TELL[boxer.state] && boxer.t < punch.startup + punch.active;
        if (TELL[boxer.state]) view.tell.material.color.set(TELL[boxer.state]);
        view.tell.material.opacity = winding ? 0.35 + 0.65 * Math.min(1, boxer.t / punch.startup) : Math.max(0, view.tell.material.opacity - dt * 5);
      });

      for (const flash of flashes) {
        flash.material.opacity = Math.max(0, flash.material.opacity - dt * 6);
        flash.scale.multiplyScalar(1 + dt * 2);
      }

      // High ringside, looking down over the top rope: level with the boxers
      // the near ropes ran across their bodies, and inside the ropes the
      // corner posts filled the frame. From up here the ropes pass below
      // their chests, and the camera never drifts towards a corner.
      const [a, b] = match.boxers;
      const middle = ((a.x + b.x) / 2) * CM;
      shake = Math.max(0, shake - dt * 0.5);
      const jolt = shake ? (Math.random() - 0.5) * shake : 0;
      // A boxer on the canvas: the camera comes down to them for the count.
      const fallen = match.phase === 'down' || match.phase === 'ko' ? match.boxers.find((x) => x.state === 'down' || x.state === 'ko') : null;
      if (fallen) {
        aim.set(fallen.x * CM * 0.6, CANVAS + 2.1, 4.4);
        look.set(fallen.x * CM * 0.8, CANVAS + 0.7, 0);
      } else {
        aim.set(Math.max(-1.2, Math.min(1.2, middle * 0.6)), CANVAS + 2.6, 5.2);
        look.set(middle * 0.8, CANVAS + 1.0, 0);
      }
      const follow = 1 - Math.exp(-dt * (fallen ? 2.5 : 8));
      eye.lerp(aim, follow);
      focus.lerp(look, follow);
      if (debug?.camera) {
        camera.position.set(...debug.camera.position);
        camera.lookAt(...debug.camera.lookAt);
      } else {
        camera.position.set(eye.x + jolt, eye.y + jolt, eye.z);
        camera.lookAt(focus);
      }
      if (zoom > 0 || camera.fov !== baseFov) {
        zoom = Math.max(0, zoom - dt * 2.5);
        camera.fov = baseFov * (1 - 0.12 * zoom * zoom);
        camera.updateProjectionMatrix();
      }
    },

    resize(width, height) {
      camera.aspect = width / height;
      const half = (MIN_HORIZONTAL_FOV * Math.PI) / 360;
      baseFov = Math.max(BASE_FOV, (2 * Math.atan(Math.tan(half) / camera.aspect) * 180) / Math.PI);
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    },
  };
}
