import {
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

/*
 * The mobile rules, set once here so nothing downstream can drift from them:
 * - no shadow maps; shadows are baked into textures
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

// Standing eye height, looking at the middle of the room.
const camera = new PerspectiveCamera(60, 1, 0.1, 50);
camera.position.set(0, 1.6, 4);
camera.lookAt(0, 0.8, 0);

// A floor, so an empty scene is visibly running. Two triangles.
const floor = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial({ color: 0x1b1626 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

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
}
