/**
 * Live state, shared by the rail, the setup, the host and the viewers.
 *
 * ## One channel per live, plus the tables
 *
 * Comments persist in `live_comments` (history for late joiners); hearts and
 * typing-feel do not - they travel over the `live:<id>` broadcast channel and
 * vanish, like Instagram. Presence on the same channel is the viewer count:
 * whoever is tracked is watching right now.
 *
 * ## The list refreshes from Postgres changes
 *
 * A dedicated channel watches `live_streams` inserts/updates so the rail grows
 * a LIVE circle the moment someone goes live, without touching the shared
 * realtime hub (whose table list is fixed at startup).
 */

import { useAuth, useProfile } from '@pingo/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';
import { LiveUnavailableError, SupabaseLiveService } from '../../lib/supabase/live-service.js';
import type { LiveComment, LiveHeart, LivePresenceEvent, LiveStream } from './types.js';

export interface LiveRoomEvent {
  comment?: LiveComment;
  heart?: LiveHeart;
  /** A pinned comment (or null for unpin). */
  pin?: LiveComment | null;
  /** Someone walked in. */
  join?: LivePresenceEvent;
  /** The host waved at one viewer. */
  wave?: { toUserId: string; fromName: string };
}

interface LiveContextValue {
  service: SupabaseLiveService;
  lives: LiveStream[];
  /** The signed-in user's own live, if they have one. */
  mine: LiveStream | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
  startLive: (title: string) => Promise<LiveStream>;
  endLive: (liveId: string) => Promise<void>;
}

const LiveContext = createContext<LiveContextValue | undefined>(undefined);

export function LiveProvider({ children }: { children: ReactNode }) {
  const { signedIn, session } = useAuth();
  const { profile } = useProfile();
  const meId = session?.user.id;
  const [service] = useState(() => new SupabaseLiveService());
  const [lives, setLives] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * A live with no server row behind it.
   *
   * Localhost runs before the migration lands: the tables do not exist yet, so
   * `startLive` would throw and the whole flow would be untappable. The preview
   * live lets the setup → countdown → host → end tour run end to end on camera
   * + broadcast only, and it dissolves the moment the real tables arrive.
   */
  const [preview, setPreview] = useState<LiveStream | undefined>();

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setLives([]);
      setPreview(undefined);
      setLoading(false);
      return;
    }
    try {
      setLives(await service.listLive());
    } catch {
      setLives([]);
    } finally {
      setLoading(false);
    }
  }, [service, signedIn]);

  /*
   * Counter flushes land as row updates every few seconds while anyone is
   * live. Re-reading the whole rail on each one is what made live screens
   * feel like they reloaded under your thumb - so rapid events coalesce
   * into one trailing refresh, and a hidden tab refreshes on return.
   */
  const refreshTimer = useRef<number | undefined>(undefined);
  const refreshSoon = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (refreshTimer.current) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = undefined;
      void refresh();
    }, 800);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Someone goes live or ends while this screen is open: re-read the rail.
  // Coalesced (see refreshSoon): counter flushes arrive every few seconds.
  useEffect(() => {
    if (!signedIn) return;
    const channel = getSupabaseClient()
      .channel('pingo:live-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_streams' },
        () => {
          refreshSoon();
        },
      )
      .subscribe();
    return () => {
      void getSupabaseClient().removeChannel(channel);
    };
  }, [signedIn, refreshSoon]);

  const startLive = useCallback(
    async (title: string) => {
      try {
        const live = await service.startLive(title);
        await refresh();
        return live;
      } catch (cause) {
        if (!(cause instanceof LiveUnavailableError) || !meId) throw cause;
        const local: LiveStream = {
          id: crypto.randomUUID(),
          hostId: meId,
          hostName: profile?.displayName ?? 'You',
          hostUsername: profile?.username ?? '',
          ...(profile?.avatarUrl ? { hostAvatarUrl: profile.avatarUrl } : {}),
          status: 'live',
          title: title.trim().slice(0, 80),
          viewerCount: 0,
          peakViewers: 0,
          totalJoins: 0,
          likesCount: 0,
          startedAt: Date.now(),
        };
        setPreview(local);
        return local;
      }
    },
    [service, refresh, meId, profile?.displayName, profile?.username, profile?.avatarUrl],
  );

  const endLive = useCallback(
    async (liveId: string) => {
      setPreview((previous) => (previous?.id === liveId ? undefined : previous));
      try {
        await service.endLive(liveId);
      } catch {
        // Preview lives have no row to end; dropping them is the whole job.
      }
      await refresh();
    },
    [service, refresh],
  );

  const allLives = useMemo(
    () => (preview ? [preview, ...lives.filter((live) => live.id !== preview.id)] : lives),
    [preview, lives],
  );
  const mine = useMemo(() => allLives.find((live) => live.hostId === meId), [allLives, meId]);

  const value = useMemo<LiveContextValue>(
    () => ({ service, lives: allLives, mine, loading, refresh, startLive, endLive }),
    [service, allLives, mine, loading, refresh, startLive, endLive],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const context = useContext(LiveContext);
  if (!context) throw new Error('useLive must be used inside a <LiveProvider>');
  return context;
}

