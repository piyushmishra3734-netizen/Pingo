/**
 * The ceiling every photo is held to, and the two ways it can be silently wrong.
 *
 * A resize that runs and produces *a* picture always looks like it worked.
 * There is no error, no blank bubble - just a photo that is a bit smaller than
 * it should be, or a bit bigger, or the right size the wrong way round. The
 * arithmetic is the whole feature, so it is the thing that gets checked.
 *
 * Run with `pnpm verify:media-quality`.
 */
import assert from 'node:assert/strict';

import {
  STANDARD_LONG_EDGE,
  STANDARD_SHORT_EDGE,
  isStillImage,
  standardSize,
} from '../src/features/chat/media-quality.js';

/** Nothing is ever larger than the ceiling, whichever way the picture faces. */
function within(size: { width: number; height: number }): boolean {
  const short = Math.min(size.width, size.height);
  const long = Math.max(size.width, size.height);
  return short <= STANDARD_SHORT_EDGE && long <= STANDARD_LONG_EDGE;
}

/*
 * A phone photo, both orientations. The same picture rotated must lose the same
 * amount - a ceiling applied to `height` rather than "the short edge" gives
 * portraits and landscapes different rules, and nobody notices until they
 * compare two shots of the same thing.
 */
const landscape = standardSize(4032, 3024);
const portrait = standardSize(3024, 4032);
assert.ok(landscape && portrait, 'a 12MP photo is resized in both orientations');
assert.ok(within(landscape), `landscape lands inside the ceiling: ${JSON.stringify(landscape)}`);
assert.ok(within(portrait), `portrait lands inside the ceiling: ${JSON.stringify(portrait)}`);
assert.deepEqual(
  { width: landscape.height, height: landscape.width },
  portrait,
  'rotating the input rotates the output and changes nothing else',
);

/* 4:3 at 480p is 640x480 - the short edge is the binding constraint. */
assert.deepEqual(landscape, { width: 640, height: 480 }, '4:3 lands on 640x480');

/*
 * A panorama is limited by its length instead. Without the second ceiling,
 * scaling only by the short edge would send a 4000-pixel-wide strip.
 */
const panorama = standardSize(6000, 1000);
assert.ok(panorama && within(panorama), 'a panorama is held by the long edge');
assert.equal(panorama.width, STANDARD_LONG_EDGE, 'and lands exactly on it');

/*
 * Already small enough is left alone. Returning a size here would upscale -
 * spending bytes to make a picture worse, which is the opposite of the point.
 */
assert.equal(standardSize(640, 480), undefined, 'a picture at the ceiling is untouched');
assert.equal(standardSize(200, 200), undefined, 'and one well under it');
assert.equal(standardSize(854, 480), undefined, 'exactly on both edges is untouched');

/* Degenerate input must not produce a zero-sized canvas. */
assert.equal(standardSize(0, 0), undefined, 'nothing is not resized');

/*
 * And the check that keeps a sticker a sticker. An animated image drawn to a
 * canvas becomes its first frame: the compression "works" and the GIF stops
 * moving, which reads as a broken message rather than a saving.
 */
assert.equal(isStillImage(new Blob([], { type: 'image/jpeg' })), true, 'a JPEG is a still');
assert.equal(isStillImage(new Blob([], { type: 'image/gif' })), false, 'a GIF is not');
assert.equal(isStillImage(new Blob([], { type: 'image/apng' })), false, 'nor an APNG');
assert.equal(isStillImage(new Blob([], { type: 'video/mp4' })), false, 'nor a video');

console.log(`✓ every still lands within ${STANDARD_LONG_EDGE}x${STANDARD_SHORT_EDGE}`);
