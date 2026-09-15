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
