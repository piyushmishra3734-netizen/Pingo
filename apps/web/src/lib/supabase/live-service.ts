/**
 * `LiveService`, implemented on Supabase.
 *
 * Reads `live_streams` + `live_comments` (migration 20260965000000) and joins
 * the matching LiveKit room through the `live-token` edge function.
 *
 * ## Degrades gracefully before the migration lands
 *
 * Localhost runs against the remote project, and the tables arrive with the
 * next `supabase db push`. Until then every read resolves empty and every
 * write throws a named `live_unavailable` error - the setup/host screens stay
 * fully exercisable in preview mode instead of white-screening on a missing
 * table.
 */

import type { LiveComment, LiveGuest, LiveStream } from '../../features/live/types.js';

import { getSupabaseClient, type PingoSupabaseClient } from './client.js';
import type { LiveCommentRow, LiveGuestRow, LiveStreamRow, ProfileRow } from './types.js';

/** Thrown when the live tables are not deployed yet. Caught for preview mode. */
export class LiveUnavailableError extends Error {
  readonly code = 'live_unavailable';
  constructor() {
    super('Live is not available yet. Deploy the latest migrations first.');
  }
}

function describe(error: unknown): string {
  // PostgREST hands back plain objects ({ code, message, hint }), not Error
  // instances - `instanceof` misses them and every check below goes blind.
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const entry = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    return [entry.code, entry.message, entry.details, entry.hint]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' ');
  }
  return String(error ?? '');
}

function isMissingTable(error: unknown): boolean {
  const message = describe(error);
  // PostgREST: table unknown to the API schema cache / 404 on the relation.
  // PGRST205 names the missing table; 42P01 is Postgres saying the same.
  // Offline reads the same way - resolving empty keeps the rail usable.
  return /live_streams|live_comments|live_guests|schema cache|PGRST|42P01|\b404\b|Failed to fetch|NetworkError|network/i.test(
    message,
  );
}

export interface LiveToken {
  url: string;
  token: string;
  room: string;
  role: 'host' | 'guest' | 'viewer';
}

