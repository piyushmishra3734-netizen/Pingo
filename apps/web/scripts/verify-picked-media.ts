/**
 * What a picked file is, and what it should be called.
 *
 * The bug this covers: sending a song from the gallery. It went to the photo
 * composer to be drawn onto a canvas, or - when Android reported an audio-only
 * `.m4a` as `video/mp4`, which is genuinely what the container is - it opened
 * the video trimmer and arrived as a video with no picture in it.
 *
 * `probeKind` is not asserted here: it asks a `<video>` element to decode the
 * file, which needs a browser. Its inputs are these two functions, and they are.
 *
 * Run with `pnpm verify:picked-media`.
 */
import assert from 'node:assert/strict';

import { claimedKind, retypedAsAudio } from '../src/features/chat/picked-media.js';

const named = (name: string, type: string) => new File([new Uint8Array(1)], name, { type });

// The ordinary cases, decided by the type.
assert.equal(claimedKind(named('holiday.jpg', 'image/jpeg')), 'image');
assert.equal(claimedKind(named('clip.mp4', 'video/mp4')), 'video');
assert.equal(claimedKind(named('song.mp3', 'audio/mpeg')), 'audio');
assert.equal(claimedKind(named('rent.pdf', 'application/pdf')), 'file');

// A type that is present always wins over the extension, even a misleading one:
// the picker knows more about the bytes than the name does.
assert.equal(claimedKind(named('song.mp3', 'application/octet-stream')), 'file');

// An empty type is where the name is the only thing left.
assert.equal(claimedKind(named('song.m4a', '')), 'audio');
assert.equal(claimedKind(named('voice.opus', '')), 'audio');
assert.equal(claimedKind(named('holiday.HEIC', '')), 'image');
assert.equal(claimedKind(named('clip.MOV', '')), 'video');
assert.equal(claimedKind(named('notes', '')), 'file');

// Retyping keeps the container and moves only the top level - `video/mp4` and
// `audio/mp4` are the same file, and inventing `audio/mpeg` for it would be a
// second wrong answer.
assert.equal(retypedAsAudio(named('voice.m4a', 'video/mp4')).type, 'audio/mp4');
assert.equal(retypedAsAudio(named('a.webm', 'video/webm')).type, 'audio/webm');
assert.equal(retypedAsAudio(named('a.ogv', 'video/ogg')).type, 'audio/ogg');

// The name survives, because it is the thing somebody picked the file by.
assert.equal(retypedAsAudio(named('Interview part 2.m4a', 'video/mp4')).name, 'Interview part 2.m4a');

// An untyped audio file gets a real type from its extension. Without this it
// would be stored as `application/octet-stream` and drawn as the grey card the
// whole change exists to stop.
assert.equal(retypedAsAudio(named('song.m4a', '')).type, 'audio/mp4');
assert.equal(retypedAsAudio(named('song.MP3', '')).type, 'audio/mpeg');
assert.equal(retypedAsAudio(named('voice.opus', '')).type, 'audio/ogg');

// An untyped file that is not audio keeps its emptiness rather than being
// guessed at - this function only ever claims one thing.
const untypedDoc = named('notes', '');
assert.equal(retypedAsAudio(untypedDoc), untypedDoc);

// Anything already typed and not video is handed back untouched, same object.
const alreadyAudio = named('song.mp3', 'audio/mpeg');
assert.equal(retypedAsAudio(alreadyAudio), alreadyAudio);
const document = named('rent.pdf', 'application/pdf');
assert.equal(retypedAsAudio(document), document);

console.log('picked media: ok');
