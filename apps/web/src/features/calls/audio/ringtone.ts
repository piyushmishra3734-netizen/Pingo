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

export type RingKind = 'ringback' | 'ringtone';

/** The two tones every analogue telephone ring is built from. */
const TONES = [440, 480] as const;

interface Cadence {
  /** Seconds of tone, then seconds of silence, repeating. */
  pattern: number[];
  gain: number;
}

const CADENCES: Record<RingKind, Cadence> = {
  // North American ringback: a long burst, a long gap.
  ringback: { pattern: [2, 4], gain: 0.06 },
  // Two short pulses then a rest — the "ring ring" everyone recognises.
  ringtone: { pattern: [0.4, 0.2, 0.4, 2], gain: 0.12 },
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
  const burst = (duration: number) => {
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

    for (const frequency of TONES) {
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
    if (step % 2 === 0) burst(duration);
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
