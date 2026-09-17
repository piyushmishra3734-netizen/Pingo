import { Color, Fog, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import { createEngine, playCoin, playSound, playStep, prepareAudio, setAmbience, setMuted, unlockAudio } from './audio/sfx.js';
import { pickQuality, setQuality } from './core/quality.js';
import { SIGNAL_URL } from './config.js';
import { State, createSession } from './core/session.js';
import { createCameraRig, createFollow } from './lobby/camera-rig.js';
import { createFriend } from './lobby/friend.js';
import { createPlayer } from './lobby/player.js';
import { createVoiceBubble, meterFor } from './lobby/voice-bubble.js';
import { screenPose, screenRect } from './lobby/screen-pose.js';
import { createWalkInput } from './lobby/walk-input.js';
import { inviteUrl, newRoomId, roomFromSearch, seatFromSearch } from './net/room-id.js';
import { createOverlay, sendLink } from './ui/overlay.js';
import { createScreenMenu } from './ui/screen-menu.js';
import { createSocial } from './ui/social.js';
import { createWorld } from './world/world.js';

/*
 * Graphics quality (core/quality.js) decides resolution, antialiasing and how
 * much detail the world is built with - low for development and weak phones,
 * high and ultra for devices that can show the world at its best. No shadow
 * maps at any level: contact shading is painted in.
 */
const quality = pickQuality();

const canvas = document.getElementById('stage');
const renderer = new WebGLRenderer({ canvas, antialias: quality.antialias });
renderer.shadowMap.enabled = false;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio) * quality.renderScale);

const params = new URLSearchParams(location.search);
const scene = new Scene();
/** The world above the clouds; `?time=day|dusk|night` picks the hour. */
const room = createWorld({ time: params.get('time') ?? 'dusk', quality });
scene.background = room.palette.horizon;
// Distance softens into the sky's own haze: atmospheric perspective, for free.
scene.fog = new Fog(room.palette.fog, 90, quality.fogFar);
scene.add(room.group);

/**
 * Where the player is: looking at the room, gliding into the screen, or
 * playing.
 * @type {'lobby' | 'zooming' | 'game'}
 */
let mode = 'lobby';

/*
 * The field of view follows the screen's shape: landscape keeps 55 degrees,
 * a portrait phone widens until a cabinet's 44 degrees fit across.
 */
const BASE_FOV = 55;
const MIN_HORIZONTAL_FOV = 44;

function fitFov(aspect) {
  const half = (MIN_HORIZONTAL_FOV * Math.PI) / 360;
  const vertical = (2 * Math.atan(Math.tan(half) / aspect) * 180) / Math.PI;
  return Math.max(BASE_FOV, vertical);
}

const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 3000);
/** Seated: glides between seat and screen. Walking: `follow` trails the player. */
const rig = createCameraRig(camera);
const follow = createFollow(camera, room.cameraBox);

/** You, on the pavement outside, facing the door. */
const player = createPlayer({ colliders: room.colliders, bounds: room.bounds });
scene.add(player.group);
player.place(room.spawn.x, room.spawn.z, room.spawn.facing);
follow.snap(player.position);
const walk = createWalkInput();

/** The other player, when there is one. */
const friend = createFriend(room);
scene.add(friend.group);

/*
 * Who you are. A name is all the arcade needs: it rides along in the invite
 * link and in the first message to a friend.
 */
const NAME_KEY = 'pingo-arcade-name';
/** Opened inside the PINGO app: your PINGO name, and invites go to PINGO friends, not a link. */
const inPingo = params.get('embed') === 'pingo' && window.parent !== window;
let myName = (() => {
  if (inPingo && params.get('as')) return params.get('as').slice(0, 18);
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
})();
if (!myName) myName = params.get('as')?.slice(0, 18) || `Player${100 + Math.floor(Math.random() * 900)}`;
let friendName = params.get('from')?.slice(0, 18) || '';

/*
 * The 2D side, fetched when a game is picked rather than at boot. Each game
 * is its own chunk.
 */
let gameHost;

/**
 * What can be on the screen. Each resolves to a function that makes a fresh
 * game; `online` (a side and a seed) is set for a game against your friend.
 */
