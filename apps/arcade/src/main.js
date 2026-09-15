import { Color, Fog, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import { playCoin, playSound, playStep, setAmbience, startAmbience, unlockAudio } from './audio/sfx.js';
import { SIGNAL_URL } from './config.js';
import { State, createSession } from './core/session.js';
import { createCameraRig, createFollow } from './lobby/camera-rig.js';
import { createPlayer } from './lobby/player.js';
import { createRoom } from './lobby/room.js';
import { screenPose, screenRect } from './lobby/screen-pose.js';
import { createWalkInput } from './lobby/walk-input.js';
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
// Past the paving the street fades into the night instead of ending at an edge.
scene.fog = new Fog(0x0d0a14, 16, 32);

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

const camera = new PerspectiveCamera(BASE_FOV, 1, 0.05, 80);
/** Seated: glides between seat and screen. Walking: `follow` trails the player. */
const rig = createCameraRig(camera);
const follow = createFollow(camera);

/*
 * You, on the pavement outside, facing the door.
 */
const player = createPlayer({ colliders: room.colliders, bounds: room.bounds });
scene.add(player.group);
player.place(room.spawn.x, room.spawn.z, room.spawn.facing);
follow.snap(player.position);
const walk = createWalkInput();

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

/*
 * What can be on the screen, and the session state each one needs: the VS
 * card with a player opposite, the brawler against the computer while the
 * invite is still out. Each resolves to a function that makes a fresh game.
 */
const GAMES = {
  versus: {
    state: State.PAIRED,
    load: () =>
      import('./games/versus-card.js').then(
        ({ createVersusCard }) => () => createVersusCard({ youAreLeft: seat === seatById.A }),
      ),
  },
  cpu: {
    state: State.WAITING,
    load: () =>
      import('./games/brawler/index.js').then(
        ({ createBrawler }) => () =>
          createBrawler({ seed: Math.floor(Math.random() * 2 ** 31), onSound: playSound }),
      ),
  },
};
const gameLoads = {};

function loadGame(kind) {
  gameLoads[kind] ??= Promise.all([import('./games/game-host.js'), GAMES[kind].load()]).then(
    ([{ createGameHost }, make]) => {
      gameHost ??= createGameHost();
      return make;
    },
  );
  return gameLoads[kind];
}

/** @type {keyof typeof GAMES | undefined} */
let playing;

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

/*
 * Opened from an invite: you still arrive outside and walk in, and the one
 * seat you can take is the free one opposite your friend.
 */
const invitedTo = roomFromSearch(location.search);
const invitedSeat = invitedTo ? seatById[seatFromSearch(location.search)] : undefined;

/** How close to a stool you have to be to sit on it. */
const SIT_REACH = 1.5;
/** The stool within reach, if any - what "Sit down" would sit you on. */
let nearSeat;

function findSeat() {
  const { x, z } = player.position;
  const seats = invitedSeat ? [invitedSeat] : room.seats;
  return seats.find(({ stool }) => Math.hypot(stool[0] - x, stool[1] - z) < SIT_REACH);
}

resize();

const overlay = createOverlay({
  onStand: stand,
  onPlay: () => void enterGame('versus'),
  onCpu: () => void enterGame('cpu'),
  onBack: () => exitGame(),
  onSit: sitDown,
});

function show() {
  const hint = invitedSeat
    ? 'Your friend is inside - sit at the PINGO machine'
    : 'Walk in and sit at the PINGO machine';
  overlay.show(session.state, {
    invite,
    rtt,
    note: note ?? (session.state === State.IDLE ? hint : undefined),
    mode,
    canSit: Boolean(nearSeat),
  });
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

async function enterGame(kind = 'versus') {
  const needs = GAMES[kind].state;
  if (session.state !== needs || mode !== 'lobby') return;
  playing = kind;
  mode = 'zooming';
  show();

  const screen = cabinetFor(seat).screen;
  const loading = loadGame(kind);
  const arrived = await rig.moveTo(screenPose(screen, camera), ZOOM_MS);
  const make = await loading;
  // Superseded - dropped, joined, or stood up mid-glide.
  if (!arrived || mode !== 'zooming' || session.state !== needs) return;

  renderer.render(scene, camera);
  gameHost.start(make(), screenRect(screen, camera, canvas.getBoundingClientRect()));
  mode = 'game';
  // The 3D loop stops here, so the room goes quiet from here, not from a frame.
  updateMood();
  setRunning(!document.hidden);
  show();
}

/** Out of the screen: the game goes, three comes back, the camera glides out. */
function exitGame() {
  clearTimeout(enterTimer);
  if (mode === 'lobby') return;
  gameHost?.stop();
  playing = undefined;
  mode = 'lobby';
  setRunning(!document.hidden);
  if (session.state !== State.IDLE) rig.moveTo(seat);
  show();
}

/** Back on your feet beside the stool; the camera trails back out behind you. */
function standUp() {
  const [x, z] = seat.standAt;
  player.place(x, z, seat.facing);
  player.group.visible = true;
  follow.reset(seat.lookAt);
  walk.setEnabled(true);
}

room.domes.set(session.light);
show();

session.on(({ from, to, light }) => {
  room.domes.set(light);
  if (to !== State.PAIRED) rtt = undefined;
  // A game lasts as long as the state it needs: a drop ends the match, and
  // somebody at the door ends the bout against the computer.
  if (from === State.PAIRED || (playing && to !== GAMES[playing].state)) exitGame();
  if (from === State.IDLE) {
    // Seated: the camera takes the seat, and your own body would only sit
    // between it and the screen.
    rig.moveTo(seat);
    player.group.visible = false;
    walk.setEnabled(false);
    nearSeat = undefined;
  }
  if (to === State.IDLE) standUp();
  if (to === State.PAIRED) {
    playCoin();
    void loadGame('versus');
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

/*
 * Sound needs a gesture first. The first tap or key anywhere unlocks it and
 * starts the floor recording; `mood` then sets how loud the room is.
 */
function wake() {
  unlockAudio();
  void startAmbience('sounds/arcade-floor.mp3').then(() => {
    lastMood = undefined;
  });
}

/** [level, muffled] for each place you can be. */
const AMBIENCE = { street: [0.16, true], floor: [0.5, false], seat: [0.3, false], game: [0.1, false] };
let lastMood;

function updateMood() {
  const { x, z } = player.position;
  const indoors = Math.abs(x) < 6.5 && z < 5.8;
  let mood = indoors ? 'floor' : 'street';
  if (session.state !== State.IDLE) mood = mode === 'game' ? 'game' : 'seat';
  if (mood === lastMood) return;
  lastMood = mood;
  setAmbience(...AMBIENCE[mood]);
}

/** "Sit down" - the button, or E. The tap is also what unlocks sound. */
function sitDown() {
  if (!nearSeat || session.state !== State.IDLE) return;
  wake();
  sit(nearSeat, nearSeat === invitedSeat ? invitedTo : newRoomId());
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

window.addEventListener('keydown', (event) => {
  if ((event.code === 'KeyE' || event.code === 'Enter') && !event.repeat) sitDown();
});
window.addEventListener('pointerdown', wake, { once: true });
window.addEventListener('keydown', wake, { once: true });

/** Dev-only overlay; stays undefined in a normal production build. */
let hud;
let lastFrame = performance.now();

function frame(now) {
  // Capped: a tab brought back after a minute takes one normal step, not a leap.
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (session.state === State.IDLE) {
    if (player.update(dt, walk.read())) playStep();
    follow.update(dt, player.position);
    const near = findSeat();
    if (near !== nearSeat) {
      nearSeat = near;
      show();
    }
  } else {
    rig.update(now);
  }
  if (room.update(dt, player.position, now)) playSound('door');
  updateMood();
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
    player,
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
