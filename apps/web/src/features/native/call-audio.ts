import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Telling Android that a call is a call.
 *
 * A WebView plays WebRTC audio like any other page audio: on the music stream,
 * at whatever the media volume happens to be. So the volume keys during a call
 * moved the same slider as YouTube, the in-call volume curve never applied, and
 * people turned their media volume up to hear each other.
 *
 * `MODE_IN_COMMUNICATION` on the native side moves playback to the voice-call
 * stream, which Android remembers separately and starts far louder for speech,
 * and turns on the platform's own echo canceller. See `CallAudioPlugin`.
 *
 * Every call here is a no-op on the web, where the browser owns routing and
 * there is nothing to switch.
 */

interface CallAudioPlugin {
  start(options: { speaker: boolean }): Promise<void>;
  setSpeaker(options: { on: boolean }): Promise<void>;
  stop(): Promise<void>;
}

const plugin = registerPlugin<CallAudioPlugin>('CallAudio');

const native = (): boolean => Capacitor.isNativePlatform();

/**
 * Never throws. Audio routing failing is not a reason to fail a call - the
 * call still works at the wrong volume, which is where it was before this
 * existed.
 */
export async function startCallAudio(speaker = true): Promise<void> {
  if (!native()) return;
  try {
    await plugin.start({ speaker });
  } catch {
    // Wrong volume beats no call.
  }
}

export async function setCallSpeaker(on: boolean): Promise<void> {
  if (!native()) return;
  try {
    await plugin.setSpeaker({ on });
  } catch {
    // Ignored for the same reason.
  }
}

/**
 * Put the phone back. A device left in communication mode plays every later
 * notification and voice note out of the earpiece at a whisper, and nothing in
 * the app would explain why - so this runs on every teardown path, including
 * the ones that got there by failing.
 */
export async function stopCallAudio(): Promise<void> {
  if (!native()) return;
  try {
    await plugin.stop();
  } catch {
    // Nothing further to try.
  }
}