const GAMES = {
  boxing: {
    load: () =>
      import('./games/boxing/index.js').then(
        ({ createBoxing }) => (online) => createBoxing({ renderer, onSound: playSound, seed: online?.seed ?? Math.floor(Math.random() * 2 ** 31), online }),
      ),
  },
  racing: {
    load: () =>
      import('./games/racing/index.js').then(
        ({ createRacing }) => (online) =>
          createRacing({ renderer, onSound: playSound, engine: createEngine(), seed: online?.seed ?? Math.floor(Math.random() * 2 ** 31), online }),
      ),
  },
  cpu: {
    load: () =>
      import('./games/brawler/index.js').then(
        ({ createBrawler }) => () => createBrawler({ seed: Math.floor(Math.random() * 2 ** 31), onSound: playSound }),
      ),
  },
};
const gameLoads = {};

function loadGame(kind) {
  gameLoads[kind] ??= Promise.all([import('./games/game-host.js'), GAMES[kind].load()]).then(([{ createGameHost }, make]) => {
    gameHost ??= createGameHost();
    return make;
  });
  // A failed download (a flaky network) must not stick: the next tap retries.
  gameLoads[kind].catch(() => delete gameLoads[kind]);
  return gameLoads[kind];
}

/** @type {keyof typeof GAMES | undefined} */
let playing;
/** Whether the game on now is against your friend. */
let playingOnline = false;
/** A game that draws in 3D with the arcade's renderer, while one is on. */
let activeGame;

/** How much of the view the machine's screen takes while its menu is up. */
const MENU_MARGIN = 1.22;

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = fitFov(camera.aspect);
  camera.updateProjectionMatrix();

  if (mode === 'game' && activeGame) {
    activeGame.resize(width, height);
  } else if (mode === 'game') {
    const screen = cabinetFor(seat).screen;
    rig.snap(screenPose(screen, camera));
    renderer.render(scene, camera);
    gameHost.place(screenRect(screen, camera, canvas.getBoundingClientRect()));
  } else if (session.state !== State.IDLE && !rig.moving) {
    rig.snap(screenPose(cabinetFor(seat).screen, camera, MENU_MARGIN));
  }
}
window.addEventListener('resize', resize);

/*
 * The match. The session decides; the room, the overlay and the sounds only
 * listen - see core/session.js. The network only ever *tells* the session
 * what happened, through createMatch.
 */
const session = createSession();
let seat = room.seats[0];
let rtt;
let note;

/** The room you are in, once you have sat down or arrived by invite. */
let roomId = roomFromSearch(location.search);
/** The seat the invite asks you to take (the free one). */
const invitedSeat = roomId ? room.seats[seatFromSearch(location.search) === 'A' ? 0 : 1] : undefined;
/** Your friend's seat index while they sit, else -1. */
let friendSeat = -1;
let linked = false;

/** How close to a stool you have to be to sit on it. */
const SIT_REACH = 1.5;
/** The stool within reach, if any - what "Sit down" would sit you on. */
let nearSeat;

function findSeat() {
  const { x, z } = player.position;
  return room.seats.find(
    (candidate, index) =>
      index !== friendSeat &&
      (!invitedSeat || candidate === invitedSeat || linked) &&
      Math.hypot(candidate.stool[0] - x, candidate.stool[1] - z) < SIT_REACH,
  );
}

const overlay = createOverlay({
  onStand: stand,
  onBack: () => exitGame(true),
  onSit: sitDown,
});

function show() {
  const hint = friendName && !linked && invitedSeat ? `${friendName} invited you - walk in and sit at the PINGO machine` : undefined;
  overlay.show(session.state, {
    note: note ?? (session.state === State.IDLE ? hint : undefined),
    mode,
    canSit: Boolean(nearSeat),
  });
  social.setSeated(session.state !== State.IDLE);
  menu.update({ inPingo, name: myName, friendName, linked, friendSeated: friendSeat >= 0 });
}

/** The cabinet in front of a seat. */
function cabinetFor(picked) {
  return room.cabinets[picked === room.seats[0] ? 0 : 1];
}

