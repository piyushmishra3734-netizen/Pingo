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
  else if (name === 'fight') sweep(440, 880, 0.18, 0.12);
}
