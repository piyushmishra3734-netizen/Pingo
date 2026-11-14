import { getSupabaseClient } from '../../lib/supabase/client.js';
import type { MediaType } from './types.js';

/**
 * What Pingo TV knows about a server beyond "its site answered".
 *
 * Two kinds of knowledge, both asked for when a title opens:
 *
 *  - **Checked**: `tv-check` asks the one server that answers honestly from a
 *    data centre (NontonGo) whether it has the title. "has" makes it a confirmed
 *    source, "missing" takes it out of the running.
 *  - **Learnt**: `tv_source_scores` says, per server, how many viewers kept
 *    watching this title on it and how many left it within a minute and a half.
 *    Every viewer's experience is one vote (see the migration
 *    `20261128000000_tv_source_votes.sql`).
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export type CheckAnswer = 'has' | 'show' | 'missing' | 'unknown';
export interface CrowdScore {
  worked: number;
  failed: number;
}

const episodeOf = (type: MediaType, season: number, episode: number) =>
  type === 'movie' ? { s: 0, e: 0 } : { s: season, e: episode };

/** Server-side "is it there", per server id. Empty when it cannot be asked. */
export async function checkServers(type: MediaType, id: number | string, season: number, episode: number): Promise<Record<string, CheckAnswer>> {
  if (!SUPABASE_URL) return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const q = new URLSearchParams({ type, id: String(id), s: String(season), e: String(episode) });
    const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/tv-check?${q}`, {
      headers: SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { sources?: Record<string, CheckAnswer> };
    return body.sources ?? {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** What other viewers found, per server id. Empty when nobody has voted (or it cannot be read). */
export async function fetchCrowdScores(type: MediaType, id: number | string, season: number, episode: number): Promise<Record<string, CrowdScore>> {
  const { s, e } = episodeOf(type, season, episode);
  try {
    const { data, error } = await getSupabaseClient().rpc('tv_source_scores' as never, {
      p_media_type: type,
      p_tmdb_id: Number(id),
      p_season: s,
      p_episode: e,
    } as never);
    if (error || !Array.isArray(data)) return {};
    const out: Record<string, CrowdScore> = {};
    for (const row of data as Array<{ source: string; worked: number; failed: number }>) {
      out[row.source] = { worked: row.worked, failed: row.failed };
    }
    return out;
  } catch {
    return {};
  }
}

const voted = new Set<string>();

/** One viewer's verdict on one server for this title. Signed-out viewers do not vote; failures are silent. */
export function voteSource(type: MediaType, id: number | string, season: number, episode: number, source: string, worked: boolean): void {
  const { s, e } = episodeOf(type, season, episode);
  const key = `${type}:${id}:${s}:${e}:${source}:${worked}`;
  if (voted.has(key)) return;
  voted.add(key);
  void Promise.resolve(
    getSupabaseClient().rpc('tv_source_vote' as never, {
      p_media_type: type,
      p_tmdb_id: Number(id),
      p_season: s,
      p_episode: e,
      p_source: source,
      p_worked: worked,
    } as never),
  ).catch(() => undefined);
}

/** Viewers kept watching it, more of them than left it. */
export const crowdLikes = (c: CrowdScore | undefined) => Boolean(c && c.worked >= 1 && c.worked > c.failed);
/** At least two viewers left it quickly and nobody stayed. */
export const crowdRejects = (c: CrowdScore | undefined) => Boolean(c && c.failed >= 2 && c.worked === 0);