const seatLetter = () => (seat === room.seats[0] ? 'A' : 'B');
const myInvite = () => {
  const url = new URL(inviteUrl(location.href, roomId, seatLetter()));
  url.searchParams.set('from', myName);
  return url.toString();
};

/*
 * The network layer, loaded the first time somebody sits down - or at once,
 * for somebody arriving by invite, so their friend sees them walk in.
 */
let matchReady;
let match;

function getMatch() {
  matchReady ??= import('./net/match.js').then(({ createMatch }) => {
    match = createMatch({
      session,
      signalUrl: SIGNAL_URL,
      onRtt(ms) {
        rtt = ms;
      },
      onFull() {
        stand();
        note = 'That game already has two players';
        show();
      },
      onLink(open) {
        linked = open;
        if (open) {
          match.send({ type: 'hello', name: myName });
          sendPosition();
          if (session.state === State.WAITING) session.paired();
        } else {
          if (friendName) social.add('', `${friendName} left the arcade`, { system: true });
          friend.hide();
          friendSeat = -1;
          social.setFriend(null);
          menu.update({ ask: null, waiting: null });
          if (playingOnline) exitGame(true);
        }
        show();
      },
    });
    wireMatch(match);
    match.onVoice((stream) => social.playVoice(stream, voice));
    return match;
  });
  return matchReady;
}

/** What your friend's machine tells yours. */
function wireMatch(m) {
  m.on('hello', ({ name }) => {
    const fresh = !friendName || friendName !== name;
    friendName = String(name ?? 'Friend').slice(0, 18);
    friend.setName(friendName);
    social.setFriend(friendName);
    if (fresh) {
      social.add('', `${friendName} joined the arcade`, { system: true });
      playCoin();
    }
    show();
  });
  m.on('pos', (message) => {
    friend.apply(message);
    const seated = typeof message.s === 'number' ? message.s : -1;
    if (seated !== friendSeat) {
      friendSeat = seated;
      if (seated >= 0) social.add('', `${friendName || 'Your friend'} sat down at the PINGO machine`, { system: true });
      show();
    }
  });
  m.on('chat', ({ text }) => {
    social.add(friendName || 'Friend', String(text).slice(0, 120));
    playSound('chat');
  });
  m.on('propose', ({ kind }) => {
    if (!GAMES[kind]) return;
    if (session.state === State.IDLE || mode !== 'lobby') {
      m.send({ type: 'answer', kind, yes: false, busy: true });
      return;
    }
    menu.update({ ask: kind, waiting: null });
    playSound('select');
  });
  m.on('cancel', () => menu.update({ ask: null }));
  m.on('answer', ({ kind, yes, busy }) => {
    menu.update({ waiting: null });
    if (!yes) {
      social.add('', `${friendName || 'Your friend'} ${busy ? 'is busy right now' : 'said not now'}`, { system: true });
      return;
    }
    const seed = Math.floor(Math.random() * 2 ** 31);
    m.send({ type: 'start', kind, seed });
    void enterGame(kind, { side: 0, seed, net: m, names: [myName, friendName || 'Friend'], exit: () => exitGame(true) });
  });
  m.on('start', ({ kind, seed }) => {
    menu.update({ ask: null, waiting: null });
    void enterGame(kind, { side: 1, seed, net: m, names: [friendName || 'Friend', myName], exit: () => exitGame(true) });
  });
  m.on('leave-game', () => {
    if (playingOnline) {
      social.add('', `${friendName || 'Your friend'} left the game`, { system: true });
      exitGame(false);
    }
  });
}

/** Where you are, ten times a second, while a friend is connected. */
function sendPosition() {
  if (!linked) return;
  const seated = session.state !== State.IDLE;
  match.send({
    type: 'pos',
    x: +player.position.x.toFixed(2),
    z: +player.position.z.toFixed(2),
    h: +player.group.rotation.y.toFixed(2),
    s: seated ? room.seats.indexOf(seat) : -1,
  });
}
setInterval(sendPosition, 100);

