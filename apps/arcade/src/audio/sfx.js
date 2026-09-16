/**
 * The arcade's sounds: real recordings (Kenney's audio packs and a few from
 * OpenGameArt - see public/CREDITS.txt), cut short and saved as small mono
 * mp3s in public/sounds.
 *
 * ## Unlocking
 *
 * Browsers refuse to make a sound until the page has been touched, and they
 * refuse silently. So the AudioContext is created on the first real gesture,
 * and every file is fetched and decoded then - about 300 KB in all. A sound
 * asked for before its file has arrived simply does not happen.
 *
 * ## Variety
 *
 * A sound with several takes (`hit-1`, `hit-2`, ...) plays a random one, a
 * few percent off pitch: the same punch heard ten times in a row is what
 * makes a game sound cheap.
 */

let context;
let master;

const TAKES = {
  hit: 3,
  'hit-heavy': 3,
  block: 2,
  ko: 1,
  fall: 1,
  bell: 2,
  count: 1,
  star: 1,
  'star-hit': 1,
  cheer: 2,
  coin: 1,
  door: 1,
  'step-street': 5,
  'step-carpet': 5,
  'race-count': 1,
  go: 1,
  boost: 1,
  spark: 1,
  lap: 1,
  click: 1,
  select: 1,
  back: 1,
  confirm: 1,
  win: 1,
  lose: 1,
  chat: 1,
  bump: 1,
};

/** Event names the games use, and the recordings (and loudness) each plays. */
const SOUNDS = {
  hit: [['hit', 0.9]],
  'hit-heavy': [['hit-heavy', 1]],
  block: [['block', 0.8]],
  ko: [['ko', 1], ['fall', 0.8], ['cheer', 0.7]],
  down: [['fall', 1], ['cheer', 0.6]],
  count: [['count', 0.7]],
  star: [['star', 0.6]],
  'star-hit': [['hit-heavy', 1], ['star-hit', 0.6], ['cheer', 0.5]],
  cheer: [['cheer', 0.7]],
  fight: [['bell', 0.8]],
  bell: [['bell', 0.8]],
  door: [['door', 0.5]],
  go: [['go', 0.7]],
  'race-count': [['race-count', 0.6]],
  boost: [['boost', 0.55]],
  spark: [['spark', 0.4]],
  lap: [['lap', 0.6]],
  click: [['click', 0.5]],
  select: [['select', 0.5]],
  back: [['back', 0.5]],
  confirm: [['confirm', 0.6]],
  win: [['win', 0.6], ['cheer', 0.5]],
  lose: [['lose', 0.6]],
  chat: [['chat', 0.5]],
  bump: [['bump', 0.5]],
  // The brawler's names.
  punch: [['hit', 0.8]],
  kick: [['hit-heavy', 0.9]],
  over: [['bell', 0.7]],
};

const buffers = new Map();
let loading;

function loadAll() {
  loading ??= Promise.all(
    Object.entries(TAKES).flatMap(([name, count]) =>
      Array.from({ length: count }, async (_, i) => {
        try {
          const data = await (await fetch(`sounds/${name}-${i + 1}.mp3`)).arrayBuffer();
          const buffer = await context.decodeAudioData(data);
          if (!buffers.has(name)) buffers.set(name, []);
          buffers.get(name).push(buffer);
        } catch {
          /* a missing take is a quieter game, not a broken one */
        }
      }),
    ),
  );
  return loading;
}

/** Call from inside a tap or keypress handler. Safe to call every time. */
export function unlockAudio() {
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.connect(context.destination);
    void loadAll();
  }
  if (context.state === 'suspended') void context.resume();
}

/** Turns every game sound off or on (the speaker button). */
export function setMuted(muted) {
  if (master) master.gain.value = muted ? 0 : 1;
}

function play(name, volume = 1, { rate = 1 } = {}) {
  const takes = buffers.get(name);
  if (!context || !takes?.length) return;
  const source = context.createBufferSource();
  source.buffer = takes[Math.floor(Math.random() * takes.length)];
  source.playbackRate.value = rate * (0.95 + Math.random() * 0.1);
  const gain = context.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(master);
  source.start();
}

/** A game event's sound, by name. Unknown names are silent. */
export function playSound(name) {
  for (const [take, volume] of SOUNDS[name] ?? []) play(take, volume);
}

/** The coin drop, when a friend arrives. */
export function playCoin() {
  play('coin', 0.7);
}

let stepIndoors = false;
/** A footfall; `indoors` swaps pavement for carpet. */
export function playStep(indoors = stepIndoors) {
  stepIndoors = indoors;
  play(indoors ? 'step-carpet' : 'step-street', indoors ? 0.25 : 0.35);
}

/*
 * The room itself: a real arcade floor (a CC0 recording from Tokyo, see
 * public/sounds) on a loop, through a low-pass filter - outside, the walls
 * take the top off it; through the door it opens up.
 */
let ambience;

/** Starts the floor loop. Call after unlockAudio; safe to call again. */
export async function startAmbience(url) {
  if (!context || ambience) return;
  ambience = { gain: context.createGain(), filter: context.createBiquadFilter() };
  ambience.gain.gain.value = 0;
  ambience.filter.type = 'lowpass';
  ambience.filter.frequency.value = 700;
  ambience.filter.connect(ambience.gain).connect(master);
  try {
    const buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(ambience.filter);
    source.start();
  } catch {
    /* no recording: the arcade is simply quiet */
  }
}

/**
 * How loud the room is (0-1), and whether a wall is in the way. Glides there
 * rather than jumping, so walking through the door swells the sound.
 */
export function setAmbience(level, muffled) {
  if (!ambience) return;
  const t = context.currentTime;
  ambience.gain.gain.setTargetAtTime(level, t, 0.35);
  ambience.filter.frequency.setTargetAtTime(muffled ? 700 : 16000, t, 0.35);
}

/**
 * A looping recording under a game - the crowd round the ring. Returns a stop
 * function.
 */
export function startLoop(url, volume = 0.25) {
  if (!context) return () => {};
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  let source;
  let stopped = false;
  void fetch(url)
    .then((response) => response.arrayBuffer())
    .then((data) => context.decodeAudioData(data))
    .then((buffer) => {
      if (stopped) return;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
      gain.gain.setTargetAtTime(volume, context.currentTime, 0.6);
    })
    .catch(() => {});
  return () => {
    stopped = true;
    gain.gain.setTargetAtTime(0, context.currentTime, 0.2);
    source?.stop(context.currentTime + 0.8);
  };
}

/**
 * A kart engine: a recorded engine loop, pitched and swelled by speed.
 * `set(0..1, boosting)` every frame; `stop()` when the race closes.
 */
export function createEngine() {
  if (!context) return { set() {}, stop() {} };
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  let source;
  void fetch('sounds/engine-loop.mp3')
    .then((response) => response.arrayBuffer())
    .then((data) => context.decodeAudioData(data))
    .then((buffer) => {
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
    })
    .catch(() => {});
  return {
    set(speed, boosting) {
      const now = context.currentTime;
      source?.playbackRate.setTargetAtTime(0.55 + speed * 0.9 + (boosting ? 0.25 : 0), now, 0.08);
      gain.gain.setTargetAtTime(speed > 0.01 ? 0.12 + speed * 0.18 : 0.05, now, 0.1);
    },
    stop() {
      gain.gain.setTargetAtTime(0, context.currentTime, 0.05);
      source?.stop(context.currentTime + 0.3);
    },
  };
}
