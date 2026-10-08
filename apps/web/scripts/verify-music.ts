/**
 * PINGO Music's backend, checked without a network or a speaker.
 *
 * - The Worker's DES reads JioSaavn's `encrypted_media_url` into the same
 *   address the old Worker produced for the same song.
 * - The normaliser turns raw JioSaavn into the app's shapes (entities decoded,
 *   500px images, every stream rate).
 * - The queue: next/prev, repeat, shuffle keeping the current song, "play
 *   next" moving a queued song up, refill only for radio, history trimmed.
 * - Taste: finished plays and likes count, skips count against, old plays fade.
 * - Radio sound: a phonk seed is read as phonk and anchored with well-played
 *   phonk in a real language, never an "instrumental" or "unknown" one.
 *
 * Run with `pnpm verify:music`.
 */
import { decryptMediaUrl } from '../../../workers/saavn/src/des.js';
import { album, image, modules, song, text } from '../../../workers/saavn/src/normalize.js';
import { anchorQuery, pickAnchors, soundOf, type SongLike } from '../../../workers/saavn/src/sound.js';
import * as Q from '../src/features/music/saavn/queue.js';
import { homeLanguages, songScore, taste } from '../src/features/music/saavn/taste.js';
import type { Song } from '../src/features/music/saavn/types.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

console.log('— the stream address —');
{
  // Kesariya (rjkrTnma), as JioSaavn sends it, and as pingo-music decrypted it on 2026-10-07.
  const url = decryptMediaUrl('ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyryhkSYK5IH2E7FCO52VR6yhNbcEbes5iCcja4+W8xhE0SwtCJToN4Bw7tS9a8Gtq');
  check(url === 'https://aac.saavncdn.com/871/c2febd353f3a076a406fa37510f31f9f_96.mp4', `DES decrypts to the known address (${url})`);
}

console.log('— normalising —');
{
  const raw = {
    id: 'rjkrTnma',
    title: 'Kesariya (From &quot;Brahmastra&quot;)',
    type: 'song',
    image: 'https://c.saavncdn.com/871/Brahmastra-Hindi-2022-20221006155213-150x150.jpg',
    language: 'hindi',
    year: '2022',
    play_count: '213546512',
    explicit_content: '0',
    perma_url: 'https://www.jiosaavn.com/song/kesariya/AgIAQyBeWlI',
    more_info: {
      album_id: '38845390',
      album: 'Brahmastra',
      duration: '268',
      has_lyrics: 'false',
      '320kbps': 'true',
      encrypted_media_url: 'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyryhkSYK5IH2E7FCO52VR6yhNbcEbes5iCcja4+W8xhE0SwtCJToN4Bw7tS9a8Gtq',
      artistMap: { primary_artists: [{ id: '456323', name: 'Pritam', image: 'https://c.saavncdn.com/artists/Pritam-150x150.jpg' }], artists: [] },
    },
  };
  const s = song(raw);
  check(s.name === 'Kesariya (From "Brahmastra")', 'HTML entities are decoded');
  check(s.secs === 268 && s.year === 2022 && s.plays === 213546512, 'numbers arrive as numbers');
  check(s.image.endsWith('-500x500.jpg'), `images are asked for at 500px (${s.image})`);
  check(Object.keys(s.stream).join() === '12,48,96,160,320', 'every stream rate, 320 included when JioSaavn has it');
  check(s.stream['160']!.endsWith('_160.mp4'), 'the 160 kbps address is the 160 file');
  check(s.artists[0]?.id === '456323' && s.artists[0]?.name === 'Pritam', 'artists keep their ids');
  const noHigh = song({ ...raw, more_info: { ...raw.more_info, '320kbps': 'false' } });
  check(!('320' in noHigh.stream), 'no 320 address for a song JioSaavn has no 320 of');
  check(Object.keys(song({ ...raw, more_info: { ...raw.more_info, encrypted_media_url: '' } }).stream).length === 0, 'no stream at all when JioSaavn gives no address');
  check(text('Tom &amp; Jerry &#039;s') === "Tom & Jerry 's", 'numeric and named entities');
  check(image('http://c.saavncdn.com/a/b_50x50.jpg') === 'https://c.saavncdn.com/a/b_500x500.jpg', 'small images on http become 500px on https');
  const al = album({ id: '1', title: 'A', type: 'album', list: [raw], more_info: { song_count: '1' } });
  check(al.songs?.length === 1 && al.songCount === 1, 'an album carries its songs');
  const home = modules({
    modules: { b: { title: 'Second', position: 2 }, a: { title: 'First', position: 1 }, empty: { title: 'Nothing', position: 3 } },
    a: [raw],
    b: [{ id: '9', title: 'Mix', type: 'playlist' }],
    empty: [{ id: 'x', type: 'show', title: 'A podcast' }],
  });
  check(home.map((m) => m.title).join() === 'First,Second', 'home modules in JioSaavn order, podcast-only ones dropped');
}