// The top bar's signal: offline, lagging, or the round trip to your friend.
setInterval(() => {
  social.setNet({
    offline: !navigator.onLine,
    rtt: linked && rtt !== undefined ? rtt : null,
    stalled: linked && (match?.silentFor ?? 0) > 4000,
  });
}, 500);

/* Voice: the friend's audio plays through this element. */
const voice = new Audio();
voice.autoplay = true;
let micTrack = null;
/** Your own voice bubble, over your head while you talk. */
const myBubble = createVoiceBubble();
myBubble.sprite.position.y = 2.15;
player.group.add(myBubble.sprite);
let myMeter;

/**
 * Invites a friend - from the top bar's menu or the machine's screen. Walking
 * in without a room makes one first, so there is always something to invite
 * them into. Inside PINGO, PINGO's own friend list takes it from here;
 * elsewhere the link is copied.
 */
function inviteFriends() {
  if (!roomId) {
    roomId = newRoomId();
    const url = new URL(location.href);
    url.searchParams.set('room', roomId);
    history.replaceState(null, '', url);
    void getMatch().then((m) => m.begin(roomId));
  }
  if (!inPingo) {
    void sendLink(myInvite()).then((how) => {
      if (how === 'copied') social.add('', 'Invite link copied - send it to a friend', { system: true });
    });
    return;
  }
  window.parent.postMessage({ type: 'pingo-arcade:invite', room: roomId, seat: seatLetter() === 'B' ? 'A' : 'B', from: myName }, '*');
}

const social = createSocial({
  onInvite: inviteFriends,
  onStand: stand,
  quality: quality.name,
  onQuality: setQuality,
  ...(inPingo ? { onLeave: () => window.parent.postMessage({ type: 'pingo-arcade:leave' }, '*') } : {}),
  onSend(text) {
    if (!linked) {
      social.add('', 'Nobody to talk to yet - invite a friend from the PINGO machine', { system: true });
      return;
    }
    match.send({ type: 'chat', text });
    social.add(myName, text, { mine: true });
  },
  async onMic(on) {
    wake();
    if (!on) {
      micTrack?.stop();
      micTrack = null;
      myMeter = undefined;
      match?.setMic(null);
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micTrack = stream.getAudioTracks()[0];
      myMeter = meterFor(stream);
      await getMatch();
      match.setMic(micTrack);
      social.add('', linked ? 'Mic on - your friend can hear you' : 'Mic on - your friend will hear you when they join', { system: true });
      return true;
    } catch {
      social.add('', 'Microphone blocked - allow it in the browser to talk', { system: true });
      return false;
    }
  },
  onSpeaker(on) {
    voice.muted = !on;
    setMuted(!on);
  },
});
social.setPlace('top');

/* The PINGO machine's screen. */
const menu = createScreenMenu({
  onPlay(kind, vs) {
    if (vs === 'cpu') {
      void enterGame(kind);
      return;
    }
    if (!linked || friendSeat < 0) return;
    menu.update({ waiting: kind });
    match.send({ type: 'propose', kind });
  },
  onInvite: inviteFriends,
  onCopyLink: () => sendLink(myInvite()),
  onAnswer(yes, kind) {
    menu.update({ ask: null });
    match?.send({ type: 'answer', kind, yes });
    playSound(yes ? 'confirm' : 'back');
  },
  onCancel() {
    menu.update({ waiting: null });
    match?.send({ type: 'cancel' });
  },
  onRename(name) {
    myName = name;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* private window: the name lasts this visit */
    }
    if (linked) match.send({ type: 'hello', name });
    show();
  },
  onStand: stand,
  onClick: () => playSound('click'),
});

/*
 * Into the screen: the camera glides square-on to the cabinet's screen. A 3D
 * game then takes the whole view; a 2D one appears exactly over the screen.
 */
const ZOOM_MS = 700;

