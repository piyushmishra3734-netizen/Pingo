import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import { playCoin, unlockAudio } from './audio/sfx.js';
import { SIGNAL_URL } from './config.js';
import { State, createSession } from './core/session.js';
import { createCameraRig } from './lobby/camera-rig.js';
import { createRoom } from './lobby/room.js';
import { screenPose, screenRect } from './lobby/screen-pose.js';
import { createSeatPicker } from './lobby/seat-picker.js';
import { inviteUrl, newRoomId, roomFromSearch, seatFromSearch } from './net/room-id.js';
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

/**
 * Where the player is: looking at the room, gliding into the screen, or
 * playing - in which case three draws nothing at all.
 * @type {'lobby' | 'zooming' | 'game'}
 */
let mode = 'lobby';

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

const camera = new PerspectiveCamera(BASE_FOV, 1, 0.05, 50);
const rig = createCameraRig(camera);

/*
 * The 2D side, fetched when a match is on rather than at boot.
 *
 * Nobody needs a game to look at the room, and every game added to the first
 * download pushes the room's first frame later on 2G - with the host and the
 * VS card alone the main bundle passed 600 KB. The fetch starts the moment
 * the players pair, so it has landed long before the camera reaches the
 * screen. Each game will be its own chunk the same way.
 */
let gameHost;
let gameLoading;

function loadGame() {
  gameLoading ??= Promise.all([
    import('./games/game-host.js'),
    import('./games/versus-card.js'),
  ]).then(([{ createGameHost }, { createVersusCard }]) => {
    gameHost ??= createGameHost();
    return { createVersusCard };
  });
  return gameLoading;
}

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

  // Mid-game, the 3D loop is off: re-seat the camera for the new shape, draw
  // the one frame the game sits on, and move the game to match it.
  if (mode === 'game') {
    const screen = cabinetFor(seat).screen;
    rig.snap(screenPose(screen, camera));
    renderer.render(scene, camera);
    gameHost.place(screenRect(screen, camera, canvas.getBoundingClientRect()));
  }
}
window.addEventListener('resize', resize);

/*
 * The match. The session decides; the room, the overlay and the sounds only
 * listen - see core/session.js. The network only ever *tells* the session
 * what happened, through createMatch.
 */
const session = createSession();
const seatById = { A: room.seats[0], B: room.seats[1] };
let seat = seatById.A;
let invite;
let rtt;
let note;

resize();

const overlay = createOverlay({
  onStand: stand,
  onPlay: () => void enterGame(),
  onBack: () => exitGame(),
});

function show() {
  overlay.show(session.state, { invite, rtt, note, mode });
}

/** The cabinet in front of a seat. */
function cabinetFor(picked) {
  return room.cabinets[picked === seatById.A ? 0 : 1];
}

/*
 * The network layer, loaded the first time somebody sits down.
 *
 * Nobody needs signalling or WebRTC to look at the room, and adding them to
 * the first download took the main bundle past 600 KB. As its own chunk it
 * arrives in the time the camera spends gliding to the seat.
 */
let matchReady;

function getMatch() {
  matchReady ??= import('./net/match.js').then(({ createMatch }) =>
    createMatch({
      session,
      signalUrl: SIGNAL_URL,
      onRtt(ms) {
        rtt = ms;
        show();
      },
      onRole(role) {
        // Only a host has somebody to invite; a promoted guest becomes one.
        invite = role === 'host' ? inviteUrl(location.href, roomFromSearch(location.search), seat.id) : undefined;
        show();
      },
      onFull() {
        // Out of the chair and out of the room - the address bar included,
        // or a reload would knock on the same full door again.
        stand();
        note = 'That game already has two players';
        show();
      },
    }),
  );
  return matchReady;
}

/*
 * Into the screen.
 *
 * A beat after the coin so the green light registers, then the camera glides
 * square-on to the cabinet's screen until it fills the view. On arrival the
 * 3D loop stops - three draws nothing from here, which is the battery and the
 * memory bandwidth back - and the 2D game appears exactly over the screen it
 * replaces, its rectangle measured from the screen's own projected corners.
 * The last 3D frame stays underneath as the cabinet around the game.
 */
