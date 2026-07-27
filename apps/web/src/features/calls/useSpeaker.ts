import { useCallback, useEffect, useState } from 'react';

/**
 * Routing call audio to the loudspeaker.
 *
 * ## What the web can and cannot do here
 *
 * A native app asks the OS to switch the audio route. The web has no such call.
 * The nearest thing is `HTMLMediaElement.setSinkId`, which picks an *output
 * device* — so on a laptop this genuinely moves audio between speakers and a
 * headset, and on a phone browser it usually does not exist at all, because the
 * handset earpiece and loudspeaker are not exposed as separate devices.
 *
 * That leaves two honest options: pretend, or say nothing. This returns
 * `undefined` where routing is impossible, so the toggle is absent rather than
 * present and inert — the rule this codebase keeps arriving at.
 *
 * ## Why the device list is only read once a call is up
 *
 * `enumerateDevices` returns unlabelled entries until microphone permission has
 * been granted, and a call has granted it by definition. Asking earlier would
 * produce a list of anonymous ids nobody could choose between.
 */

export interface Speaker {
  on: boolean;
  toggle: () => void;
}

/** Elements only gained `setSinkId` recently, and not everywhere. */
type SinkCapable = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

export function useSpeaker(
  audio: React.RefObject<HTMLAudioElement | null>,
  active: boolean,
): Speaker | undefined {
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [on, setOn] = useState(false);

  const supported =
    typeof window !== 'undefined' &&
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype &&
    Boolean(navigator.mediaDevices?.enumerateDevices);

  useEffect(() => {
    if (!supported || !active) return;

    let cancelled = false;
    const read = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (cancelled) return;
          setOutputs(devices.filter((device) => device.kind === 'audiooutput'));
        })
        .catch(() => undefined);
    };

    read();
    // Plugging in headphones mid-call changes what "speaker" means.
    navigator.mediaDevices.addEventListener('devicechange', read);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', read);
    };
  }, [supported, active]);

  /*
   * The loudspeaker is whichever output is not the default.
   *
   * Browsers do not label devices by role, so there is no "is this the
   * earpiece" to ask. With exactly one output there is nothing to switch
   * between and the control should not appear at all.
   */
  const alternate = outputs.find((device) => device.deviceId !== 'default');
  const routable = supported && outputs.length > 1 && Boolean(alternate);

  const toggle = useCallback(() => {
    const element = audio.current as SinkCapable | null;
    if (!element?.setSinkId || !alternate) return;

    const next = !on;
    void element
      .setSinkId(next ? alternate.deviceId : 'default')
      .then(() => setOn(next))
      .catch(() => {
        /*
         * Refused — the device disappeared, or the browser declined. The state
         * is left alone rather than flipped, so the button keeps describing
         * where the audio actually is.
         */
      });
  }, [audio, alternate, on]);

  // A new call starts on the default route, whatever the last one ended on.
  useEffect(() => {
    if (!active) setOn(false);
  }, [active]);

  return routable ? { on, toggle } : undefined;
}
