/**
 * Video link detection, checked against the cases that actually break it.
 *
 * Run with `pnpm verify:video-links`.
 *
 * Every assertion here is a URL shape a person really sends. The ones worth
 * naming: a link at the end of a sentence (the full stop is not part of the
 * id), a link inside brackets, a channel URL that must *not* become a card, and
 * `javascript:` - which is the one failure that would matter, because the
 * result of this function ends up as an `iframe src`.
 */

import assert from 'node:assert/strict';

import {
  detectVideoLink,
  fileNameFrom,
  findLinks,
} from '../../../packages/core/src/video/index.js';

let checks = 0;
function check(what: string, run: () => void): void {
  run();
  checks += 1;
  console.log(`  ok  ${what}`);
}

console.log('\nURL detection');

check('finds a link surrounded by text and emoji', () => {
  const found = findLinks('Bro look at this 😂 https://youtu.be/abc12345678 kya scene hai');
  assert.equal(found.length, 1);
  assert.equal(found[0]!.href, 'https://youtu.be/abc12345678');
});

check('does not eat the full stop that ends the sentence', () => {
  const preview = detectVideoLink('watch https://youtu.be/abc12345678.');
  assert.equal(preview?.canonicalUrl, 'https://www.youtube.com/watch?v=abc12345678');
});

check('drops a closing bracket it did not open', () => {
  const preview = detectVideoLink('(see https://youtu.be/abc12345678)');
  assert.equal(preview?.canonicalUrl, 'https://www.youtube.com/watch?v=abc12345678');
});

check('refuses every scheme but http and https', () => {
  assert.deepEqual(findLinks('javascript:alert(1) data:text/html,x file:///etc/passwd'), []);
});

check('upgrades http to https', () => {
  assert.equal(findLinks('http://youtu.be/abc12345678')[0]?.protocol, 'https:');
});

check('ignores a malformed URL', () => {
  assert.deepEqual(findLinks('https://'), []);
});

console.log('\nYouTube');

const youtubeCases: Array<[string, string]> = [
  ['https://www.youtube.com/watch?v=abc12345678', 'watch'],
  ['https://youtu.be/abc12345678', 'short host'],
  ['https://www.youtube.com/shorts/abc12345678', 'shorts'],
  ['https://m.youtube.com/watch?v=abc12345678', 'mobile host'],
  ['https://music.youtube.com/watch?v=abc12345678', 'music host'],
  ['https://www.youtube.com/watch?v=abc12345678&list=PL9&index=2', 'extra query parameters'],
];

