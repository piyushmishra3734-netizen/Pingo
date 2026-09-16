import {
  AdditiveBlending,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

import { loadLive } from '../../lobby/kit.js';
import { loadPerson } from '../../lobby/people.js';
import { glowTexture } from '../../lobby/textures.js';
import { DODGE } from './match.js';

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
/** Who is who: you in shorts, the computer in the vest. */
const LOOKS = ['beach', 'punk'];
/** A phone held upright still sees both boxers. */
const MIN_HORIZONTAL_FOV = 58;
const BASE_FOV = 38;

/** Where a glove sits on its wrist bone, in metres, and how it is turned. */
const GLOVE = { forward: 0.07, turn: [0, 0, 0] };

const scratch = new Vector3();

function flashSprite() {
  const sprite = new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  sprite.scale.setScalar(0.6);
  return sprite;
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

  const ready = Promise.all([
    loadLive('models/boxing/ring.glb').then((gltf) => scene.add(gltf.scene)),
    loadLive('models/boxing/gloves.glb'),
    ...LOOKS.map((look) => loadPerson(look)),
  ]).then(([, gloves, ...people]) => {
    const left = gloves.scene.getObjectByName('glove-left');
    const right = gloves.scene.getObjectByName('glove-right');
    people.forEach((person) => {
      scene.add(person.body);
      person.body.updateMatrixWorld(true);
      for (const [boneName, source] of [['WristL', left], ['WristR', right]]) {
        const bone = person.body.getObjectByName(boneName);
        if (!bone) continue;
        const glove = source.clone();
        bone.getWorldScale(scratch);
        glove.scale.setScalar(1 / scratch.x);
        glove.position.set(0, GLOVE.forward / scratch.x, 0);
        glove.rotation.set(...GLOVE.turn);
        bone.add(glove);
      }
      person.play('Idle');
      views.push({ person, state: '', t: 0, hits: 0 });
    });
  });

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
    ready,

    /** A hit or a block: a flash where it landed, a jolt of the camera. */
    onEvent(event, match) {
      if (event.type !== 'hit' && event.type !== 'block') return;
      const struck = match.boxers[event.boxer];
      const flash = flashes[event.boxer];
      const blocked = event.type === 'block';
      flash.material.color.set(blocked ? 0x7fc8ff : event.punch === 'power' ? 0xffd27a : 0xffffff);
      flash.material.opacity = 1;
      flash.scale.setScalar(event.punch === 'power' ? 0.9 : 0.55);
      flash.position.set(struck.x * CM - struck.facing * 0.2, CANVAS + (blocked ? 1.25 : 1.5), 0.15);
      if (!blocked) shake = event.punch === 'power' ? 0.06 : 0.025;
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
        } else if (boxer.state === 'dodge') {
          const depth = Math.sin((Math.PI * Math.min(boxer.t, DODGE.length)) / DODGE.length);
          body.position.y -= 0.32 * depth;
          body.rotateX(0.38 * depth);
        }
        view.person.update(dt);
      });

      for (const flash of flashes) {
        flash.material.opacity = Math.max(0, flash.material.opacity - dt * 6);
        flash.scale.multiplyScalar(1 + dt * 2);
      }

      // Inside the ropes, the way a broadcast ring camera works: from outside,
      // the near ropes ran straight across the boxers.
      const [a, b] = match.boxers;
      const middle = ((a.x + b.x) / 2) * CM;
      shake = Math.max(0, shake - dt * 0.25);
      const jolt = shake ? (Math.random() - 0.5) * shake : 0;
      camera.position.set(middle * 0.5 + jolt, CANVAS + 1.35 + jolt, 2.75);
      camera.lookAt(middle * 0.8, CANVAS + 1.0, 0);
    },

    resize(width, height) {
      camera.aspect = width / height;
      const half = (MIN_HORIZONTAL_FOV * Math.PI) / 360;
      camera.fov = Math.max(BASE_FOV, (2 * Math.atan(Math.tan(half) / camera.aspect) * 180) / Math.PI);
      camera.updateProjectionMatrix();
    },
  };
}
