/**
 * What a call shows, and what it lets you do, while a screen is being shared.
 *
 * Pulled out of the overlay so the decisions can be asserted without a browser.
 * Each of them is a rule somebody would otherwise have to re-derive from the
 * JSX every time the layout is touched.
 */

/**
 * The suffix a native screen connection joins under.
 *
 * A phone cannot capture its screen from the browser, so the shell does it and
 * publishes from a second connection - and LiveKit evicts the first participant
 * when a second joins under the same identity. So the screen is `<user>#screen`,
 * and everything that turns an identity into a person has to know that.
 *
 * Kept here rather than in the transport because the UI is what asks "whose
 * screen is this?", and the answer is a person, not a connection.
 */
export const SCREEN_SUFFIX = '#screen';

/** The person a room identity belongs to, whether it is them or their screen. */
export function personBehind(identity: string): string {
  return identity.endsWith(SCREEN_SUFFIX)
    ? identity.slice(0, -SCREEN_SUFFIX.length)
    : identity;
}

/** Whether this identity is somebody's screen rather than somebody. */
export function isScreenIdentity(identity: string): boolean {
  return identity.endsWith(SCREEN_SUFFIX);
}

/** Whose screen is the main content, if anybody's. */
export function primaryShare(
  screens: ReadonlyMap<string, MediaStream>,
): { userId: string; stream: MediaStream } | undefined {
  const first = [...screens.entries()][0];
  return first ? { userId: first[0], stream: first[1] } : undefined;
}

/**
 * Whether this device can capture a screen at all.
 *
 * ## Feature detection does not work here, and that is not our fault
 *
 * Chrome and Firefox on Android both ship `getDisplayMedia` and then reject
 * every call to it with `NotAllowedError` - the API is defined and not
 * implemented. `NotAllowedError` is also exactly what a person gets for opening
 * the picker and changing their mind, so the two are indistinguishable: PINGO
 * showed "couldn't start, try again" and somebody on a phone could press it for
 * the rest of their life.
 *
 * So the platform has to be asked instead of the API. It is the kind of check
 * that ages badly, which is why it is one function with the reason written
 * down: the day a mobile browser implements this, delete the `mobile` term.
 *
 * `native` is the way out rather than a workaround. Screen capture on a phone
 * is `MediaProjection` on Android and ReplayKit on iOS, which is what every
 * conferencing app uses, and it is a shell capability rather than a web one.
 */
export function canCaptureScreen(env: {
  /** `navigator.mediaDevices.getDisplayMedia` exists. Necessary, not sufficient. */
  hasDisplayMedia: boolean;
  /** A mobile browser, where the method above is a stub that always rejects. */
  mobile: boolean;
  /** A native shell that can capture the screen itself. */
  native: boolean;
}): boolean {
  if (env.native) return true;
  return env.hasDisplayMedia && !env.mobile;
}

/**
 * Whether the screen-share control should be offered at all.
 *
 * Video calls only - a voice call has no picture and a share button on one
 * would be a promise the layout cannot keep. And only where the transport can
 * carry a second video track: the peer-to-peer fallback has one sender per
 * person, built for exactly one camera, so the control is hidden rather than
 * offered and then refused. `supported` is the same rule applied to the device
 * - see `canCaptureScreen`.
 *
 * Note what is *not* here: the microphone and the camera. Somebody joins with
 * both off precisely so they can show everybody something, and requiring either
 * would defeat the feature.
 */
export function canOfferScreenShare(state: {
  kind: 'voice' | 'video';
  onRoom: boolean;
  incoming: boolean;
  supported: boolean;
}): boolean {
  return state.kind === 'video' && state.onRoom && !state.incoming && state.supported;
}

/**
 * What fills the main area.
 *
 * A shared screen outranks a camera, including this device's own: somebody
 * sharing is showing the room something, and the faces become context around
 * it. Below that it is the old rule - a remote camera fills the background on a
 * one-to-one video call, and everything else keeps the avatar layout rather
 * than showing a black rectangle.
 */
export function stageContent(state: {
  hasShare: boolean;
  kind: 'voice' | 'video';
  isGroup: boolean;
  remoteHasVideo: boolean;
}): 'share' | 'remote-video' | 'avatars' {
  if (state.hasShare) return 'share';
  if (state.kind === 'video' && !state.isGroup && state.remoteHasVideo) return 'remote-video';
  return 'avatars';
}