console.log('— the queue —');
const mk = (id: string): Song => ({ type: 'song', id, name: id, album: { id: '', name: '' }, artists: [{ type: 'artist', id: `a${id}`, name: `A${id}`, image: '' }], credits: [], image: '', secs: 200, year: 0, language: 'hindi', explicit: false, plays: 0, hasLyrics: false, label: '', copyright: '', url: '', stream: {} });
const ids = (q: Q.QueueState) => q.order.map((i) => q.items[i]!.id).join('');
const five = ['a', 'b', 'c', 'd', 'e'].map(mk);
{
  let q = Q.start(Q.empty(), five, 2, { kind: 'album', label: 'X' });
  check(Q.current(q)?.id === 'c', 'starts at the song tapped');
  q = Q.next(q);
  check(Q.current(q)?.id === 'd', 'next moves on');
  check(Q.prev(q, 10).restart && !Q.prev(q, 1).restart, 'back restarts a song past three seconds, else goes back');
  q = Q.next(Q.next(q));
  check(Q.current(q)?.id === 'e' && Q.atEnd(q), 'an album ends at its last song');
  check(!Q.wantsMore(q), 'an album never asks the radio for more');
  q = Q.cycleRepeat(q);
  check(q.repeat === 'all' && Q.current(Q.next(q))?.id === 'a', 'repeat all wraps to the start');
  q = Q.cycleRepeat(q);
  check(q.repeat === 'one' && Q.next(q, true).at === q.at && Q.next(q, false).at !== q.at, 'repeat one replays on its own, but next still skips');

  const dup = Q.start(Q.empty(), [mk('a'), mk('b'), mk('a')], 0, { kind: 'list', label: '' });
  check(dup.items.length === 2, 'the same song twice is queued once');

  let r = Q.start(Q.empty(), five, 0, { kind: 'song', label: 'radio' });
  check(!Q.wantsMore(r), 'a radio with plenty left does not ask for more');
  r = Q.jump(r, 3);
  check(Q.wantsMore(r), 'a radio near its end asks for more');
  r = Q.extend(r, [mk('a'), mk('f'), mk('g')], 'st1');
  check(ids(r) === 'abcdefg' && r.stationId === 'st1', 'refill adds new songs only, and keeps the station');

  let n = Q.start(Q.empty(), five, 0, { kind: 'album', label: '' });
  n = Q.playNext(n, [mk('d')]);
  check(ids(n) === 'adbce' && Q.current(n)?.id === 'a', '"play next" moves a queued song up, without a duplicate');
  n = Q.playNext(n, [mk('x'), mk('y')]);
  check(ids(n) === 'axydbce', '"play next" with several keeps their order');
  n = Q.append(n, [mk('z'), mk('a')]);
  check(ids(n).endsWith('z') && n.items.length === 8, '"add to queue" goes to the end, skipping what is queued');
  n = Q.remove(n, 1);
  check(ids(n) === 'aydbcez', 'remove takes one out');
  check(Q.remove(n, 0) === n, 'the playing song cannot be removed');
  n = Q.move(n, 1, 3);
  check(ids(n) === 'adbycez', 'reorder moves what is coming up');

  let s = Q.start(Q.empty(), five, 2, { kind: 'album', label: '' });
  let seed = 1;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  s = Q.toggleShuffle(s, rand);
  check(Q.current(s)?.id === 'c' && s.at === 0 && new Set(s.order).size === 5, 'shuffle keeps the current song playing and plays everything once');
  s = Q.toggleShuffle(s, rand);
  check(ids(s) === 'abcde' && Q.current(s)?.id === 'c', 'shuffle off goes back to the queued order, same song');

  let long = Q.start(Q.empty(), Array.from({ length: 60 }, (_, i) => mk(`s${i}`)), 0, { kind: 'song', label: '' });
  long = Q.jump(long, 58);
  long = Q.extend(long, [mk('n1'), mk('n2')]);
  check(long.at === 50 && Q.current(long)?.id === 's58' && long.items.length === 54, 'a long radio forgets old songs but not where it is');
}

