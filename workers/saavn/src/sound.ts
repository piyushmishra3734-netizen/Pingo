/**
 * What a song sounds like, from what it is called.
 *
 * JioSaavn's radio follows a song's language and label more than its sound.
 * A well-known phonk track gets a station full of phonk, but a gym phonk
 * track from a small label is either "unknown" language and gets no station
 * at all, or tagged Hindi and gets the day's Bollywood hits: "O Mahi" after a
 * workout track.
 *
 * The fix uses JioSaavn's own radio rather than guessing in its place. A
 * station can take several seeds, and it follows what they share. So when a
 * song's title, album or artists name a sound ("phonk", "lofi", "slowed",
 * "bhajan"...), the radio is seeded with that song plus one or two
 * well-played songs of the same sound ("anchors"), and the station stays in
 * that sound. Tried on 2026-10-08: "Sanatani phonk" alone gave Badshah and
 * B Praak; with two phonk anchors, twelve phonk tracks.
 *
 * Kept free of imports so `pnpm verify:music` can check it with no network.
 */

export interface Sound {
  tag: string;
  /** What to search JioSaavn for to find anchors. */
  query: string;
  /** Matches the sound in a song's title, album or artists. */
  match: RegExp;
  /** Whether anchors should be in the seed's own language (lofi, bhajan) or not (phonk is phonk). */
  sameLanguage: boolean;
}

/** Most telling first: "Gym Phonk" is phonk before it is a workout. */
export const SOUNDS: Sound[] = [
  { tag: 'phonk', query: 'phonk', match: /phonk|montagem|\bfunk\b/i, sameLanguage: false },
  { tag: 'drill', query: 'drill', match: /\bdrill\b/i, sameLanguage: false },
  { tag: 'lofi', query: 'lofi', match: /\blo-?fi\b/i, sameLanguage: true },
  { tag: 'slowed', query: 'slowed reverb', match: /slowed|reverb/i, sameLanguage: true },
  { tag: 'edm', query: 'edm', match: /\bedm\b|\btechno\b|\btrance\b|dubstep|\bhouse mix\b/i, sameLanguage: false },
  { tag: 'trap', query: 'trap', match: /\btrap\b/i, sameLanguage: false },
  { tag: 'devotional', query: 'bhajan', match: /bhajan|aarti|chalisa|mantra|devotional|bhakti|stuti|kirtan/i, sameLanguage: true },
  { tag: 'qawwali', query: 'qawwali', match: /qawwali/i, sameLanguage: true },
  { tag: 'ghazal', query: 'ghazal', match: /ghazal/i, sameLanguage: true },
  { tag: 'instrumental', query: 'instrumental', match: /instrumental|\bpiano\b|\bflute\b|karaoke/i, sameLanguage: false },
  { tag: 'workout', query: 'gym workout', match: /\bgym\b|workout/i, sameLanguage: false },
  { tag: 'rap', query: 'rap', match: /\brap\b|hip ?hop/i, sameLanguage: true },
  { tag: 'unplugged', query: 'unplugged', match: /unplugged|acoustic/i, sameLanguage: true },
  { tag: 'remix', query: 'remix', match: /\bremix\b|\bmashup\b/i, sameLanguage: true },
];

export interface SongLike {
  id: string;
  name: string;
  album: { name: string };
  artists: { name: string }[];
  language: string;
  plays: number;
}

const said = (s: SongLike) => `${s.name} ${s.album.name} ${s.artists.map((a) => a.name).join(' ')}`;

/** The sound most of these songs share, if their names say one. */
export function soundOf(songs: SongLike[]): Sound | undefined {
  let best: { sound: Sound; n: number } | undefined;
  for (const sound of SOUNDS) {
    const n = songs.filter((s) => sound.match.test(said(s))).length;
    // Ties go to the earlier, more telling sound.
    if (n && (!best || n > best.n)) best = { sound, n };
  }
  return best?.sound;
}

/** The search to find anchors with: "lofi hindi", but just "phonk". */
export function anchorQuery(sound: Sound, seeds: SongLike[]): string {
  const lang = seeds.map((s) => s.language).find((l) => l && !UNFILED.has(l));
  return sound.sameLanguage && lang ? `${sound.query} ${lang}` : sound.query;
}

/**
 * The best-played songs of this sound, not already seeds: the ones JioSaavn's
 * radio knows most about, so the station has something solid to follow.
 *
 * Only songs JioSaavn files under a real language. One tagged "instrumental"
 * (the most-played GigaChad theme is) pulled the whole station to chart pop
 * when it was tried; "unknown" is a small label's song with no station of its
 * own, which is the problem being solved. And two different singers, so the
 * station is not one artist's.
 */
export function pickAnchors(sound: Sound, found: SongLike[], seeds: SongLike[], n = 2): SongLike[] {
  const seen = new Set(seeds.map((s) => s.id));
  const lang = seeds.map((s) => s.language).find((l) => l && !UNFILED.has(l));
  const leads = new Set<string>();
  const out: SongLike[] = [];
  for (const s of [...found].sort((a, b) => b.plays - a.plays)) {
    if (seen.has(s.id) || UNFILED.has(s.language) || !sound.match.test(said(s))) continue;
    if (sound.sameLanguage && lang && s.language !== lang) continue;
    const lead = (s.artists[0]?.name ?? '').toLowerCase();
    if (leads.has(lead)) continue;
    leads.add(lead);
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

const UNFILED = new Set(['', 'unknown', 'instrumental']);
