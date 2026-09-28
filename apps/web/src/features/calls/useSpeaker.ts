import { useCallback, useEffect, useState } from 'react';

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
 * ## Web Audio only while the boost is on
 *
 * This used to route *every* one-to-one call through an AudioContext, with the
 * `<audio>` element silenced underneath it, whether or not anybody had asked to
 * be louder. Three things went wrong with that, all heard as a bad call:
 *
 *   - A context that starts suspended - iOS, or a stream that arrives long
 *     after the tap that placed the call - plays nothing, while the element
 *     that could have played it sits at volume zero.
 *   - The source is bound to the track it was built from. When the room
 *     re-subscribes after a network blip it hands over a new track, and the
 *     call went silent while the screen still said Connected.
 *   - On Android, Web Audio is a separate, larger-buffered output from the one
 *     WebRTC plays calls on, and under load it is the one that crackles.
 *
 * So by default the element plays the call, exactly as WebRTC intends, and the
 * graph exists only for the length of a boost - built on the tap, which is
 * also the gesture that lets its context start. The element stays attached
 * throughout (some browsers only keep a remote stream flowing while it is), and
 * is silenced only once the context is definitely running.
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
   * The choice outlives the audio: pressing it before the call connects means
   * "be loud when we connect", applied the moment the stream arrives.
   */
  const [on, setOn] = useState(false);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.volume = 1;
    if (!on || !stream || stream.getAudioTracks().length === 0) return;

    let ctx: AudioContext | undefined;
    try {
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const volume = ctx.createGain();
      volume.gain.value = BOOST;

      /*
       * The same limiter the ringtone uses: a voice amplified past 1.0 clips,
       * and clipped speech is harder to understand than quiet speech. It is
       * only in the path while the boost is, which is now the only time there
       * is a path at all - at unity it compressed ordinary speech 12:1 and was
       * heard as pumping and crushed consonants.
       */
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      source.connect(volume).connect(limiter).connect(ctx.destination);

      const live = ctx;
      // Suspended later - the app sent to the background - hands the sound back.
      live.onstatechange = () => { element.volume = live.state === 'running' ? 0 : 1; };
      void live
        .resume()
        .then(() => {
          if (live.state === 'running') element.volume = 0;
        })
        .catch(() => undefined);
    } catch {
      // No Web Audio. The element keeps playing at normal loudness.
      element.volume = 1;
    }

    return () => {
      element.volume = 1;
      void ctx?.close().catch(() => undefined);
    };
  }, [audio, stream, on]);

  const toggle = useCallback(() => setOn((value) => !value), []);

  // Reset between calls: each one starts from the earpiece.
  useEffect(() => {
    if (!active) setOn(false);
  }, [active]);

  return active ? { on, toggle } : undefined;
}
