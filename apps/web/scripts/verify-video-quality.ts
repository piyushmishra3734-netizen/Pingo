/**
 * What a video call actually asks for, and the ways it stopped asking.
 *
 * Every failure here is silent. A camera opened without a frame rate hands back
 * whatever it likes, a republish without encoding options is re-encoded on the
 * SDK's guesses, and a call that forgets it wanted HD simply looks worse - with
 * nothing anywhere reporting a problem. So these are asserted rather than left
 * to be noticed.
 *
 * Run with `pnpm verify:video-quality`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DEFAULT_PREFERENCES } from '@pingo/core';

// -- HD is the default, now that an SFU carries the call --------------------

/*
 * This was `false`, which made every call 640x480 while audio shipped HD. The
 * reason was the peer-to-peer mesh charging the sender one upload per person;
 * LiveKit fans out a single upload, so the conservative default was answering
 * a question nobody asks any more.
 */
assert.equal(
  DEFAULT_PREFERENCES.calls.hdVideo,
  true,
  'video calls capture HD unless somebody turns it off to save data',
);
assert.equal(DEFAULT_PREFERENCES.calls.hdAudio, true, 'and audio, as before');

// -- The call remembers the choice, not just the caller ---------------------

const service = await readFile(
  // Run from the repo root - see the `verify:video-quality` script.
  resolve(process.cwd(), 'apps/web/src/lib/supabase/call-service.ts'),
  'utf8',
);

const constraints = service.slice(
  service.indexOf('#videoConstraints(options'),
  service.indexOf('async #openMedia('),
);

/*
 * `switchCamera` and `#startCamera` open a camera mid-call with no options to
 * pass. Reading `options?.hdVideo` alone meant both fell through to the
 * standard-definition branch: flipping to the rear camera dropped a 720p call
 * to 640x480 for the rest of its length, and it never came back.
 */
assert.match(
  constraints,
  /options\?\.hdVideo \?\? this\.#hdVideo/,
  'the call remembers whether it wanted HD, for every camera it opens later',
);
assert.match(
  constraints,
  /frameRate:\s*\{\s*ideal:\s*30/,
  'a camera that is not asked for a frame rate will hand back fifteen',
);

// And the field is actually kept up to date when media opens.
assert.match(
  service,
  /this\.#hdVideo = options\?\.hdVideo !== false/,
  '#hdVideo is set from the call options, not left at its initial value',
);

// -- The camera is published on stated settings, both times -----------------

const room = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/livekit/room.ts'),
  'utf8',
);

assert.match(
  room,
  /degradationPreference:\s*'maintain-framerate'/,
  'under congestion a call gives up resolution, never frames - a face at 8fps ' +
    'reads as a broken connection',
);
assert.match(room, /maxBitrate:\s*1_700_000/, 'the bitrate is stated rather than guessed');

/*
 * Twice: once when the call starts and once when the camera is flipped.
 * `replaceVideo` republishes, and a republish without these options is
 * re-encoded on the SDK's guesses - so flipping the camera used to quietly
 * change the quality of the call.
 */
const joinBody = room.slice(room.indexOf('async join('), room.indexOf('setMicrophoneEnabled('));
const replaceBody = room.slice(
  room.indexOf('async replaceVideo('),
  room.indexOf('hasCamera()'),
);

/*
 * The spread, not the word. Both of these bodies mention `CAMERA_PUBLISH` in a
 * comment, so asserting on the name alone passes for code that no longer uses
 * it - which is exactly what happened the first time this was written.
 */
// The first publish reaches it through the audio/video ternary; the flip
// spreads it directly. Both are uses; neither is a comment.
assert.match(
  joinBody,
  /\?\s*CAMERA_PUBLISH\s*:/,
  'the first publish states its settings',
);
assert.match(
  replaceBody,
  /\.\.\.CAMERA_PUBLISH\b/,
  'and so does the camera flip, which republishes the track',
);

// -- Dynacast is on; adaptive stream is deliberately not --------------------

assert.match(
  room,
  /dynacast:\s*true/,
  'simulcast layers nobody watches are not uploaded - free uplink on a phone',
);
assert.match(
  room,
  /adaptiveStream:\s*false/,
  'incoming tracks are not dropped to the element size: coming back up is a ' +
    'visible beat, and this is a call between two full-screen faces',
);

console.log('video quality: ok');
