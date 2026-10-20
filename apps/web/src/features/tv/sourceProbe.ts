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
const PROBE_TIMEOUT_MS = 9000;

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
 * Ask one resolver provider for this exact episode.
 *
 * This is the only probe that can answer "does this source have it", because it
 * returns the playlist itself rather than a page that has to be trusted.
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
    return (await response.json()) as {
      success?: boolean;
      sources?: { url?: string; quality?: string; audioTracks?: { label?: string; language?: string }[] }[];
    };
  }, PROBE_TIMEOUT_MS);

  const first = result?.sources?.[0];
  const ms = Date.now() - started;

  if (!result?.success || !first?.url) {
    return { id: apiProvider, status: 'empty', ms };
  }

  return {
    id: apiProvider,
    status: 'ready',
    url: first.url,
    quality: first.quality,
    audio: (first.audioTracks ?? []).map((track) => track.label || track.language || '').filter(Boolean),
    ms,
  };
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
