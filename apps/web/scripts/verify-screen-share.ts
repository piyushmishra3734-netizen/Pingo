/**
 * The rules that make screen sharing usable with the camera and microphone off.
 *
 * The acceptance criterion for this feature is a person joining a video call
 * with both switched off, sharing their screen, and everybody else seeing it.
 * That is one assertion here, and it is the one that would break first if the
 * control ever started depending on media the sharer does not have.
 *
 * Run with `pnpm verify:screen-share`.
 */
import assert from 'node:assert/strict';

import {
  canOfferScreenShare,
  primaryShare,
  stageContent,
} from '../src/features/calls/screen-share-rules.js';

// -- The control does not depend on a camera or a microphone ----------------

assert.equal(
  canOfferScreenShare({ kind: 'video', onRoom: true, incoming: false }),
  true,
  'a connected video call offers the control',
);

// Nothing above mentions mic or camera state, and that is the point: there is
// no state of either that can take the control away.

assert.equal(
  canOfferScreenShare({ kind: 'voice', onRoom: true, incoming: false }),
  false,
  'a voice call has no picture to share into',
);
assert.equal(
  canOfferScreenShare({ kind: 'video', onRoom: false, incoming: false }),
  false,
  'the peer-to-peer fallback cannot carry a second video track',
);
assert.equal(
  canOfferScreenShare({ kind: 'video', onRoom: true, incoming: true }),
  false,
  'a call still ringing has nothing to share into yet',
);

// -- A shared screen is the main content ------------------------------------

assert.equal(
  stageContent({ hasShare: true, kind: 'video', isGroup: false, remoteHasVideo: true }),
  'share',
  'a share outranks a remote camera',
);
assert.equal(
  stageContent({ hasShare: true, kind: 'video', isGroup: true, remoteHasVideo: true }),
  'share',
  'and outranks a group roster',
);

// The share is gone: back to exactly what the call showed before, still connected.
assert.equal(
  stageContent({ hasShare: false, kind: 'video', isGroup: false, remoteHasVideo: true }),
  'remote-video',
);
assert.equal(
  stageContent({ hasShare: false, kind: 'video', isGroup: true, remoteHasVideo: true }),
  'avatars',
);

// Camera off on both sides, no share: the avatar layout, not a black rectangle.
assert.equal(
  stageContent({ hasShare: false, kind: 'video', isGroup: false, remoteHasVideo: false }),
  'avatars',
);

// -- One share is promoted, deterministically -------------------------------

// Node has no `MediaStream`; the rules never look inside one, so a stand-in
// with the right identity is all these assertions need.
const a = { id: 'a' } as unknown as MediaStream;
const b = { id: 'b' } as unknown as MediaStream;
const screens = new Map([
  ['user-a', a],
  ['user-b', b],
]);

const chosen = primaryShare(screens);
assert.equal(chosen?.userId, 'user-a', 'the first share is the one promoted');
assert.equal(chosen?.stream, a);

assert.equal(primaryShare(new Map()), undefined, 'no share, no stage content');

console.log('screen share: ok');
