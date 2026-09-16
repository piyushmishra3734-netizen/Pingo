import { CanvasTexture, Color, Euler, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

import { loadPerson } from './people.js';
import { contactShadowTexture } from './textures.js';

/**
 * The other player, as the room sees them: walking where their last few
 * position messages say, sitting on their stool, a name over their head.
 *
 * Positions arrive ten times a second; the body glides towards the latest
 * rather than jumping, and plays Walk or Run by how fast it had to move.
 */

/** Seated: thighs forward, knees bent (radians, local XYZ on each bone). */
export const SIT = {
  UpperLegL: [-1.45, 0, 0],
  UpperLegR: [-1.45, 0, 0],
  LowerLegL: [1.5, 0, 0],
  LowerLegR: [1.5, 0, 0],
};
/** How far the hips drop onto a bar stool. */
const SIT_DROP = 0.15;
const TALKING = new Color(0.45, 1, 0.55);
const euler = new Euler();
const turn = new Quaternion();

function nameTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 30px system-ui, sans-serif';
  const width = Math.min(248, ctx.measureText(text).width + 32);
  ctx.fillStyle = 'rgba(12, 8, 22, 0.72)';
  ctx.beginPath();
  ctx.roundRect((256 - width) / 2, 10, width, 44, 22);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33, 232);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * @param {{ seats: Array<{ stool: number[], facing: number }> }} room
 */
export function createFriend(room) {
  const group = new Group();
  group.visible = false;

  const shadow = new Mesh(
    new PlaneGeometry(0.9, 0.9),
    new MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.008;
  group.add(shadow);

  const tag = new Sprite(new SpriteMaterial({ map: nameTexture('Friend'), transparent: true }));
  tag.scale.set(1.0, 0.25, 1);
  tag.position.y = 2.1;
  tag.renderOrder = 10;
  group.add(tag);

  let person;
  let bones = {};
  const target = { x: 0, z: 0, heading: 0, seat: -1 };
  let heading = 0;
  let known = false;
  let speaking = 0;

  const ready = loadPerson('casual2').then((loaded) => {
    person = loaded;
    group.add(person.body);
    person.play('Idle');
    bones = Object.fromEntries(Object.keys(SIT).map((name) => [name, person.body.getObjectByName(name)]));
  });

  return {
    group,
    ready,

    setName(name) {
      tag.material.map.dispose();
      tag.material.map = nameTexture(name || 'Friend');
    },

    /** A position message from the other player. */
    apply({ x, z, h, s }) {
      target.x = x;
      target.z = z;
      target.heading = h;
      target.seat = s;
      if (!known) {
        group.position.set(x, 0, z);
        heading = h;
        known = true;
      }
      group.visible = true;
    },

    /** Gone: the link closed. */
    hide() {
      group.visible = false;
      known = false;
    },

    /** Talking right now (0-1), from the voice meter: the tag pulses. */
    set speaking(level) {
      speaking = level;
    },

    update(dt) {
      if (!group.visible || !person) return;
      const seat = room.seats[target.seat];
      let tx = target.x;
      let tz = target.z;
      let th = target.heading;
      if (seat) {
        [tx, tz] = seat.stool;
        th = seat.facing + Math.PI;
      }
      const dx = tx - group.position.x;
      const dz = tz - group.position.z;
      const gap = Math.hypot(dx, dz);
      // Far behind (a reconnect, a teleport to the stool): jump; else glide.
      const follow = gap > 3 ? 1 : Math.min(1, dt * 10);
      group.position.x += dx * follow;
      group.position.z += dz * follow;
      heading += Math.atan2(Math.sin(th - heading), Math.cos(th - heading)) * Math.min(1, dt * 10);
      group.rotation.y = heading;
      if (seat) person.play('Idle');
      else if (gap > 0.45) person.play('Run', { speed: 1.1 });
      else if (gap > 0.03) person.play('Walk', { speed: 1.1 });
      else person.play('Idle');
      person.update(dt);

      // Sitting is a pose laid over Idle: legs forward and bent, hips down.
      person.body.position.y = seat ? -SIT_DROP : 0;
      if (seat) {
        for (const [name, [x, y, z]] of Object.entries(SIT)) bones[name]?.quaternion.multiply(turn.setFromEuler(euler.set(x, y, z)));
      }
      tag.position.y = (seat ? 1.85 : 2.1) + Math.sin(performance.now() / 90) * 0.02 * speaking;
      tag.material.color.setRGB(1, 1, 1).lerp(TALKING, Math.min(1, speaking * 2));
    },
  };
}