/**
 * The room channel for one live: comments, hearts, pins, waves and presence.
 *
 * ONE joined channel per screen does everything: it listens, it announces
 * presence, and every send goes through it. The previous shape split those
 * across two channels and fired each message down a fresh unjoined one -
 * which is why the eye-count sat at zero and cross-device messages could
 * vanish without an error anywhere. Broadcast is fire-and-forget; the tables
 * stay the source of truth a late joiner reads.
 */
export function useLiveRoom(
  liveId: string | undefined,
  self: { userId: string; userName: string } | undefined,
  onEvent: (event: LiveRoomEvent) => void,
): {
  broadcastComment: (comment: LiveComment) => void;
  broadcastHeart: (heart: LiveHeart) => void;
  broadcastPin: (comment: LiveComment | null) => void;
  broadcastJoin: (userId: string, userName: string) => void;
  broadcastWave: (toUserId: string, fromName: string) => void;
  viewers: { userId: string; userName: string }[];
} {
  const [viewers, setViewers] = useState<{ userId: string; userName: string }[]>([]);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const selfRef = useRef(self);
  selfRef.current = self;
  const channelRef = useRef<RealtimeChannel | undefined>(undefined);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!liveId) return;
    const client = getSupabaseClient();
    const me = selfRef.current;
    const channel = client.channel(`live:${liveId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: me?.userId ?? `anon-${Math.random().toString(36).slice(2)}` },
      },
    });
    channelRef.current = channel;

    const readViewers = () => {
      const state = channel.presenceState<{ userId: string; userName: string }>();
      const seen = new Map<string, { userId: string; userName: string }>();
      for (const metas of Object.values(state)) {
        for (const meta of metas) {
          if (meta.userId && !seen.has(meta.userId)) {
            seen.set(meta.userId, { userId: meta.userId, userName: meta.userName });
          }
        }
      }
      setViewers([...seen.values()]);
    };

    channel
      .on('broadcast', { event: 'comment' }, ({ payload }) => {
        handler.current({ comment: payload as LiveComment });
      })
      .on('broadcast', { event: 'heart' }, ({ payload }) => {
        handler.current({ heart: payload as LiveHeart });
      })
      .on('broadcast', { event: 'pin' }, ({ payload }) => {
        handler.current({ pin: (payload ?? null) as LiveComment | null });
      })
      .on('broadcast', { event: 'join' }, ({ payload }) => {
        const peer = payload as { userId: string; userName: string };
        if (peer.userId === selfRef.current?.userId) return;
        handler.current({
          join: { id: `${peer.userId}-${Date.now()}`, userName: peer.userName, at: Date.now() },
        });
      })
      .on('broadcast', { event: 'wave' }, ({ payload }) => {
        handler.current({ wave: payload as { toUserId: string; fromName: string } });
      })
      .on('presence', { event: 'sync' }, readViewers)
      .on('presence', { event: 'join' }, readViewers)
      .on('presence', { event: 'leave' }, readViewers)
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        joinedRef.current = true;
        const tracked = selfRef.current;
        if (tracked) void channel.track(tracked).catch(() => undefined);
        readViewers();
      });

    return () => {
      joinedRef.current = false;
      channelRef.current = undefined;
      void channel.untrack().catch(() => undefined);
      void client.removeChannel(channel);
    };
  }, [liveId, self?.userId, self?.userName]);

  /*
   * Through the joined channel, with a short retry tail. A tap in the first
   * half-second must not be the one that goes missing.
   */
  const send = useCallback((event: string, payload: unknown, attempt = 0): void => {
    const channel = channelRef.current;
    if (channel && joinedRef.current) {
      void channel.send({ type: 'broadcast', event, payload }).catch(() => undefined);
      return;
    }
    if (attempt < 3) {
      window.setTimeout(() => send(event, payload, attempt + 1), 500);
    }
  }, []);

  const broadcastComment = useCallback(
    (comment: LiveComment) => send('comment', comment),
    [send],
  );

  const broadcastHeart = useCallback(
    (heart: LiveHeart) => send('heart', heart),
    [send],
  );

  const broadcastPin = useCallback(
    (comment: LiveComment | null) => send('pin', comment),
    [send],
  );

  const broadcastJoin = useCallback(
    (userId: string, userName: string) => send('join', { userId, userName }),
    [send],
  );

  const broadcastWave = useCallback(
    (toUserId: string, fromName: string) => send('wave', { toUserId, fromName }),
    [send],
  );

  return { broadcastComment, broadcastHeart, broadcastPin, broadcastJoin, broadcastWave, viewers };
}
