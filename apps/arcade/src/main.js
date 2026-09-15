import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import { playCoin, unlockAudio } from './audio/sfx.js';
import { State, createSession } from './core/session.js';
import { createCameraRig } from './lobby/camera-rig.js';
import { createRoom } from './lobby/room.js';
import { createSeatPicker } from './lobby/seat-picker.js';
import { createOverlay } from './ui/overlay.js';

/*
 * The mobile rules, set once here so nothing downstream can drift from them:
 * - no shadow maps; contact shadows are drawn on a canvas at boot instead
 * - pixel ratio capped at 1.2; above that a budget phone's GPU heats up and throttles
 * - no MSAA; at this pixel ratio it costs more than it shows on a phone
 */
const MAX_PIXEL_RATIO = 1.2;

const canvas = document.getElementById('stage');
const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.shadowMap.enabled = false;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));

const scene = new Scene();
scene.background = new Color(0x0d0a14);

const room = createRoom();
scene.add(room.group);

/*
 * The field of view follows the screen's shape.
 *
 * A fixed 55 degrees is right on a laptop and wrong on a phone held upright:
 * at an aspect of 0.46 it leaves about 27 degrees across, and a cabinet seen
 * from the stool needs about 44. So the vertical angle widens until at least
 * 44 degrees fit horizontally - landscape keeps 55, a portrait phone gets the
 * whole machine instead of its middle.
 */
const BASE_FOV = 55;
const MIN_HORIZONTAL_FOV = 44;

function fitFov(aspect) {
  const half = (MIN_HORIZONTAL_FOV * Math.PI) / 360;
  const vertical = (2 * Math.atan(Math.tan(half) / aspect) * 180) / Math.PI;
  return Math.max(BASE_FOV, vertical);
}

const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 50);
const rig = createCameraRig(camera);

/** Off to one side and high: both cabinets, both stools, both domes. */
const OVERVIEW = { position: [2.6, 1.85, 3.1], lookAt: [0, 0.95, 0] };
rig.snap(OVERVIEW);

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  // `false`: the canvas keeps its CSS size; only the drawing buffer changes.
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = fitFov(camera.aspect);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/*
 * The match. The session decides; everything in the room only listens - see
 * core/session.js. The seat is the lobby's business, remembered here so the
 * camera knows where "sitting down" means.
 */
const session = createSession();
let seat = room.seats[0];

const overlay = createOverlay({ onStand: () => session.leave() });

function show(state, light) {
  room.domes.set(light);
  overlay.show(state);
}
show(session.state, session.light);

session.on(({ from, to, light }) => {
  show(to, light);
  if (from === State.IDLE) rig.moveTo(seat);
  if (to === State.IDLE) rig.moveTo(OVERVIEW);
  if (to === State.PAIRED) playCoin();
});

createSeatPicker({
  canvas,
  camera,
  seats: room.seats,
  onPick(picked) {
    // Already in a chair: a tap on the scene is not a request to swap seats.
    if (session.state !== State.IDLE) return;
    // The tap is the gesture the browser needs before it will play a sound.
    unlockAudio();
    seat = picked;
    session.sit();
  },
});

/** Dev-only overlay; stays undefined in a normal production build. */
let hud;

function frame(now) {
  rig.update(now);
  room.domes.update(now);
  renderer.render(scene, camera);
  hud?.update(now);
}

// A hidden tab draws nothing: nobody can see it, and the battery can.
function setRunning(running) {
  renderer.setAnimationLoop(running ? frame : null);
}
document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
setRunning(true);

// Its own chunk: always in dev, and in a production build with `?hud` for
// checks on a real phone. Everyone else never downloads it.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('hud')) {
  import('./dev/perf-hud.js').then(({ createPerfHud }) => {
    hud = createPerfHud(renderer);
  });
  // The scene, reachable from a console or a headless probe. Dev only: it is
  // the difference between reading geometry numbers and guessing at them.
  window.__arcade = { renderer, scene, camera, room, session, rig };
}

/*
 * The rest of the story by keyboard, in dev only, until steps 6-7 bring a real
 * guest: G guest found, P paired, D dropped, L leave, and S to sit at seat A
 * without aiming. Any key also unlocks audio, so P plays the coin.
 */
if (import.meta.env.DEV) {
  const KEYS = { s: 'sit', g: 'guestFound', p: 'paired', d: 'dropped', l: 'leave' };
  window.addEventListener('keydown', (event) => {
    const action = KEYS[event.key.toLowerCase()];
    if (!action) return;
    unlockAudio();
    session.send(action);
  });
}
