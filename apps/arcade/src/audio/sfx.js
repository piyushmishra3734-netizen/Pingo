/**
 * The arcade's sounds, synthesised - no audio file to fetch or decode.
 *
 * ## Unlocking
 *
 * Browsers refuse to make a sound until the page has been touched, and they
 * refuse silently. So the AudioContext is created on the first real gesture -
 * sitting down - and every sound after that has somewhere to play. A sound
 * asked for before that simply does not happen, which is the only thing the
 * browser would have allowed anyway.
 */

let context;

/** Call from inside a tap or keypress handler. Safe to call every time. */
export function unlockAudio() {
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
}

/**
 * The coin drop: two square-wave notes, B5 then E6, the shape every arcade
 * coin sound has had since the 1980s. Half a second, quiet enough not to
 * startle someone on a bus.
 */
export function playCoin() {
  if (!context) return;
  const t = context.currentTime;

  const oscillator = context.createOscillator();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(987.77, t); // B5
  oscillator.frequency.setValueAtTime(1318.51, t + 0.08); // E6

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
  gain.gain.setValueAtTime(0.16, t + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(t);
  oscillator.stop(t + 0.52);
}

let noise;

/** 0.4 s of white noise, made once: the raw material of every hit. */
function noiseBuffer() {
  if (!noise) {
    noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.4), context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** Noise through a band-pass: low and long is a thud, high and short a tap. */
function burst(frequency, seconds, peak) {
  const t = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer();
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = 0.8;
  const gain = context.createGain();
  gain.gain.setValueAtTime(peak, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(t);
  source.stop(t + seconds + 0.02);
}

/** A crowd roar: looped noise, low and wide, swelling up and dying away. */
function crowd(seconds, peak) {
  const t = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer();
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.4;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.25);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(t);
  source.stop(t + seconds + 0.05);
}

/** A pitch sweep - a thump going down, a flourish going up. */
function sweep(from, to, seconds, peak, type = 'square') {
  const t = context.currentTime;
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, t);
  oscillator.frequency.exponentialRampToValueAtTime(to, t + seconds);
  const gain = context.createGain();
  gain.gain.setValueAtTime(peak, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(t);
  oscillator.stop(t + seconds + 0.02);
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
  ambience.filter.connect(ambience.gain).connect(context.destination);
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

/** A soft footfall: a short low thud, quieter than anything a game says. */
export function playStep() {
  if (!context) return;
  burst(150 + Math.random() * 40, 0.07, 0.07);
}

/**
 * The brawler's sounds, by the event names bout.js emits. Synthesised like
 * the coin: nothing to download, and a hit is heard the step it lands.
 */
export function playSound(name) {
  if (!context) return;
  if (name === 'hit') burst(1100, 0.08, 0.3);
  else if (name === 'hit-heavy') {
    burst(700, 0.14, 0.4);
    sweep(140, 60, 0.12, 0.25, 'sine');
  } else if (name === 'block') burst(2600, 0.05, 0.15);
  else if (name === 'ko') sweep(520, 90, 0.7, 0.18);
  else if (name === 'fight' || name === 'bell') {
    sweep(1320, 1250, 0.9, 0.14, 'triangle');
    sweep(2640, 2500, 0.5, 0.05, 'sine');
  } else if (name === 'star-hit') {
    burst(500, 0.25, 0.5);
    sweep(180, 40, 0.3, 0.35, 'sine');
    crowd(1.4, 0.22);
  } else if (name === 'down') {
    sweep(120, 45, 0.35, 0.35, 'sine');
    crowd(1.8, 0.25);
  } else if (name === 'count') sweep(900, 880, 0.12, 0.09, 'square');
  else if (name === 'star') {
    sweep(880, 1760, 0.15, 0.08, 'triangle');
    setTimeout(() => sweep(1320, 2640, 0.2, 0.07, 'triangle'), 90);
  } else if (name === 'cheer') crowd(1.6, 0.2);
  else if (name === 'door') burst(450, 0.4, 0.1);
}
