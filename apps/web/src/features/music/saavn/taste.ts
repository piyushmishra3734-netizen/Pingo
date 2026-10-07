/**
 * What somebody likes, read from what they play.
 *
 * Nothing clever and nothing sent anywhere: a handful of weights over the
 * person's own plays and likes, worked out on the phone. JioSaavn does the
 * heavy lifting (its stations are seeded with songs and pick what follows);
 * this only chooses good seeds and orders the home screen.
 *
 * ## The signals
 *
 * - A play that ran to the end counts; a skip counts against.
 * - A like counts for about as much as six full listens.
 * - Recent counts more than old: a half-life of two weeks, so a phase passes.
 */

export interface PlayRecord {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  language: string;
  plays: number;
  finished: number;
  lastPlayedAt: number;
}

export interface Taste {
  /** Best first. */
  artists: { id: string; name: string; score: number }[];
  languages: { language: string; score: number }[];
  /** Songs to seed "for you" radio with: well liked, recently, and not all by one artist. */
  seeds: string[];
}

const HALF_LIFE_MS = 14 * 24 * 3600_000;
const LIKE_WEIGHT = 6;

/** How much one song says about somebody's taste, now. */
export function songScore(r: PlayRecord, liked: boolean, now = Date.now()): number {
  const decay = Math.pow(0.5, Math.max(0, now - r.lastPlayedAt) / HALF_LIFE_MS);
  const skips = Math.max(0, r.plays - r.finished);
  // Finishing is the signal; a play that was skipped half-cancels itself.
  const listening = r.finished + 0.3 * (r.plays - skips) - 0.5 * skips;
  return Math.max(0, (listening + (liked ? LIKE_WEIGHT : 0)) * decay);
}

export function taste(records: PlayRecord[], likedIds: Set<string>, now = Date.now()): Taste {
  const artists = new Map<string, { id: string; name: string; score: number }>();
  const languages = new Map<string, number>();
  const scored = records.map((r) => ({ r, s: songScore(r, likedIds.has(r.id), now) })).filter((x) => x.s > 0);

  for (const { r, s } of scored) {
    // Credit is shared between the song's artists, so a duet is not double-counted.
    const share = s / Math.max(1, r.artists.length);
    for (const a of r.artists) {
      const key = a.id || a.name.toLowerCase();
      const e = artists.get(key) ?? { id: a.id, name: a.name, score: 0 };
      e.score += share;
      artists.set(key, e);
    }
    if (r.language) languages.set(r.language, (languages.get(r.language) ?? 0) + s);
  }

  // Seeds: the best songs, at most two per lead artist, so "for you" is not one singer on loop.
  const perArtist = new Map<string, number>();
  const seeds: string[] = [];
  for (const { r } of scored.sort((a, b) => b.s - a.s)) {
    const lead = r.artists[0]?.id || r.artists[0]?.name || '';
    const n = perArtist.get(lead) ?? 0;
    if (n >= 2) continue;
    perArtist.set(lead, n + 1);
    seeds.push(r.id);
    if (seeds.length >= 5) break;
  }

  return {
    artists: [...artists.values()].sort((a, b) => b.score - a.score),
    languages: [...languages.entries()].map(([language, score]) => ({ language, score })).sort((a, b) => b.score - a.score),
    seeds,
  };
}

/**
 * The languages to ask the home screen in: whatever somebody actually listens
 * to, at most three, with Hindi as the start for a person with no history yet.
 */
export function homeLanguages(t: Taste): string[] {
  const top = t.languages.filter((l) => l.score > 0.5).slice(0, 3).map((l) => l.language);
  return top.length ? top : ['hindi'];
}
