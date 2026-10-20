import type { MediaType } from './types.js';

/**
 * Asking every source at once instead of one after another.
 *
 * The old behaviour was a queue: try a source, wait, decide it did not work,
 * try the next. On a title whose first four sources are empty that is a minute
 * of black screen before anything happens.
 *
 * This does the opposite. Every source is asked in parallel, on the viewer's own
 * device and connection, and the answers are ranked. The player opens on the
 * best one that answered and the rest are there to switch to. Nothing is tried
 * twice.
 *
 * Two kinds of answer:
 *
 *   - Resolver sources answer with a playlist. That is proof: the source has
 *     this exact episode, and the playlist says what audio it carries.
 *   - Iframe sources cannot be read cross-origin, so the most that can be
 *     learned is whether the host answers at all. They are marked `reachable`,
 *     which is weaker than `ready` and ranked below it.
 */

export type ProbeStatus = 'pending' | 'ready' | 'reachable' | 'empty' | 'down';

export interface SourceProbe {
  id: string;
  status: ProbeStatus;
  /** Playlist, for resolver sources that answered. */
  url?: string;
  quality?: string;
  /** Audio track labels the playlist carries, e.g. ['English', 'Hindi']. */
  audio?: string[];
  /** How long the source took to answer, in ms. Lower is better. */
  ms?: number;
}

const FRAMEXTV_API = 'https://api.framextv.tech';
/**
 * How long one provider gets, start to finish.
 *
 * Some of them answer in 1.5s and some need 11s because their source list has to
 * be walked — and at 9s those slow ones timed out and were reported as empty,
 * which is how a working provider looked dead.
 */
const PROBE_TIMEOUT_MS = 18000;

/** The last-segment sanity check must not be what fails a provider. */
const SEGMENT_TIMEOUT_MS = 6000;

/** A host that cannot be reached at all; used for iframe sources. */
const REACH_TIMEOUT_MS = 5000;

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A playlist whose segments are images is not a film.
 *
 * Several of these servers answer with a perfectly valid m3u8 whose segments
 * are `.jpg` files, thousands of them — a slideshow, not video. It looks like a
 * working source to every check that only asks "did the URL answer": the
 * playlist is 200, the content type is right, the segments exist. The player
 * then spins, retries, and restarts from the beginning, which is the load loop
 * that was reported as a player bug.
 */
export function playlistIsImages(text: string): boolean {
  const segments = [...text.matchAll(/^https?:\/\/\S+$/gim)].map((match) => match[0]);
  if (!segments.length) return false;
  const imagey = segments.filter((url) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)).length;
  return imagey / segments.length > 0.8;
}

/**
 * Does this playlist contain a variant the browser can actually decode?
 *
 * A playlist URL that answers 200 is not a stream that plays. Several of these
 * servers publish 4K variants in HEVC (`hvc1`/`hev1`), which Chrome on Windows
 * has no decoder for — the element reports MEDIA_ERR_SRC_NOT_SUPPORTED (code 4)
 * and the viewer gets a black rectangle that looked like a working source in
 * every check before this one.
 *
 * H.264 (`avc1`) is the codec every browser here can play, so a playlist with at
 * least one `avc1` variant is playable; one with only HEVC is not.
 */
export function playlistIsPlayable(text: string): boolean {
  const codecLists = [...text.matchAll(/CODECS="([^"]+)"/gi)].map((match) => (match[1] ?? '').toLowerCase());
  if (!codecLists.length) return true; // a media playlist, not a master: let the player try
  return codecLists.some((list) => list.includes('avc1'));
}

/** The first segment URL in a media playlist, or the first variant in a master. */
function firstMediaUrl(text: string): string | null {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const segment = lines.find((line) => line.startsWith('http') && !line.startsWith('#'));
  return segment ?? null;
}

type ApiSource = {
  url?: string;
  quality?: string;
  audioTracks?: { label?: string; language?: string }[];
};

/**
 * Ask one resolver provider for this exact episode, and prove the answer.
 *
 * "Success" from the API is not the same as a stream. A provider can return
 * several sources and most of them can be worthless: one points at a JPEG
 * slideshow, another 404s, another is HEVC-only. So every source it offers is
 * walked, and the first one that is a real, decodable, reachable video playlist
 * is the one that counts.
 */