for (const [url, label] of youtubeCases) {
  check(`resolves ${label}`, () => {
    const preview = detectVideoLink(url);
    assert.equal(preview?.platform, 'youtube');
    assert.equal(preview?.canonicalUrl, 'https://www.youtube.com/watch?v=abc12345678');
    assert.equal(preview?.thumbnailUrl, 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg');
    assert.ok(preview?.embedUrl?.startsWith('https://www.youtube-nocookie.com/embed/abc12345678'));
  });
}

check('keeps the original URL exactly as sent', () => {
  const sent = 'https://m.youtube.com/watch?v=abc12345678&list=PL9';
  assert.equal(detectVideoLink(sent)?.originalUrl, sent);
});

check('carries a plain-seconds timestamp into the embed', () => {
  const preview = detectVideoLink('https://youtu.be/abc12345678?t=90');
  assert.ok(preview?.embedUrl?.includes('start=90'));
});

check('parses a 1h2m3s timestamp rather than passing it through', () => {
  const preview = detectVideoLink('https://youtu.be/abc12345678?t=1h2m3s');
  assert.ok(preview?.embedUrl?.includes('start=3723'));
});

check('is not fooled by a channel URL', () => {
  assert.equal(detectVideoLink('https://www.youtube.com/@RickAstleyYT'), undefined);
});

check('rejects an id of the wrong length', () => {
  assert.equal(detectVideoLink('https://youtu.be/tooshort'), undefined);
});

console.log('\nInstagram');

check('resolves a reel and offers the official embed', () => {
  const preview = detectVideoLink('https://www.instagram.com/reel/C1abcDEF_-/');
  assert.equal(preview?.platform, 'instagram');
  assert.equal(preview?.canonicalUrl, 'https://www.instagram.com/reel/C1abcDEF_-/');
  assert.equal(preview?.embedUrl, 'https://www.instagram.com/reel/C1abcDEF_-/embed/');
});

check('folds /reels/ onto /reel/ so the cache holds one entry', () => {
  const a = detectVideoLink('https://www.instagram.com/reels/C1abcDEF_-/');
  const b = detectVideoLink('https://instagram.com/reel/C1abcDEF_-/');
  assert.equal(a?.canonicalUrl, b?.canonicalUrl);
});

check('has no thumbnail, because none can be had legitimately', () => {
  assert.equal(detectVideoLink('https://www.instagram.com/reel/C1abcDEF_-/')?.thumbnailUrl, undefined);
});

check('is not fooled by a profile URL', () => {
  assert.equal(detectVideoLink('https://www.instagram.com/rickastley/'), undefined);
});

console.log('\nSnapchat');

check('recognises Spotlight but offers no embed', () => {
  const preview = detectVideoLink('https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEE');
  assert.equal(preview?.platform, 'snapchat');
  assert.equal(preview?.embedUrl, undefined);
});

check('ignores an add-friend link', () => {
  assert.equal(detectVideoLink('https://www.snapchat.com/add/someone'), undefined);
});

console.log('\nDirect video files');

for (const extension of ['mp4', 'webm', 'ogv', 'm4v', 'mov']) {
  check(`plays a .${extension}`, () => {
    const preview = detectVideoLink(`https://cdn.example.com/clip.${extension}`);
    assert.equal(preview?.platform, 'direct');
    assert.equal(preview?.fileUrl, `https://cdn.example.com/clip.${extension}`);
    // Nothing to frame: this one is ours to play.
    assert.equal(preview?.embedUrl, undefined);
  });
}

check('survives a signed CDN query string', () => {
  const signed = 'https://cdn.example.com/a/clip.mp4?X-Amz-Signature=abc&e=123';
  const preview = detectVideoLink(signed);
  assert.equal(preview?.platform, 'direct');
  assert.equal(preview?.fileUrl, signed);
});

check('ignores containers no browser plays', () => {
  assert.equal(detectVideoLink('https://cdn.example.com/clip.mkv'), undefined);
  assert.equal(detectVideoLink('https://cdn.example.com/clip.avi'), undefined);
});

check('leaves .ogg alone, because it is almost always audio', () => {
  assert.equal(detectVideoLink('https://cdn.example.com/sound.ogg'), undefined);
});

check('does not treat a page as a file', () => {
  assert.equal(detectVideoLink('https://example.com/watch/mp4-guide'), undefined);
});

check('never claims a URL a real platform owns', () => {
  // youtube wins even though `direct` would take anything.
  assert.equal(detectVideoLink('https://youtu.be/abc12345678')?.platform, 'youtube');
  // An Instagram profile stops at Instagram rather than falling through.
  assert.equal(detectVideoLink('https://www.instagram.com/rickastley/'), undefined);
});

check('names the saved file from the path, not the query', () => {
  assert.equal(fileNameFrom('https://cdn.example.com/a/holiday.mp4?sig=xyz'), 'holiday.mp4');
  assert.equal(fileNameFrom('https://cdn.example.com/'), 'video.mp4');
  assert.equal(fileNameFrom('not a url'), 'video.mp4');
});

console.log('\nUnsupported');

check('leaves an ordinary link alone', () => {
  assert.equal(detectVideoLink('read https://example.com/article'), undefined);
});

check('finds the video link among several', () => {
  const preview = detectVideoLink(
    'https://example.com and https://youtu.be/abc12345678 and https://other.test',
  );
  assert.equal(preview?.platform, 'youtube');
});

check('returns nothing for text with no links', () => {
  assert.equal(detectVideoLink('just a normal message'), undefined);
});

console.log(`\n${checks} checks passed.\n`);