async function enterGame(kind, online) {
  if (session.state === State.IDLE || mode !== 'lobby') return;
  playing = kind;
  playingOnline = Boolean(online);
  mode = 'zooming';
  show();

  const screen = cabinetFor(seat).screen;
  const loading = loadGame(kind);
  loading.catch(() => {});
  const arrived = await rig.moveTo(screenPose(screen, camera), ZOOM_MS);
  let game;
  try {
    const make = await loading;
    if (mode !== 'zooming' || session.state === State.IDLE) throw new Error('moved away');
    // A resize mid-glide (a phone's address bar sliding away) cuts the glide short: finish it.
    if (!arrived) rig.snap(screenPose(screen, camera));
    game = make(online);
    if (game.is3d) await game.ready;
    if (mode !== 'zooming' || session.state === State.IDLE) throw new Error('moved away');
  } catch (error) {
    // Never stuck halfway into the screen: back to the menu, and say so.
    game?.dispose();
    if (mode === 'zooming') {
      if (String(error?.message) !== 'moved away') social.add('', 'Could not load the game - check your connection and tap again', { system: true });
      exitGame(online !== undefined);
    }
    return;
  }
  if (game.is3d) {
    activeGame = game;
    game.resize(canvas.clientWidth, canvas.clientHeight);
  } else {
    renderer.render(scene, camera);
    gameHost.start(game, screenRect(screen, camera, canvas.getBoundingClientRect()));
  }
  mode = 'game';
  social.setPlace('mid');
  updateMood();
  setRunning(!document.hidden);
  show();
}

/**
 * Out of the game, back to the machine's menu. `tell` lets your friend know,
 * so their screen goes back too.
 */
function exitGame(tell = false) {
  if (mode === 'lobby') return;
  if (tell && playingOnline) match?.send({ type: 'leave-game' });
  gameHost?.stop();
  activeGame?.dispose();
  activeGame = undefined;
  playing = undefined;
  playingOnline = false;
  mode = 'lobby';
  social.setPlace('top');
  setRunning(!document.hidden);
  if (session.state !== State.IDLE) rig.moveTo(screenPose(cabinetFor(seat).screen, camera, MENU_MARGIN), ZOOM_MS);
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
  if (from === State.IDLE) {
    // Seated: the camera goes to the machine's screen, where the menu is.
    rig.moveTo(screenPose(cabinetFor(seat).screen, camera, MENU_MARGIN), 1100);
    player.group.visible = false;
    walk.setEnabled(false);
    nearSeat = undefined;
    sendPosition();
  }
  if (to === State.IDLE) {
    exitGame(true);
    standUp();
    sendPosition();
  }
  show();
});

/** Sits at `picked` - making a room first if you are not in one. */
function sit(picked) {
  seat = picked;
  note = undefined;
  if (!roomId) roomId = newRoomId();
  // The address bar carries the room, so a reload rejoins it.
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  history.replaceState(null, '', url);
  session.sit();
  void getMatch().then((m) => {
    if (!m.debug().active) void m.begin(roomId);
    else if (linked) session.paired();
  });
}

/*
 * Sound needs a gesture first. The first tap or key anywhere unlocks it and
 * starts the floor recording; `mood` then sets how loud the room is.
 */
let woken = false;
function wake() {
  unlockAudio();
  if (woken) return;
  woken = true;
}

/** [level, muffled] for each place you can be. */
const AMBIENCE = { street: [0.16, true], floor: [0.5, false], seat: [0.3, false], game: [0.1, false] };
let lastMood;

function updateMood() {
  let mood = room.inside(player.position) ? 'floor' : 'street';
  if (session.state !== State.IDLE) mood = mode === 'game' ? 'game' : 'seat';
  if (mood === lastMood) return;
  lastMood = mood;
  setAmbience(...AMBIENCE[mood]);
}

/** "Sit down" - the button, or E. The tap is also what unlocks sound. */
function sitDown() {
  if (!nearSeat || session.state !== State.IDLE) return;
  wake();
  sit(nearSeat);
}

/** Up from the chair. The link to your friend stays: they can still see you. */
function stand() {
  session.leave();
  show();
}

window.addEventListener('keydown', (event) => {
  if (document.activeElement?.tagName === 'INPUT') return;
  if ((event.code === 'KeyE' || event.code === 'Enter') && !event.repeat) sitDown();
});
window.addEventListener('pointerdown', wake, { once: true });
window.addEventListener('keydown', wake, { once: true });

