/**
 * What a call shows, and what it lets you do, while a screen is being shared.
 *
 * Pulled out of the overlay so the decisions can be asserted without a browser.
 * Each of them is a rule somebody would otherwise have to re-derive from the
 * JSX every time the layout is touched.
 */

/** Whose screen is the main content, if anybody's. */
export function primaryShare(
  screens: ReadonlyMap<string, MediaStream>,
): { userId: string; stream: MediaStream } | undefined {
  const first = [...screens.entries()][0];
  return first ? { userId: first[0], stream: first[1] } : undefined;
}

/**
 * Whether the screen-share control should be offered at all.
 *
 * Video calls only - a voice call has no picture and a share button on one
 * would be a promise the layout cannot keep. And only where the transport can
 * carry a second video track: the peer-to-peer fallback has one sender per
 * person, built for exactly one camera, so the control is hidden rather than
 * offered and then refused.
 *
 * Note what is *not* here: the microphone and the camera. Somebody joins with
 * both off precisely so they can show everybody something, and requiring either
 * would defeat the feature.
 */
export function canOfferScreenShare(state: {
  kind: 'voice' | 'video';
  onRoom: boolean;
  incoming: boolean;
}): boolean {
  return state.kind === 'video' && state.onRoom && !state.incoming;
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
