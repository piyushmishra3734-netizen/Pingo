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

console.log('screen share: ok');
