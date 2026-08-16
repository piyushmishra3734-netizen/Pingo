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
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  canCaptureScreen,
  canOfferScreenShare,
  isScreenIdentity,
  personBehind,
  primaryShare,
  stageContent,
} from '../src/features/calls/screen-share-rules.js';

// -- The control does not depend on a camera or a microphone ----------------

const on = { onRoom: true, incoming: false, supported: true } as const;

assert.equal(
  canOfferScreenShare({ kind: 'video', ...on }),
  true,
  'a connected video call offers the control',
);

// Nothing above mentions mic or camera state, and that is the point: there is
// no state of either that can take the control away.

assert.equal(
  canOfferScreenShare({ kind: 'voice', ...on }),
  false,
  'a voice call has no picture to share into',
);
assert.equal(
  canOfferScreenShare({ kind: 'video', onRoom: false, incoming: false, supported: true }),
  false,
  'the peer-to-peer fallback cannot carry a second video track',
);
assert.equal(
  canOfferScreenShare({ kind: 'video', onRoom: true, incoming: true, supported: true }),
  false,
  'a call still ringing has nothing to share into yet',
);
assert.equal(
  canOfferScreenShare({ kind: 'video', onRoom: true, incoming: false, supported: false }),
  false,
  'a device that cannot capture is not offered a button that cannot work',
);

// -- What "can capture" means, given a lying API ---------------------------

/*
 * Chrome and Firefox on Android define `getDisplayMedia` and reject every call
 * to it with `NotAllowedError` - which is also what somebody gets for closing
 * the picker. The two cannot be told apart, so the presence of the method is
 * not evidence of anything and the platform has to be asked instead.
 */
assert.equal(
  canCaptureScreen({ hasDisplayMedia: true, mobile: true, native: false }),
  false,
  'a mobile browser ships the method and never honours it',
);
assert.equal(
  canCaptureScreen({ hasDisplayMedia: true, mobile: false, native: false }),
  true,
  'a desktop browser with the method can capture',
);
assert.equal(
  canCaptureScreen({ hasDisplayMedia: false, mobile: false, native: false }),
  false,
  'no method, no capture',
);
// The way out on a phone is the shell, not the browser - MediaProjection on
// Android, ReplayKit on iOS. When that exists, nothing else matters.
assert.equal(
  canCaptureScreen({ hasDisplayMedia: false, mobile: true, native: true }),
  true,
  'a native shell that can capture overrides every browser limitation',
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

// -- A direct call is never a roster ---------------------------------------

/*
 * A source check, for the layout bug the room migration caused.
 *
 * `stageContent` above draws one big picture for a direct call and a grid of
 * faces for a group, and it decides which by whether the call has
 * `participants`. A direct call carried by LiveKit arrives on the same
 * `invite` signal a group does, and the handler filled `participants` in for
 * both - so every LiveKit video call looked like a group of one, and the other
 * person's camera played inside the little round tile where their avatar goes
 * instead of behind the whole call.
 *
 * Only the receiver saw it, because the caller builds its own state and never
 * set the field. That is why it read as "my video shows up in the wrong place"
 * rather than as a layout that was obviously broken.
 */
const service = await readFile(
  // Run from the repo root - see the `verify:screen-share` script.
  resolve(process.cwd(), 'apps/web/src/lib/supabase/call-service.ts'),
  'utf8',
);

const invite = service.slice(service.indexOf("case 'invite'"), service.indexOf("case 'join'"));
assert.ok(
  /participants:\s*signal\.direct\s*\n?\s*\?\s*undefined/.test(invite),
  'a direct invite must not build a roster - the layout reads that as a group',
);

// And answering must not depend on the roster it no longer has. An invite
// carries no SDP; that absence is what says "join a room" rather than "answer".
const answer = service.slice(service.indexOf('async answer('));
assert.ok(
  /if \(!this\.#pendingOffer\) return this\.#answerGroup\(/.test(answer),
  'a ring with no offer is a room to join, whoever it is from',
);

// -- The picker offers every surface, not just tabs ------------------------

/*
 * What the picker contains is decided entirely by the constraints, and the way
 * to get entire screen, window and tab is to name none of them. Two options
 * take that away, silently and without an error:
 *
 *   - `displaySurface` narrows the dialog to one kind of surface;
 *   - `preferCurrentTab` narrows it to exactly one entry.
 *
 * Neither ever belongs here, and both are the sort of thing that gets added
 * while debugging something else and left behind. This is the assertion that
 * notices.
 */
const room = await readFile(
  // Run from the repo root - see the `verify:screen-share` script.
  resolve(process.cwd(), 'apps/web/src/lib/livekit/room.ts'),
  'utf8',
);

const start = room.indexOf('async startScreenShare(');
assert.notEqual(start, -1, 'startScreenShare still exists');
const share = room.slice(start, room.indexOf('async stopScreenShare('));

for (const narrowing of ['displaySurface', 'preferCurrentTab']) {
  assert.ok(
    !new RegExp(`^\\s*${narrowing}\\s*:`, 'm').test(share),
    `${narrowing} would take entire screen and window out of the picker`,
  );
}

// And the widening options are actually asked for.
assert.match(share, /surfaceSwitching:\s*'include'/, 'the user can switch surface mid-share');
assert.match(share, /systemAudio:\s*'include'/, 'system audio is offered where it exists');
// The one exclusion, and it removes a single entry rather than a whole class.
assert.match(share, /selfBrowserSurface:\s*'exclude'/, "PINGO's own tab is not offered");

// -- A screen is a connection; the sharer is a person -----------------------

/*
 * On Android the screen joins the room as its own participant, because
 * MediaProjection produces frames in the app and there is no way to hand them
 * to the WebView's WebRTC stack. LiveKit evicts a participant when a second one
 * joins under the same identity, so the screen has to be `<user>#screen` - and
 * every place that turns an identity into a name has to undo that, or the call
 * says "piyush#screen is presenting".
 */
assert.equal(personBehind('abc-123#screen'), 'abc-123');
assert.equal(personBehind('abc-123'), 'abc-123', 'an ordinary identity is left alone');
assert.equal(isScreenIdentity('abc-123#screen'), true);
assert.equal(isScreenIdentity('abc-123'), false);
// A name that merely contains the word is not a screen.
assert.equal(isScreenIdentity('screen-abc'), false);

console.log('screen share: ok');