console.log('— taste —');
{
  const now = Date.UTC(2026, 9, 7);
  const rec = (id: string, artist: string, plays: number, finished: number, daysAgo: number, language = 'hindi') => ({ id, name: id, artists: [{ id: artist, name: artist }], language, plays, finished, lastPlayedAt: now - daysAgo * 86400_000 });
  check(songScore(rec('a', 'x', 5, 5, 0), false, now) > songScore(rec('b', 'x', 5, 0, 0), false, now), 'listened to the end beats skipped');
  check(songScore(rec('a', 'x', 5, 0, 0), false, now) === 0, 'only skips says nothing good');
  check(songScore(rec('a', 'x', 3, 3, 0), false, now) > 2 * songScore(rec('a', 'x', 3, 3, 28), false, now), 'four weeks ago counts for under half');
  check(songScore(rec('a', 'x', 1, 0, 0), true, now) > songScore(rec('a', 'x', 3, 3, 0), false, now), 'a like counts for more than plays');
  const t = taste(
    [rec('s1', 'arijit', 6, 6, 1), rec('s2', 'arijit', 5, 5, 1), rec('s3', 'arijit', 4, 4, 1), rec('s4', 'diljit', 3, 3, 2, 'punjabi'), rec('s5', 'shreya', 1, 0, 0)],
    new Set(['s4']),
    now,
  );
  check(t.artists[0]?.id === 'arijit', 'the most listened artist leads');
  check(t.seeds.filter((s) => s.startsWith('s1') || s.startsWith('s2') || s.startsWith('s3')).length === 2, 'at most two seeds per artist');
  check(t.seeds.includes('s4') && !t.seeds.includes('s5'), 'a liked song seeds; a skipped one does not');
  check(homeLanguages(t).join() === 'hindi,punjabi', 'home asks in the languages actually played');
  check(homeLanguages(taste([], new Set(), now)).join() === 'hindi', 'somebody new starts in Hindi');
}

console.log('— radio keeps the sound —');
{
  const s = (id: string, name: string, language: string, plays: number, artist = id, albumName = name): SongLike => ({ id, name, album: { name: albumName }, artists: [{ name: artist }], language, plays });
  const gym = s('a5WvfB24', 'Gym Phonk', 'unknown', 19066, 'Gym Phonk 2024', 'Aggressive Gym Phonk Motivation Music');
  check(soundOf([gym])?.tag === 'phonk', 'gym phonk is phonk before it is a workout');
  check(soundOf([s('x', 'Sanatani phonk', 'hindi', 1)])?.tag === 'phonk', 'a Hindi phonk is still phonk');
  check(soundOf([s('k', 'Kesariya', 'hindi', 1, 'Arijit Singh', 'Brahmastra')]) === undefined, 'a film song says no sound, and gets JioSaavn radio unchanged');
  check(soundOf([s('l', 'Pehle Bhi Main Lofi Mix', 'hindi', 1)])?.tag === 'lofi', 'lofi is read');
  const phonk = soundOf([gym])!;
  check(anchorQuery(phonk, [gym]) === 'phonk', 'phonk anchors are searched in any language');
  const lofi = soundOf([s('l', 'Lofi', 'hindi', 1)])!;
  check(anchorQuery(lofi, [s('l', 'Lofi', 'hindi', 1)]) === 'lofi hindi', 'lofi anchors are searched in the seed language');
  const found = [
    s('apme5aAa', 'Mexican Phonk Eki', 'english', 2523340, 'NUEKI'),
    s('hsRt7IJD', 'Mexican Phonk Eki (Slowed + Reverb)', 'english', 194765, 'NUEKI'),
    s('rpnUq3S8', 'GigaChad Theme (Phonk House Version)', 'instrumental', 1374702, 'g3ox_em'),
    s('0a5axeOE', 'GigaChad Theme (Phonk House Version) (Slowed)', 'english', 1373226, 'g3ox_em'),
    s('qVSrqS2k', 'Airtel Phonk', 'unknown', 19128000),
    s('o', 'O Maahi', 'hindi', 90000000, 'Arijit Singh'),
    gym,
  ];
  const anchors = pickAnchors(phonk, found, [gym]).map((a) => a.id);
  check(anchors.join() === 'apme5aAa,0a5axeOE', `anchors: best played, filed under a language, two singers, not the seed (${anchors.join()})`);
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nAll passed');
