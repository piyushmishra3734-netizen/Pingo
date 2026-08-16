/**
 * The one thing the liquid-glass lens must not be applied to.
 *
 * An SVG filter in `backdrop-filter` puts Chrome on a software path, and
 * anything inside the element that composites separately is flattened through
 * it. A cross-origin `<iframe>` - a YouTube or Instagram embed, which runs in
 * its own process - therefore comes out visibly blurred.
 *
 * It only ever showed on a *received* message, because only incoming bubbles
 * are glass: the sent bubble is the brand gradient with a plain `blur()`, and a
 * plain blur composites fine. A link you sent was sharp, the identical link
 * somebody sent you was soft, and nothing in the code said why.
 *
 * Established by experiment on the live site, not by reading: the same embed
 * inside one of these bubbles is blurred; inside the same bubble with only the
 * `url(#...)` removed it is sharp; removing the plain `blur()` half changes
 * nothing either way.
 *
 * Run with `pnpm verify:lens`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const lens = await readFile(
  // Run from the repo root - see the `verify:lens` script.
  resolve(process.cwd(), 'apps/web/src/features/glass/lens.ts'),
  'utf8',
);

// -- Nothing that composites on its own gets the lens over it ---------------

assert.match(
  lens,
  /el\.querySelector\('iframe, video'\) !== null/,
  'a surface holding an embed or a video is recognised',
);

/*
 * And the check runs first, before any of the size rules. Putting it after them
 * would leave the lens on every bubble that happened to be small enough to skip
 * the early return for a different reason - which is most of them.
 */
const applyTo = lens.slice(lens.indexOf('function applyTo('), lens.indexOf('let frame = 0;'));
assert.ok(applyTo.length > 0, 'applyTo still exists');

const embedCheck = applyTo.indexOf('carriesEmbed(el)');
const firstRect = applyTo.indexOf('getBoundingClientRect');
assert.ok(embedCheck !== -1, 'applyTo asks the question');
assert.ok(
  embedCheck < firstRect,
  'the embed check comes before any measuring - it is not a special case bolted ' +
    'on after the size rules',
);

/*
 * Removing the property rather than writing `none` matters: the class's own
 * `backdrop-filter` has to apply again, so the bubble is still glass. Writing
 * `none` would leave a video message as the one flat rectangle in the thread.
 */
assert.match(
  applyTo,
  /removeProperty\('backdrop-filter'\)/,
  'the inline override is removed, so ordinary glass takes over again',
);
assert.ok(
  !/setProperty\('backdrop-filter', 'none'/.test(applyTo),
  'the bubble stays glass - it just stops being a lens',
);

// -- The observer still sees the embed arrive -------------------------------

/*
 * The iframe does not exist until somebody presses play, so the lens has to be
 * taken off at that moment rather than at first render. `childList` + `subtree`
 * is what notices.
 */
assert.match(
  lens,
  /observer\.observe\(document\.body, \{ childList: true, subtree: true/,
  'a play that inserts an iframe re-runs the scan',
);

console.log('lens: ok');