export async function probeResolver(
  apiProvider: string,
  type: MediaType,
  id: number | string,
  season: number,
  episode: number,
): Promise<SourceProbe> {
  const started = Date.now();
  const query = new URLSearchParams({ type, id: String(id), provider: apiProvider });
  if (type === 'tv') {
    query.set('season', String(season));
    query.set('episode', String(episode));
  }

  const result = await withTimeout(async (signal) => {
    const response = await fetch(`${FRAMEXTV_API}/api/stream?${query}`, {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as { success?: boolean; sources?: ApiSource[] };
  }, PROBE_TIMEOUT_MS);

  const candidates = (result?.sources ?? []).filter((source): source is ApiSource & { url: string } =>
    Boolean(source.url),
  );

  if (!result?.success || !candidates.length) {
    return { id: apiProvider, status: 'empty', ms: Date.now() - started };
  }

  for (const candidate of candidates) {
    const playlistUrl = candidate.url;

    const text = await withTimeout(async (signal) => {
      const response = await fetch(playlistUrl, { signal });
      if (!response.ok) return null;
      return await response.text();
    }, PROBE_TIMEOUT_MS);

    // Not a playlist, or a playlist of pictures: the two shapes of "it answers
    // but there is nothing to watch".
    if (!text || !/#EXTM3U/i.test(text)) continue;
    if (playlistIsImages(text)) continue;
    if (!playlistIsPlayable(text)) continue;

    /*
     * The last lie a source can tell: a valid playlist whose segments are gone.
     *
     * Only a definite "no" disqualifies. A slow segment — these hosts serve
     * multi-megabyte parts with the wrong content type and take seconds — is
     * not evidence of a broken source, and treating a timeout as failure is how
     * working providers disappeared from the list.
     */
    const segment = firstMediaUrl(text);
    if (segment) {
      const verdict = await withTimeout(async (signal) => {
        const response = await fetch(segment, {
          headers: { range: 'bytes=0-1023' },
          signal,
        });
        return response.ok || response.status === 206;
      }, SEGMENT_TIMEOUT_MS);
      if (verdict === false) continue;
    }

    return {
      id: apiProvider,
      status: 'ready',
      url: playlistUrl,
      quality: candidate.quality,
      audio: (candidate.audioTracks ?? [])
        .map((track) => track.label || track.language || '')
        .filter(Boolean),
      ms: Date.now() - started,
    };
  }

  return { id: apiProvider, status: 'empty', quality: candidates[0]?.quality, ms: Date.now() - started };
}

/**
 * Can the browser open a connection to this host at all?
 *
 * `no-cors` on purpose: any HTTP response resolves as an opaque one, so this
 * asks "did the host answer", not "what did it say". An iframe's contents stay
 * unreadable either way.
 */
export async function probeIframe(url: string): Promise<SourceProbe['status']> {
  const answered = await withTimeout(async (signal) => {
    await fetch(url, { mode: 'no-cors', referrerPolicy: 'no-referrer', signal });
    return true;
  }, REACH_TIMEOUT_MS);
  return answered ? 'reachable' : 'down';
}

/** Quality strings the resolver uses, turned into a number that can be compared. */
function qualityScore(quality?: string): number {
  if (!quality) return 0;
  const text = quality.toLowerCase();
  if (text.includes('4k') || text.includes('2160')) return 2160;
  const match = text.match(/(\d{3,4})p/);
  return match ? Number(match[1]) : 0;
}

export type AudioPreference = 'hi' | 'en' | 'any';

function languageScore(probe: SourceProbe, preference: AudioPreference): number {
  if (preference === 'any' || !probe.audio?.length) return 0;
  const wanted = preference === 'hi' ? /hindi|hin\b/i : /english|eng\b/i;
  return probe.audio.some((label) => wanted.test(label)) ? 1000 : 0;
}

/**
 * Best first.
 *
 * A playlist that carries the viewer's language beats a playlist that does not;
 * a playlist beats a host that merely answers; a faster answer beats a slower
 * one; and quality breaks the remaining ties. The input order is the last
 * resort, so the hand-tuned `SOURCE_ORDER` still decides between equals.
 */
export function rankProbes(
  probes: SourceProbe[],
  order: readonly string[],
  preference: AudioPreference,
): SourceProbe[] {
  const position = new Map(order.map((id, index) => [id, index]));

  return [...probes].sort((a, b) => {
    const statusRank = (probe: SourceProbe) =>
      probe.status === 'ready' ? 3 : probe.status === 'reachable' ? 2 : probe.status === 'empty' ? 0 : -1;

    const byStatus = statusRank(b) - statusRank(a);
    if (byStatus !== 0) return byStatus;

    const byLanguage = languageScore(b, preference) - languageScore(a, preference);
    if (byLanguage !== 0) return byLanguage;

    const byQuality = qualityScore(b.quality) - qualityScore(a.quality);
    if (byQuality !== 0) return byQuality;

    const bySpeed = (a.ms ?? Number.MAX_SAFE_INTEGER) - (b.ms ?? Number.MAX_SAFE_INTEGER);
    if (bySpeed !== 0) return bySpeed;

    return (position.get(a.id) ?? 999) - (position.get(b.id) ?? 999);
  });
}
