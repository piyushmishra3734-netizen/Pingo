import { Raycaster, Vector2 } from 'three';

/**
 * Turns a tap on the scene into "this seat".
 *
 * Only the seats' hit volumes are tested - two invisible boxes, not the
 * thousand-odd triangles of the room - so a tap costs microseconds. Each box
 * covers the stool *and* the cabinet in front of it: a stool is a thumbnail on
 * a phone, and "tap the machine you want to play" is what people try first.
 *
 * A tap is a pointer that went down and up without travelling: a drag that
 * happens to end over a stool is somebody looking around, not sitting down.
 */

const TAP_SLOP_PX = 10;

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   camera: import('three').Camera,
 *   seats: Array<{ hit: import('three').Object3D }>,
 *   onPick: (seat: object) => void,
 * }} options
 */
export function createSeatPicker({ canvas, camera, seats, onPick }) {
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const targets = seats.map((seat) => seat.hit);
  let down;

  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!down) return;
    const travelled = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    down = undefined;
    if (travelled > TAP_SLOP_PX) return;

    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    // Raycasting ignores `visible`, which is what lets the hit boxes be
    // invisible and still catch the tap.
    const [hit] = raycaster.intersectObjects(targets, false);
    if (hit) onPick(seats[targets.indexOf(hit.object)]);
  });
}
