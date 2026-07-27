/**
 * Ring tones, synthesised rather than played from a file.
 *
 * ## Why not an audio file
 *
 * Every recognisable ringtone is somebody's copyright, and a generic one still
 * means shipping and decoding an asset for a sound that is two sine waves and a
 * timer. The classic telephone ring *is* two sine waves — so it is generated,
 * which costs nothing to download, cannot be mis-licensed, and stays in tune at
 * any sample rate.
 *
 * ## Two different sounds, on purpose
 *
 * | | Frequencies | Cadence | Heard by |
 * | --- | --- | --- | --- |
 * | Ringback | 440 + 480 Hz | 2s on, 4s off | the caller |
 * | Ringtone | 440 + 480 Hz | 0.4s on/off ×2, then 2s off | the callee |
 *
 * Ringback is the tone a phone network plays back to *you* so you know the far
 * end is ringing; the callee hears a faster double-pulse. Using one sound for
 * both would make an incoming call and an outgoing one indistinguishable with
 * the screen face-down, which is precisely when it matters.
 *
 * ## Autoplay
 *
 * An `AudioContext` created before a user gesture starts suspended. Placing a
 * call is a gesture, so the caller's ringback always plays. An *incoming* call
 * is not, so on a page the user has not touched the context stays suspended and
 * this makes no sound — the browser's rule, not a bug here. `resume()` is
 * attempted anyway, because a page that has been interacted with once is
 * allowed.
 */

export type RingKind = 'ringback' | 'ringtone' | 'busy';

/** The two tones every analogue telephone ring is built from. */
interface Cadence {
  /** Seconds of tone, then seconds of silence, repeating. */
  pattern: number[];
  gain: number;
}

const CADENCES: Record<RingKind, Cadence> = {
  // North American ringback: a long burst, a long gap.
  ringback: { pattern: [2, 4], gain: 0.06 },
  // Two short pulses then a rest — the classic double ring.
  ringtone: { pattern: [0.4, 0.2, 0.4, 2], gain: 0.12 },
  /*
   * Fast busy, the tone a network plays when a call cannot be completed.
   * Twice the speed of a ring and unmistakably not one.
   */
  busy: { pattern: [0.25, 0.25], gain: 0.09 },
};

/**
 * What each kind is built from.
 *
 * Ringback and busy are the telephone network's own two-sine-wave tones,
 * because imitating them badly is worse than reproducing them exactly.
 *
 * The incoming ringtone is not. A caller and a callee were hearing the same
 * 440+480 Hz pair differing only in rhythm, so an incoming call and an outgoing
 * one sounded alike with the phone face-down — the one moment the difference
 * matters most. So an incoming call plays a short rising figure instead: a
 * musical phrase reads instantly as "answer me" rather than "waiting".
 */
const VOICES: Record<RingKind, number[][]> = {
  ringback: [[440, 480], [440, 480]],
  busy: [[480, 620], [480, 620]],
  // A major triad walked upward, one note per pulse of the cadence.
  ringtone: [
    [587.33, 880], // D5 + A5
    [739.99, 1108.73], // F#5 + C#6
  ],
};

export interface Ringer {
  stop: () => void;
}

/**
 * Starts ringing, and returns the handle that stops it.
 *
 * Always returns a handle, even when the audio context refuses to start. A
 * caller that has to check whether sound actually happened would end up leaking
 * the timer that schedules it.
 */
export function startRinging(kind: RingKind): Ringer {
  let context: AudioContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  try {
    context = new AudioContext();
  } catch {
    return { stop: () => undefined };
  }

  void context.resume().catch(() => undefined);

  const { pattern, gain } = CADENCES[kind];

  /** One burst: both tones, with a short fade so it does not click. */
  const burst = (duration: number, pulse: number) => {
    if (!context || stopped) return;

    const envelope = context.createGain();
    envelope.connect(context.destination);

    const now = context.currentTime;
    /*
     * Ramped, not switched. A gain that jumps from 0 to full produces a
     * discontinuity in the waveform, which a speaker reproduces as a click at
     * the start of every single ring.
     */
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(gain, now + 0.02);
    envelope.gain.setValueAtTime(gain, now + duration - 0.02);
    envelope.gain.linearRampToValueAtTime(0, now + duration);

    for (const frequency of VOICES[kind][pulse % VOICES[kind].length]!) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(envelope);
      oscillator.start(now);
      oscillator.stop(now + duration);
    }
  };

  // Walks the cadence: even entries ring, odd entries are silence.
  let step = 0;
  const tick = () => {
    if (stopped) return;
    const duration = pattern[step % pattern.length]!;
    if (step % 2 === 0) burst(duration, step / 2);
    step += 1;
    timer = setTimeout(tick, duration * 1000);
  };
  tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Closing tears down the oscillators still scheduled, so a ring cannot
      // outlive the call by up to two seconds.
      void context?.close().catch(() => undefined);
      context = undefined;
    },
  };
}
