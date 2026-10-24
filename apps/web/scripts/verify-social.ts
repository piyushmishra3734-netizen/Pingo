/**
 * X and Pinterest links: what is recognised, what the edge will fetch, and that
 * its two deployed copies have not drifted.
 *
 * The allowlist is the guard that stops `/api/social-img` becoming an open
 * proxy, so it is asserted rather than reviewed.
 *
 * Run with `pnpm verify:social`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { detectSocialLink, withoutSocialLink } from '../../../packages/core/src/social/index.js';
import { biggestPin, isAllowedImage, isAllowedVideo, normalizeTweet, normalizeVx, pinIdFromPath, pinVideo } from '../functions/api/social.js';

// X, in the spellings people paste.
assert.equal(detectSocialLink('https://twitter.com/nasa/status/1790123456789012345?s=20&t=abc')?.canonicalUrl, 'https://x.com/nasa/status/1790123456789012345');
assert.equal(detectSocialLink('https://mobile.twitter.com/nasa/status/1790123456789012345')?.user, 'nasa');
assert.equal(detectSocialLink('https://x.com/i/status/1790123456789012345')?.user, 'i');
assert.equal(detectSocialLink('https://x.com/i/web/status/1790123456789012345')?.user, 'i');
assert.equal(detectSocialLink('https://x.com/nasa')?.platform, undefined, 'a profile is not a post');
assert.equal(detectSocialLink('https://x.com/nasa/status/abc'), undefined);
assert.equal(detectSocialLink('https://evil.com/nasa/status/1790123456789012345'), undefined);
assert.equal(detectSocialLink('https://x.com.evil.com/nasa/status/1790123456789012345'), undefined);

// Pinterest.
assert.equal(detectSocialLink('https://www.pinterest.com/pin/123456789012/')?.id, '123456789012');
assert.equal(detectSocialLink('https://in.pinterest.com/pin/cute-cat--123456789012/')?.id, '123456789012');
assert.equal(detectSocialLink('https://pinterest.co.uk/pin/123456789012')?.platform, 'pinterest');
assert.equal(detectSocialLink('https://pin.it/4Abc9xZ')?.short, true);
assert.equal(detectSocialLink('https://www.pinterest.com/someone/boards/'), undefined);
assert.equal(detectSocialLink('https://pinterest.com.evil.com/pin/123456789012/'), undefined);
assert.equal(detectSocialLink('hello world'), undefined);

// The card replaces the link; the words stay.
const link = detectSocialLink('wow https://x.com/nasa/status/1790123456789012345 so good')!;
assert.equal(withoutSocialLink('wow https://x.com/nasa/status/1790123456789012345 so good', link), 'wow so good');
assert.equal(withoutSocialLink('https://x.com/nasa/status/1790123456789012345', link), '');

// What the edge will fetch or name.
assert.equal(isAllowedImage('https://pbs.twimg.com/media/a.jpg'), true);
assert.equal(isAllowedImage('https://i.pinimg.com/736x/a/b.jpg'), true);
assert.equal(isAllowedImage('http://pbs.twimg.com/media/a.jpg'), false, 'https only');
assert.equal(isAllowedImage('https://pbs.twimg.com.evil.com/a.jpg'), false);
assert.equal(isAllowedImage('https://evil.com/pbs.twimg.com/a.jpg'), false);
assert.equal(isAllowedImage('https://127.0.0.1/a.jpg'), false);
assert.equal(isAllowedImage('javascript:alert(1)'), false);
assert.equal(isAllowedVideo('https://video.twimg.com/ext_tw_video/1/pu/vid/a.mp4'), true);
assert.equal(isAllowedVideo('https://evil.com/a.mp4'), false);
assert.equal(biggestPin('https://i.pinimg.com/236x/ab/cd/ef.jpg'), 'https://i.pinimg.com/736x/ab/cd/ef.jpg');

// FxTwitter's answer, reduced.
const post = normalizeTweet({
  code: 200,
  tweet: {
    url: 'https://x.com/nasa/status/1',
    text: 'Launch day @esa #Artemis',
    created_at: 'Tue Nov 05 14:00:00 +0000 2024',
    likes: 12400,
    retweets: 3100,
    replies: 210,
    views: 981000,
    author: { name: 'NASA', screen_name: 'NASA', avatar_url: 'https://pbs.twimg.com/profile_images/1/a.jpg', verification: { verified: true } },
    media: {
      all: [
        { type: 'photo', url: 'https://pbs.twimg.com/media/a.jpg', width: 1200, height: 800 },
        { type: 'video', url: 'https://video.twimg.com/ext/a.mp4', thumbnail_url: 'https://pbs.twimg.com/amplify/a.jpg', width: 1280, height: 720 },
        { type: 'photo', url: 'https://evil.com/steal.jpg' },
      ],
    },
    quote: { text: 'quoted', author: { name: 'ESA', screen_name: 'esa' } },
  },
});
assert.equal(post?.author?.verified, true);
assert.equal(post?.stats?.likes, 12400);
assert.equal(post?.media.length, 2, 'a picture from an unlisted host is dropped');
assert.ok(post?.media[0]?.src.startsWith('/api/social-img?u='));
assert.equal(post?.media[1]?.kind, 'video');
assert.equal(post?.quote?.author?.handle, 'esa');
assert.equal(normalizeTweet({ code: 404 }), undefined);
assert.equal(normalizeTweet('garbage'), undefined);

// Deployed twice, so the copies must agree.
for (const name of ['social.ts', 'social-img.ts']) {
  const [root, web] = await Promise.all([
    readFile(resolve(process.cwd(), 'functions/api', name), 'utf8'),
    readFile(resolve(process.cwd(), 'apps/web/functions/api', name), 'utf8'),
  ]);
  assert.equal(root, web, `the two copies of ${name} have drifted`);
}

console.log('social links: x and pinterest recognised, edge allowlist holds, copies in step');

// A pin.it link lands on a "sent" page; the pin id must still be found.
assert.equal(pinIdFromPath('/pin/123456789012/sent/'), '123456789012');
assert.equal(pinIdFromPath('/pin/123456789012/'), '123456789012');
assert.equal(pinIdFromPath('/pin/cute-cat--123456789012/'), '123456789012');
assert.equal(pinIdFromPath('/pin/abc/'), undefined);
assert.equal(pinIdFromPath('/'), undefined);

// A pin's video: the mp4 from the page, or the mp4 beside a playlist.
assert.equal(
  pinVideo('"url":"https:\\/\\/v1.pinimg.com\\/videos\\/mc\\/720p\\/ab\\/cd\\/xyz.mp4"'),
  'https://v1.pinimg.com/videos/mc/720p/ab/cd/xyz.mp4',
);
assert.equal(
  pinVideo('https://v1.pinimg.com/videos/mc/hls/ab/cd/xyz.m3u8'),
  'https://v1.pinimg.com/videos/mc/720p/ab/cd/xyz.mp4',
);
assert.equal(pinVideo('https://evil.com/videos/x.mp4'), undefined);

// The second X source.
const vx = normalizeVx({
  tweetID: '1790123456789012345', text: 'hi', user_name: 'NASA', user_screen_name: 'nasa', likes: 5,
  media_extended: [
    { type: 'image', url: 'https://pbs.twimg.com/media/a.jpg', size: { width: 100, height: 50 } },
    { type: 'video', url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/a.mp4', thumbnail_url: 'https://pbs.twimg.com/t.jpg' },
    { type: 'image', url: 'https://evil.com/x.jpg' },
  ],
});
assert.equal(vx?.media.length, 2);
assert.equal(vx?.media[1]?.kind, 'video');
assert.equal(normalizeVx({}), undefined);
