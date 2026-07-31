import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speaker mode: making the other person louder.
 *
 * ## Why this boosts gain rather than switching device
 *
 * The first attempt used `setSinkId`, which picks an output *device*. That is
 * the closest thing the web has to a native "switch audio route", and on a
 * phone it is useless: browsers do not expose the earpiece and the loudspeaker
 * as separate devices, so the control never appeared on the one platform that
 * wanted it.
 *
 * What someone means by "speaker" is almost always *louder* - the button exists
 * so a call can be heard at arm's length. That is a gain problem, not a routing
 * one, and gain works in every browser.
 *
 * ## Why the audio element is silenced rather than removed
 *
 * The remote stream stays attached to the `<audio>` element with its volume at
 * zero. Several browsers only keep a `MediaStream` flowing while it is attached
 * to a media element, so detaching it to play through Web Audio instead can
 * silence the call entirely. Element for the plumbing, Web Audio for the sound.
 *
 * If Web Audio cannot start at all, the element's volume is restored and the
 * call is audible at normal loudness with no toggle offered - quieter than
 * intended beats silent.
 */

/** Roughly three times louder. Past this the limiter is working constantly. */
const BOOST = 3.2;

export interface Speaker {
  on: boolean;
  toggle: () => void;
}

export function useSpeaker(
  audio: React.RefObject<HTMLAudioElement | null>,
  stream: MediaStream | undefined,
  /** A call is up. The control is offered from this moment, not from connect. */
  active: boolean,
): Speaker | undefined {
  /*
   * The choice outlives the audio.
   *
   * The button is offered the moment a call starts, which is before there is
   * any remote sound to amplify - pressing it then means "be loud when we
   * connect", and this is what remembers that so the gain can be applied the
   * instant the stream arrives.
   */
  const [on, setOn] = useState(false);

  const context = useRef<AudioContext | undefined>(undefined);
  const gain = useRef<GainNode | undefined>(undefined);

  useEffect(() => {
    const element = audio.current;
    if (!stream || !element) return;

    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => undefined);

      const source = ctx.createMediaStreamSource(stream);
      const volume = ctx.createGain();
      volume.gain.value = 1;

      /*
       * The same limiter the ringtone uses, and for the same reason: a voice
       * amplified past 1.0 clips, and clipped speech is harder to understand
       * than quiet speech. This keeps the peaks in check so the boost adds
       * loudness rather than distortion.
       */
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;

      source.connect(volume).connect(limiter).connect(ctx.destination);

      context.current = ctx;
      gain.current = volume;

      // Whatever was chosen before the stream existed applies now.
      volume.gain.value = on ? BOOST : 1;

      // Silenced only once Web Audio is definitely carrying the sound.
      element.volume = 0;
    } catch {
      /*
       * No Web Audio. The element keeps playing at its normal volume, so the
       * call is still audible - just not boostable. The control stays visible
       * because the call is still live, and pressing it simply does nothing
       * this once, which is better than a button that vanishes mid-call.
       */
      element.volume = 1;
    }

    return () => {
      gain.current = undefined;
      void context.current?.close().catch(() => undefined);
      context.current = undefined;
      // Handed back to the element for whatever plays next.
      if (element) element.volume = 1;
    };
  }, [audio, stream]);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);

    const volume = gain.current;
    // Pressed before the call connected. The state is kept and applied by the
    // effect above the moment the remote stream arrives.
    if (!volume || !context.current) return;

    /*
     * Ramped rather than set. A gain that jumps produces a step in the
     * waveform, heard as a click in the middle of somebody's sentence.
     */
    volume.gain.setTargetAtTime(next ? BOOST : 1, context.current.currentTime, 0.02);
  }, [on]);

  // Reset between calls: each one starts from the earpiece.
  useEffect(() => {
    if (!active) setOn(false);
  }, [active]);

  return active ? { on, toggle } : undefined;
}