const ENTER_AFTER_MS = 1200;
const ZOOM_MS = 900;
let enterTimer;

async function enterGame() {
  if (session.state !== State.PAIRED || mode !== 'lobby') return;
  mode = 'zooming';
  show();

  const screen = cabinetFor(seat).screen;
  const loading = loadGame();
  const arrived = await rig.moveTo(screenPose(screen, camera), ZOOM_MS);
  const { createVersusCard } = await loading;
  // Superseded - dropped, or stood up, mid-glide - or no longer paired.
  if (!arrived || mode !== 'zooming' || session.state !== State.PAIRED) return;

  renderer.render(scene, camera);
  gameHost.start(
    createVersusCard({ youAreLeft: seat === seatById.A }),
    screenRect(screen, camera, canvas.getBoundingClientRect()),
  );
  mode = 'game';
  setRunning(!document.hidden);
  show();
}

/** Out of the screen: the game goes, three comes back, the camera glides out. */
function exitGame() {
  clearTimeout(enterTimer);
  if (mode === 'lobby') return;
  gameHost?.stop();
  mode = 'lobby';
  setRunning(!document.hidden);
  if (session.state !== State.IDLE) rig.moveTo(seat);
  show();
}

room.domes.set(session.light);
show();

session.on(({ from, to, light }) => {
  room.domes.set(light);
  if (to !== State.PAIRED) rtt = undefined;
  // Leaving PAIRED - dropped or stood up - ends any game first.
  if (from === State.PAIRED) exitGame();
  if (from === State.IDLE) rig.moveTo(seat);
  if (to === State.IDLE) rig.moveTo(OVERVIEW);
  if (to === State.PAIRED) {
    playCoin();
    void loadGame();
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => void enterGame(), ENTER_AFTER_MS);
  }
  show();
});

/** Sits at `picked` in room `roomId` - making the room if there is none. */
function sit(picked, roomId) {
  seat = picked;
  note = undefined;
  // The address bar carries the room, so a reload rejoins it and the link
  // in it is already the invite.
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  history.replaceState(null, '', url);
  session.sit();
  void getMatch().then((match) => match.begin(roomId));
}

function stand() {
  session.leave();
  void matchReady?.then((match) => match.end());
  invite = undefined;
  const url = new URL(location.href);
  url.search = '';
  history.replaceState(null, '', url);
  show();
}

createSeatPicker({
  canvas,
  camera,
  seats: room.seats,
  onPick(picked) {
    // Already in a chair: a tap on the scene is not a request to swap seats.
    if (session.state !== State.IDLE) return;
    // The tap is the gesture the browser needs before it will play a sound.
    unlockAudio();
    sit(picked, newRoomId());
  },
});

/*
 * Opened from an invite: straight to the other seat, and into the room.
 *
 * No tap has happened yet, so the browser will not play the coin until the
 * guest touches the page once - the first touch anywhere unlocks it.
 */
const invitedTo = roomFromSearch(location.search);
if (invitedTo) sit(seatById[seatFromSearch(location.search)], invitedTo);
window.addEventListener('pointerdown', unlockAudio, { once: true });

/** Dev-only overlay; stays undefined in a normal production build. */
let hud;

function frame(now) {
  rig.update(now);
  room.domes.update(now);
  renderer.render(scene, camera);
  hud?.update(now);
}

/*
 * One switch for both loops: three runs only in the room, the game only in
 * the game, and neither while the tab is hidden - nobody can see it, and the
 * battery can.
 */
function setRunning(visible) {
  renderer.setAnimationLoop(visible && mode !== 'game' ? frame : null);
  gameHost?.setPaused(!visible);
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
  window.__arcade = {
    renderer,
    scene,
    camera,
    room,
    session,
    rig,
    get gameHost() {
      return gameHost;
    },
    getMatch,
    get mode() {
      return mode;
    },
    screenRect: () => screenRect(cabinetFor(seat).screen, camera, canvas.getBoundingClientRect()),
  };
}
