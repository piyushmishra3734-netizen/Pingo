/**
 * The spoken line a network plays when a call does not connect.
 *
 * ## Why speech synthesis rather than a recording
 *
 * The real announcements are recordings owned by carriers, and shipping a
 * generic one means an audio asset per language for a sentence nobody hears
 * twice. `speechSynthesis` is in every browser, costs nothing to download, and
 * speaks whatever language the device is already set to.
 *
 * It is genuinely optional: no voices installed, a muted device, or a browser
 * that refuses to speak before a gesture all end with nothing said. The overlay
 * shows the same sentence in text at the same moment, so the information never
 * depends on the audio arriving.
 */

export type CallFailure = 'unreachable' | 'no-answer';

/** What each failure says, and what the screen shows beside it. */
export const FAILURE_TEXT: Record<CallFailure, string> = {
  unreachable:
    'The person you are calling is not reachable right now. Please try again later.',
  'no-answer': 'Your call was not answered. Please try again later.',
};

/**
 * Speaks the line, and resolves when it has finished or failed.
 *
 * Resolving either way matters: the caller uses this to decide when to close
 * the overlay, and a promise that never settles because a device has no voices
 * would leave a failed call on screen for good.
 */
export function announce(failure: CallFailure): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      resolve();
      return;
    }

    try {
      // Anything already queued belongs to a previous call.
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(FAILURE_TEXT[failure]);
      // A shade slower and lower than default: the tone these announcements
      // have everywhere, and easier to catch once through.
      utterance.rate = 0.95;
      utterance.pitch = 0.9;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      /*
       * A hard ceiling, because `onend` is not guaranteed. Several browsers
       * drop it when the tab loses focus mid-sentence, and without this the
       * call overlay would wait on an event that is never coming.
       */
      window.setTimeout(resolve, 6000);

      synth.speak(utterance);
    } catch {
      resolve();
    }
  });
}

/** Stops anything still being said - a new call must not talk over itself. */
export function stopAnnouncing(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* Nothing was speaking. */
  }
}
