/**
 * YouTube Music in PINGO Music: reading its answers, and never being the reason
 * music stops.
 *
 * The network is faked, so this checks our reading of the shapes and the
 * fall-back to JioSaavn, not YouTube itself. YouTube's side is unofficial and
 * moves; what must not move is that a failure there becomes a JioSaavn answer.
 *
 * Run with `pnpm verify:ytm`.
 */
import assert from 'node:assert/strict';

import * as api from '../src/features/music/saavn/api.js';
import { parseSongShare, songBody } from '../src/features/music/song-share.js';
import { isYtPage, playableFor } from '../src/features/music/ytm/page.js';
import * as yt from '../src/features/music/ytm/innertube.js';
import { setMusicSource, ytmActive, noteYtmFailure, ytmResting } from '../src/features/music/ytm/source.js';

/* ---------- fixtures shaped like InnerTube's answers ---------- */

const run = (text: string, extra: Record<string, unknown> = {}) => ({ text, ...extra });
const row = (id: string, title: string, artist: string, album: string, dur: string) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: id },
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/x=w60-h60-l90-rj' }] } } },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [run(title)] } } },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              run(artist, { navigationEndpoint: { browseEndpoint: { browseId: 'UC123' } } }),
              run(' • '),
              run(album, { navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_9' } } }),
              run(' • '),
              run(dur),
            ],
          },
        },
      },
    ],
  },
});

const searchAnswer = { contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [row('abc12345678', 'Kesariya', 'Arijit Singh', 'Brahmastra', '4:28'), row('def12345678', 'Apna Bana Le', 'Arijit Singh', 'Bhediya', '4:01')] } }] } } } }] } } };