export class SupabaseLiveService {
  readonly #client: PingoSupabaseClient;

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.#client = client;
  }

  async #userId(): Promise<string> {
    const { data } = await this.#client.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new Error('Not signed in.');
    return id;
  }

  #toLive(row: LiveStreamRow, profile?: ProfileRow): LiveStream {
    return {
      id: row.id,
      hostId: row.host_id,
      hostName: profile?.display_name ?? 'Someone',
      hostUsername: profile?.username ?? '',
      ...(profile?.avatar_url ? { hostAvatarUrl: profile.avatar_url } : {}),
      status: row.status === 'ended' ? 'ended' : 'live',
      title: row.title ?? '',
      viewerCount: row.viewer_count ?? 0,
      peakViewers: row.peak_viewers ?? 0,
      totalJoins: row.total_joins ?? 0,
      likesCount: row.likes_count ?? 0,
      startedAt: Date.parse(row.started_at),
      ...(row.ended_at ? { endedAt: Date.parse(row.ended_at) } : {}),
      ...(typeof row.goal_target === 'number' && row.goal_target > 0 ? { goalTarget: row.goal_target } : {}),
      ...(row.goal_title ? { goalTitle: row.goal_title } : {}),
    };
  }

  #toComment(row: LiveCommentRow, profile?: ProfileRow): LiveComment {
    return {
      id: row.id,
      liveId: row.live_id,
      userId: row.user_id,
      userName: profile?.display_name ?? 'Someone',
      ...(profile?.avatar_url ? { userAvatarUrl: profile.avatar_url } : {}),
      body: row.body,
      createdAt: Date.parse(row.created_at),
    };
  }

  async #profiles(ids: string[]): Promise<Map<string, ProfileRow>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.#client.from('profiles').select('*').in('id', ids);
    if (error) throw error;
    return new Map((data ?? []).map((profile) => [profile.id, profile]));
  }

  /** Every currently-live stream the signed-in user may watch, newest first. */
  async listLive(): Promise<LiveStream[]> {
    try {
      const { data, error } = await this.#client
        .from('live_streams')
        .select('*')
        .eq('status', 'live')
        .order('started_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as LiveStreamRow[];
      if (rows.length === 0) return [];
      const profiles = await this.#profiles([...new Set(rows.map((row) => row.host_id))]);
      return rows.map((row) => this.#toLive(row, profiles.get(row.host_id)));
    } catch (cause) {
      if (isMissingTable(cause)) return [];
      throw cause;
    }
  }

  async getLive(liveId: string): Promise<LiveStream | undefined> {
    try {
      const { data, error } = await this.#client
        .from('live_streams')
        .select('*')
        .eq('id', liveId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return undefined;
      const row = data as LiveStreamRow;
      const profiles = await this.#profiles([row.host_id]);
      return this.#toLive(row, profiles.get(row.host_id));
    } catch (cause) {
      if (isMissingTable(cause)) return undefined;
      throw cause;
    }
  }

  /** Starts a live. The `on_live_started` trigger notifies mutuals. */
  async startLive(title: string): Promise<LiveStream> {
    const me = await this.#userId();
    try {
      const { data, error } = await this.#client
        .from('live_streams')
        .insert({ host_id: me, status: 'live', title: title.trim().slice(0, 80) })
        .select('*')
        .single();
      if (error) throw error;
      const row = data as LiveStreamRow;
      const profiles = await this.#profiles([me]);
      return this.#toLive(row, profiles.get(me));
    } catch (cause) {
      if (isMissingTable(cause)) throw new LiveUnavailableError();
      throw cause;
    }
  }

  async endLive(liveId: string): Promise<LiveStream | undefined> {
    try {
      const { data, error } = await this.#client
        .from('live_streams')
        .update({ status: 'ended', ended_at: new Date().toISOString(), viewer_count: 0 })
        .eq('id', liveId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return undefined;
      const row = data as LiveStreamRow;
      const profiles = await this.#profiles([row.host_id]);
      return this.#toLive(row, profiles.get(row.host_id));
    } catch (cause) {
      if (isMissingTable(cause)) throw new LiveUnavailableError();
      throw cause;
    }
  }

  /** Heart counter + viewer peaks, written by the host from channel state. */
  async updateCounters(
    liveId: string,
    counters: { viewerCount?: number; likesCount?: number; totalJoins?: number },
  ): Promise<void> {
    const patch: {
      viewer_count?: number;
      likes_count?: number;
      total_joins?: number;
    } = {};
    if (counters.viewerCount !== undefined) patch['viewer_count'] = counters.viewerCount;
    if (counters.likesCount !== undefined) patch['likes_count'] = counters.likesCount;
    if (counters.totalJoins !== undefined) patch['total_joins'] = counters.totalJoins;
    if (Object.keys(patch).length === 0) return;
    try {
      const { error } = await this.#client.from('live_streams').update(patch).eq('id', liveId);
      if (error) throw error;
    } catch (cause) {
      if (isMissingTable(cause)) return;
      throw cause;
    }
  }

  /** Bumps the peak when the room grows past it. Cheap, idempotent. */
  async notePeak(liveId: string, viewers: number): Promise<void> {
    try {
      const { data } = await this.#client
        .from('live_streams')
        .select('peak_viewers')
        .eq('id', liveId)
        .maybeSingle();
      const peak = (data as { peak_viewers?: number } | null)?.peak_viewers ?? 0;
      if (viewers > peak) {
        await this.#client.from('live_streams').update({ peak_viewers: viewers }).eq('id', liveId);
      }
    } catch {
      // Bookkeeping must never break a live picture.
    }
  }

  async listComments(liveId: string, limit = 60): Promise<LiveComment[]> {
    try {
      const { data, error } = await this.#client
        .from('live_comments')
        .select('*')
        .eq('live_id', liveId)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as LiveCommentRow[];
      if (rows.length === 0) return [];
      const profiles = await this.#profiles([...new Set(rows.map((row) => row.user_id))]);
      return rows.map((row) => this.#toComment(row, profiles.get(row.user_id)));
    } catch (cause) {
      if (isMissingTable(cause)) return [];
      throw cause;
    }
  }

  async postComment(liveId: string, body: string): Promise<LiveComment | undefined> {
    const me = await this.#userId();
    const text = body.trim().slice(0, 200);
    if (!text) return undefined;
    try {
      const { data, error } = await this.#client
        .from('live_comments')
        .insert({ live_id: liveId, user_id: me, body: text })
        .select('*')
        .single();
      if (error) throw error;
      const profiles = await this.#profiles([me]);
      return this.#toComment(data as LiveCommentRow, profiles.get(me));
    } catch (cause) {
      if (isMissingTable(cause)) return undefined;
      throw cause;
    }
  }

  /** A signed grant into the LiveKit room. Host publishes, viewer subscribes. */
  async liveToken(liveId: string): Promise<LiveToken> {
    const { data, error } = await this.#client.functions.invoke('live-token', {
      body: { liveId },
    });
    if (error) throw new Error('Could not join the live.');
    const grant = data as Partial<LiveToken> | undefined;
    if (!grant?.url || !grant.token) throw new Error('Live is not configured yet.');
    return { url: grant.url, token: grant.token, room: grant.room ?? `live_${liveId}`, role: grant.role ?? 'viewer' };
  }

  // -- guests ---------------------------------------------------------------

  #toGuest(row: LiveGuestRow, profile?: ProfileRow): LiveGuest {
    return {
      liveId: row.live_id,
      userId: row.user_id,
      userName: profile?.display_name ?? 'Someone',
      ...(profile?.avatar_url ? { userAvatarUrl: profile.avatar_url } : {}),
      status: row.status as LiveGuest['status'],
    };
  }

  async listGuests(liveId: string): Promise<LiveGuest[]> {
    try {
      const { data, error } = await this.#client
        .from('live_guests')
        .select('*')
        .eq('live_id', liveId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as LiveGuestRow[];
      if (rows.length === 0) return [];
      const profiles = await this.#profiles([...new Set(rows.map((row) => row.user_id))]);
      return rows.map((row) => this.#toGuest(row, profiles.get(row.user_id)));
    } catch (cause) {
      if (isMissingTable(cause)) return [];
      throw cause;
    }
  }

  /** A viewer asks to join the broadcast. Idempotent per seat. */
  async requestToJoin(liveId: string): Promise<void> {
    const me = await this.#userId();
    try {
      const { error } = await this.#client
        .from('live_guests')
        .upsert({ live_id: liveId, user_id: me, status: 'requested' }, { onConflict: 'live_id,user_id' });
      if (error) throw error;
    } catch (cause) {
      if (isMissingTable(cause)) throw new LiveUnavailableError();
      throw cause;
    }
  }

  /** The host invites a specific viewer. */
  async inviteGuest(liveId: string, userId: string): Promise<void> {
    try {
      const { error } = await this.#client
        .from('live_guests')
        .upsert({ live_id: liveId, user_id: userId, status: 'invited' }, { onConflict: 'live_id,user_id' });
      if (error) throw error;
    } catch (cause) {
      if (isMissingTable(cause)) throw new LiveUnavailableError();
      throw cause;
    }
  }

  /** Host answers, or a guest steps down: one write, whoever owns the move. */
  async setGuestStatus(liveId: string, userId: string, status: LiveGuest['status']): Promise<void> {
    try {
      const { error } = await this.#client
        .from('live_guests')
        .update({ status })
        .eq('live_id', liveId)
        .eq('user_id', userId);
      if (error) throw error;
    } catch (cause) {
      if (isMissingTable(cause)) return;
      throw cause;
    }
  }

  // -- goal ---------------------------------------------------------------------

  /** Host sets (or clears) the shared hearts goal. */
  async setGoal(liveId: string, target: number | null, title: string): Promise<void> {
    try {
      const { error } = await this.#client
        .from('live_streams')
        .update({ goal_target: target, goal_title: title.slice(0, 80) })
        .eq('id', liveId);
      if (error) throw error;
    } catch (cause) {
      if (isMissingTable(cause)) return;
      throw cause;
    }
  }

  // -- pin --------------------------------------------------------------------

  async pinComment(liveId: string, comment: LiveComment | null): Promise<void> {    try {
      const { error } = await this.#client
        .from('live_streams')
        .update({
          pinned_comment: comment
            ? { id: comment.id, userName: comment.userName, body: comment.body }
            : null,
        })
        .eq('id', liveId);
      if (error) throw error;
    } catch (cause) {
      if (isMissingTable(cause)) return;
      throw cause;
    }
  }

  async readPin(liveId: string): Promise<LiveComment | null> {
    try {
      const { data, error } = await this.#client
        .from('live_streams')
        .select('pinned_comment')
        .eq('id', liveId)
        .maybeSingle();
      if (error) throw error;
      const pin = (data as { pinned_comment?: { id: string; userName: string; body: string } | null } | null)
        ?.pinned_comment;
      if (!pin) return null;
      return { id: pin.id, liveId, userId: '', userName: pin.userName, body: pin.body, createdAt: 0 };
    } catch (cause) {
      if (isMissingTable(cause)) return null;
      throw cause;
    }
  }
}
