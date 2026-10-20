/**
 * The ways a Pingo TV provider can look dead while it is fine, or look fine
 * while it is dead.
 *
 * Each case here was a real report. A provider (Giant) names real MPEG-TS video
 * segments `.jpg`; a name-based "this is a slideshow" check threw it out and
 * every title looked unavailable. The inverse must keep working: a playlist of
 * genuine pictures is still rejected. The probe runs against a faked `fetch`,
 * so this needs no network and fails the build if the rule regresses.
 *
 * Run with `pnpm verify:tv-probe`.
 */
import assert from 'node:assert/strict';

import { bytesArePicture, pickSubtitles, playlistSeconds, probeResolver } from '../src/features/tv/sourceProbe.js';

const TS = new Uint8Array([0x47, 0x40, 0x11, 0x10, 0, 0x42, 0xf0, 0x25]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

assert.equal(bytesArePicture(JPEG), true, 'a JPEG is a picture');
assert.equal(bytesArePicture(PNG), true, 'a PNG is a picture');
assert.equal(bytesArePicture(TS), false, 'MPEG-TS is video, whatever it is called');
assert.equal(bytesArePicture(new Uint8Array([1, 2])), false, 'too short to be a picture');

const PLAYLIST = (ext: string) =>
  `#EXTM3U\n#EXT-X-TARGETDURATION:10\n${[0, 1, 2, 3, 4]
    .map((i) => `#EXTINF:10,\nhttps://cdn.example/seg/${i}.${ext}`)
    .join('\n')}\n#EXT-X-ENDLIST\n`;

/** A feature length playlist: 600 segments of 10 seconds, a hundred minutes. */
const FILM = (ext: string) =>
  `#EXTM3U\n${Array.from({ length: 600 }, (_, i) => `#EXTINF:10,\nhttps://cdn.example/seg/${i}.${ext}`).join('\n')}\n#EXT-X-ENDLIST\n`;

type Answer = { status?: number; body?: string | Uint8Array; json?: unknown };

/** Fake the network: the API answer, the playlist, and what the first segment really is. */
function fake(api: Answer, playlist: Answer, segment: Answer) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const pick = url.includes('/api/stream') ? api : url.endsWith('.m3u8') ? playlist : segment;
    const status = pick.status ?? 200;
    const payload =
      pick.json !== undefined ? JSON.stringify(pick.json) : pick.body ?? '';
    return new Response(payload as BodyInit, { status });
  }) as typeof fetch;
}

const ok = (url = 'https://cdn.example/index.m3u8') => ({
  json: { success: true, sources: [{ url, quality: '1080p', audioTracks: [{ label: 'Hindi' }] }] },
});

async function probe() {
  return probeResolver('giant', 'movie', 1, 1, 1);
}

// 1. The reported bug: real video, segments named .jpg.
fake(ok(), { body: FILM('jpg') }, { status: 206, body: TS });
assert.equal((await probe()).status, 'ready', 'TS segments named .jpg must count as video');

// 2. Genuine pictures are still a slideshow, not a film.
fake(ok(), { body: FILM('jpg') }, { status: 206, body: JPEG });
assert.equal((await probe()).status, 'empty', 'a playlist of real JPEGs is rejected');

// 3. An ordinary playlist still passes.
fake(ok(), { body: FILM('ts') }, { status: 206, body: TS });
assert.equal((await probe()).status, 'ready', 'a plain .ts playlist is ready');

// 4. Segments that are gone fail the source.
fake(ok(), { body: FILM('ts') }, { status: 404, body: 'nope' });
assert.equal((await probe()).status, 'empty', 'a playlist whose segments 404 is rejected');

// 5. The resolver itself saying no (upstream 429 and the like).
fake({ json: { success: false, sources: [], error: 'upstream 429' } }, {}, {});
assert.equal((await probe()).status, 'empty', 'no sources means empty');

// 6. A body that is not a playlist at all.
fake(ok(), { body: '<html>404</html>' }, {});
assert.equal((await probe()).status, 'empty', 'a non-playlist answer is rejected');

// 7. A ten minute preview is video, and still not the film.
fake(ok('https://cdn.example/hls_mps/abc/480/index_preview_266.m3u8'), { body: PLAYLIST('ts') }, { status: 206, body: TS });
assert.equal((await probe()).status, 'empty', 'a playlist named preview is rejected');

// 8. A movie that only runs a few minutes is a trailer.
assert.equal(playlistSeconds(PLAYLIST('ts')), 50, 'seconds are summed from EXTINF');
fake(ok(), { body: PLAYLIST('ts') }, { status: 206, body: TS });
assert.equal((await probe()).status, 'empty', 'a 50 second movie is rejected');

// 9. A full length movie passes.
fake(ok(), { body: FILM('ts') }, { status: 206, body: TS });
assert.equal((await probe()).status, 'ready', 'a 100 minute movie is ready');

// 10. Subtitles: one per language, English then Hindi first, vtt only.
const picked = pickSubtitles([
  { url: 'a', language: 'French', format: 'vtt' },
  { url: 'b', language: 'English', format: 'vtt' },
  { url: 'c', language: 'English', format: 'vtt' },
  { url: 'd', language: 'Hindi', format: 'vtt' },
  { url: 'e', language: 'German', format: 'srt' },
]);
assert.deepEqual(picked.map((sub) => sub.label), ['English', 'Hindi', 'French'], 'one per language, English and Hindi first, no srt');

console.log('✓ tv probe: pictures and video told apart by their bytes');