const panel = (id: string, title: string, byline: unknown[], dur: string) => ({
  playlistPanelVideoRenderer: { videoId: id, title: { runs: [run(title)] }, longBylineText: { runs: byline }, lengthText: { runs: [run(dur)] }, thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/sd.jpg` }] } },
});
const by = (artist: string) => run(artist, { navigationEndpoint: { browseEndpoint: { browseId: 'UC123' } } });
const panels = [
  panel('abc12345678', 'Kesariya', [by('Arijit Singh')], '4:28'),
  panel('ghi12345678', 'Tum Hi Ho', [by('Arijit Singh'), run(' • '), run('Aashiqui 2', { navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_1' } } }), run(' • '), run('2013')], '4:22'),
];
// The real nesting is deep and changes; the reader only relies on the renderer's name.
const nextAnswer = { contents: { deep: { deeper: { playlistPanelRenderer: { contents: panels } } } } };

const player = (status: string, formats: unknown[] = []) => ({ playabilityStatus: { status, reason: status === 'OK' ? undefined : 'Video unavailable' }, streamingData: { adaptiveFormats: formats } });
const audio = (itag: number, url: string | undefined) => ({ itag, mimeType: 'audio/mp4', ...(url ? { url } : { signatureCipher: 'x' }) });

/* ---------- reading ---------- */

yt.setNativeForTests(true);
yt.setTransport(async (url) => (url.includes('/search') ? searchAnswer : url.includes('/next') ? nextAnswer : {}));

const found = await yt.searchSongs('kesariya');
assert.equal(found.length, 2);
assert.equal(found[0]!.id, 'yt:abc12345678', 'ids are prefixed so they never collide with JioSaavn ids');
assert.equal(found[0]!.name, 'Kesariya');
assert.deepEqual(found[0]!.artists.map((a) => a.name), ['Arijit Singh']);
assert.equal(found[0]!.album.name, 'Brahmastra');
assert.equal(found[0]!.secs, 268, '4:28 is 268 seconds');
assert.ok(found[0]!.image.includes('w544-h544'), 'cover is asked for at a usable size');

const radio = await yt.upNext('abc12345678');
assert.deepEqual(radio.map((s) => s.name), ['Tum Hi Ho'], 'the seed song is not its own next');
assert.equal(radio[0]!.album.name, 'Aashiqui 2');

yt.setTransport(async () => ({ contents: {} }));
await assert.rejects(() => yt.searchSongs('x'), yt.YtmError, 'an answer with no songs is an error, not an empty success');

/* ---------- streams ---------- */

yt.setTransport(async () => player('OK', [audio(139, 'https://a/139'), audio(140, 'https://a/140'), audio(251, 'https://a/251')]));
const s1 = await yt.resolveStream('vidAAAAAAAA');
assert.equal(s1['160'], 'https://a/140', 'AAC is the default: it plays everywhere');
assert.equal(s1['48'], 'https://a/139');

yt.setTransport(async () => player('LOGIN_REQUIRED'));
await assert.rejects(() => yt.resolveStream('vidBBBBBBBB'), yt.YtmError, 'not playable is an error');

yt.setTransport(async () => player('OK', [audio(140, undefined)]));
await assert.rejects(() => yt.resolveStream('vidCCCCCCCC'), yt.YtmError, 'a ciphered stream is not one we can play');

/* ---------- the fall-back ---------- */

const saavnSong = (id: string, name: string) => ({ type: 'song', id, name, album: { id: '', name: '' }, artists: [{ type: 'artist', id: 'a', name: 'Arijit Singh', image: '' }], credits: [], image: '', secs: 200, year: 2022, language: 'hindi', explicit: false, plays: 0, hasLyrics: false, label: '', copyright: '', url: '', stream: { '160': `https://saavn/${id}.mp4` } });
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const send = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
  if (url.includes('/search/songs')) return send({ items: [saavnSong('s1', 'Kesariya (From "Brahmastra")')], page: 1, more: false });
  if (url.includes('/search')) return send({ top: [], songs: [saavnSong('s1', 'Kesariya')], albums: [], artists: [], playlists: [] });
  if (url.includes('/songs/s1/radio')) return send({ stationId: 'st1', songs: [saavnSong('s2', 'Next')] });
  if (url.includes('/songs/s1')) return send([saavnSong('s1', 'Kesariya')]);
  return new Response('{}', { status: 404 });
}) as typeof fetch;

setMusicSource('ytm');
assert.equal(ytmActive(), true, 'YouTube Music is on when chosen and in the app');

// YouTube answers search: its songs come first.
yt.setTransport(async (url) => (url.includes('/search') ? searchAnswer : {}));
const viaYt = await api.searchAll('kesariya');
assert.equal(viaYt.songs[0]!.id, 'yt:abc12345678');

// YouTube is down: the same call answers from JioSaavn, with no error.
yt.setTransport(async () => {
  throw new Error('offline');
});
const viaSaavn = await api.searchAll('kesariya2');
assert.equal(viaSaavn.songs[0]!.id, 's1', 'search falls back to JioSaavn');

// A YouTube song that cannot be resolved plays as its JioSaavn twin.
yt.setTransport(async (url) => (url.includes('/search') ? searchAnswer : { playabilityStatus: { status: 'ERROR' } }));
await api.searchSongs('seed query');
const twin = await api.song('yt:abc12345678');
assert.equal(twin?.id, 's1', 'an unplayable YouTube song is played from JioSaavn');
assert.ok(twin?.stream['160'], 'and it has a stream');

// A YouTube radio that fails is a JioSaavn radio of the same song.
yt.setTransport(async () => {
  throw new Error('offline');
});
const station = await api.songRadio(['yt:abc12345678']);
assert.equal(station.stationId, 'st1', 'radio falls back to JioSaavn');

// Repeated failures rest YouTube instead of slowing every tap.
setMusicSource('ytm');
noteYtmFailure();
noteYtmFailure();
noteYtmFailure();
assert.equal(ytmActive(), false, 'after three failures YouTube rests');
assert.equal(ytmResting(), true);

// Outside the app YouTube Music is never used.
yt.setNativeForTests(false);
setMusicSource('ytm');
assert.equal(ytmActive(), false, 'a browser stays on JioSaavn');

/* ---------- sharing in a chat ---------- */

yt.setNativeForTests(true);
setMusicSource('ytm');
const body = songBody({ name: 'Kesariya', artist: 'Arijit Singh', img: 'https://i.ytimg.com/x.jpg', url: 'https://rr1.googlevideo.com/videoplayback?expire=1&ip=9', secs: 268, start: 30, id: 'yt:abc12345678' });
const shared = parseSongShare(body);
assert.ok(shared, 'a shared YouTube Music song reads back as a card');
assert.equal(shared!.url, 'https://music.youtube.com/watch?v=abc12345678', 'it travels as a page address, never as a one-phone audio address');
assert.ok(isYtPage(shared!.url));

// The friend's phone: in the app it asks YouTube; otherwise (or if YouTube fails) JioSaavn's version plays.
yt.setTransport(async () => player('OK', [audio(140, 'https://a/friend140')]));
assert.equal(await playableFor(shared!), 'https://a/friend140');
yt.forget('abc12345678');
yt.setTransport(async () => {
  throw new Error('offline');
});
assert.equal(await playableFor(shared!), 'https://saavn/s1.mp4', 'a failed lookup plays the JioSaavn version');
yt.setNativeForTests(false);
assert.equal(await playableFor(shared!), 'https://saavn/s1.mp4', 'a browser plays the JioSaavn version');

console.log('✓ ytm: reads YouTube Music, and falls back to JioSaavn when it cannot');
