import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import { createRoom } from './lobby/room.js';

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
 * An establishing view until step 5 gives sitting down its own camera move:
 * off to one side, high enough to see both cabinets and both stools, which is
 * also the view that shows whether the back-to-back layout reads.
 */
const camera = new PerspectiveCamera(55, 1, 0.1, 50);
camera.position.set(2.6, 1.85, 3.1);
camera.lookAt(0, 0.95, 0);

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  // `false`: the canvas keeps its CSS size; only the drawing buffer changes.
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/** Dev-only overlay; stays undefined in a normal production build. */
let hud;

function frame(now) {
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
  window.__arcade = { renderer, scene, camera, room };
}