// In PINGO the room exists from the moment you walk in, so friends can be invited straight away.
if (inPingo && !roomId) {
  roomId = newRoomId();
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  history.replaceState(null, '', url);
  // PINGO keeps the room in its own address, so a reload walks back into this
  // room rather than opening a new one (and losing your friend).
  window.parent.postMessage({ type: 'pingo-arcade:room', room: roomId, seat: 'A' }, '*');
}
// Arrived by invite (or opened from PINGO): connect straight away, so your friend sees you walk in.
if (roomId) void getMatch().then((m) => m.begin(roomId));

resize();

/** Dev-only overlay; stays undefined in a normal production build. */
let hud;
let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (session.state === State.IDLE) {
    if (player.update(dt, walk.read())) playStep(room.inside(player.position));
    follow.update(dt, player.position, room.inside(player.position));
    const near = findSeat();
    if (near !== nearSeat) {
      nearSeat = near;
      show();
    }
    menu.place(null);
  } else {
    rig.update(now);
    menu.place(mode === 'lobby' && !rig.moving ? screenRect(cabinetFor(seat).screen, camera, canvas.getBoundingClientRect()) : null);
  }
  friend.update(dt);
  friend.speaking = social.level();
  myBubble.update(dt, myMeter?.() ?? 0);
  if (room.update(dt, player.position, now)) playSound('door');
  updateMood();
  room.domes.update(now);
  room.tick(camera, now / 1000);
  renderer.render(scene, camera);
  hud?.update(now);
}

/*
 * One switch for both loops: three runs only in the room, the game only in
 * the game, and neither while the tab is hidden.
 */
function setRunning(visible) {
  const game3d = mode === 'game' && activeGame;
  if (game3d && visible) activeGame.resume();
  renderer.setAnimationLoop(visible ? (mode !== 'game' ? frame : game3d ? activeGame.frame : null) : null);
  gameHost?.setPaused(!visible);
}
document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
setRunning(true);

/*
 * Warm the GPU before anyone walks. Three builds a shader the first time a
 * material is drawn in a given state, and on a phone that is a half-second
 * freeze - which landed exactly at the door, the moment the shop's inside first
 * came into view. So the shop is drawn once from the street, the doorway and
 * inside (the room decides what shows from where), with nothing culled, before
 * anyone gets there.
 */
function warmUp() {
  const culled = [];
  scene.traverse((object) => {
    if (object.frustumCulled) {
      culled.push(object);
      object.frustumCulled = false;
    }
  });
  const { x, z } = player.position;
  try {
    for (const spot of [{ x: 0, z: room.spawn.z }, { x: 0, z: room.spawn.z - 4 }, { x: 0, z: 1.5 }, { x: 0, z: -4 }]) {
      room.update(0, spot, performance.now());
      renderer.render(scene, camera);
    }
  } finally {
    for (const object of culled) object.frustumCulled = true;
    room.update(0, { x, z }, performance.now());
    if (window.__arcade) window.__arcade.warm = renderer.info.programs.length;
  }
}
// Parts of the shop settle after `ready` (textures decoding, models streaming
// in), and a settled material needs its own shader - so warm again a few times
// while that happens, rather than once too early.
for (const ms of [1500, 4000, 8000, 15000]) setTimeout(() => void room.ready.then(warmUp), ms);
setTimeout(() => {
  prepareAudio();
}, 2500);

if (import.meta.env.DEV || params.has('hud')) {
  import('./dev/perf-hud.js').then(({ createPerfHud }) => {
    hud = createPerfHud(renderer);
  });
  window.__arcade = {
    renderer,
    scene,
    camera,
    room,
    session,
    rig,
    player,
    friend,
    menu,
    social,
    get gameHost() {
      return gameHost;
    },
    get activeGame() {
      return activeGame;
    },
    get match() {
      return match;
    },
    getMatch,
    get linked() {
      return linked;
    },
    get friendSeat() {
      return friendSeat;
    },
    get mode() {
      return mode;
    },
    screenRect: () => screenRect(cabinetFor(seat).screen, camera, canvas.getBoundingClientRect()),
  };
}
