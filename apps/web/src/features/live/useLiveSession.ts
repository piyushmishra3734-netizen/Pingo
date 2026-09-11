/**
 * One live session, shared by host, guest and viewer screens.
 *
 * Loads the row, joins the broadcast room channel (comments, hearts, pins,
 * join lines, presence), tracks the guest handshake rows, and exposes send
 * actions. Media attach stays in the screens - each seat publishes or paints
 * differently - but everything textual lives here, once.
 */

import { useAuth, useProfile } from '@pingo/core';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';
import type {
  LiveComment,
  LiveGuest,
  LiveHeart,
  LivePresenceEvent,
  LiveStream,
} from './types.js';
import { useLive, useLiveRoom, type LiveRoomEvent } from './LiveContext.js';

export function useLiveSession(liveId: string | undefined) {
  const { service, refresh, lives } = useLive();
  const { session } = useAuth();
  const { profile } = useProfile();
  const meId = session?.user.id;

  const [live, setLive] = useState<LiveStream | undefined>();
  const [loading, setLoading] = useState(true);
  /**
   * Counters ride apart from identity.
   *
   * Flushes land every few seconds; folding them into `live` replaced the
   * object - and re-rendered three screens - on every flush. Counters update
   * here, everything else stays referentially still.
   */
  const [stats, setStats] = useState({ viewerCount: 0, likesCount: 0, peakViewers: 0, totalJoins: 0 });
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [hearts, setHearts] = useState<LiveHeart[]>([]);
  const [joins, setJoins] = useState<LivePresenceEvent[]>([]);
  const [pin, setPin] = useState<LiveComment | null>(null);
  const [guests, setGuests] = useState<LiveGuest[]>([]);
  /** Hearts per viewer this session: the Top fans board, no backend needed. */
  const [topFans, setTopFans] = useState<{ userId: string; userName: string; count: number }[]>([]);
  /** A wave landing on me. */
  const [wave, setWave] = useState<{ fromName: string; at: number } | undefined>();

  const meName = profile?.displayName ?? 'Someone';
  const meIdRef = useRef(meId);
  meIdRef.current = meId;

  const countFan = useCallback((userId: string, userName: string) => {
    setTopFans((previous) => {
      const existing = previous.find((fan) => fan.userId === userId);
      const next = existing
        ? previous.map((fan) => (fan.userId === userId ? { ...fan, count: fan.count + 1, userName } : fan))
        : [...previous, { userId, userName, count: 1 }];
      return next.sort((a, b) => b.count - a.count).slice(0, 20);
    });
  }, []);

  // ---- row ---------------------------------------------------------------
  // `lives` arrives by ref: the list re-reads on its own rhythm and must not
  // re-fire this fetch (each run is a network round trip mid-broadcast).
  const livesRef = useRef(lives);
  livesRef.current = lives;

  useEffect(() => {
    if (!liveId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    service
      .getLive(liveId)
      .then((row) => {
        // Preview lives have no server row: fall back to the context list,
        // which holds the local one until the migration lands.
        const found = row ?? livesRef.current.find((live) => live.id === liveId);
        if (active) {
          setLive(found);
          if (found) {
            setStats({
              viewerCount: found.viewerCount,
              likesCount: found.likesCount,
              peakViewers: found.peakViewers,
              totalJoins: found.totalJoins,
            });
          }
        }
      })
      .catch(() => {
        if (active) setLive(livesRef.current.find((live) => live.id === liveId));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [service, liveId]);

  // The host ending the live, or pinning, reaches every screen on realtime.
  useEffect(() => {
    if (!liveId) return;
    const channel = getSupabaseClient()
      .channel(`pingo:live-row:${liveId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_streams', filter: `id=eq.${liveId}` },
        (payload) => {
          const row = payload.new as {
            status?: string;
            pinned_comment?: unknown;
            goal_target?: number | null;
            goal_title?: string;
            viewer_count?: number;
            likes_count?: number;
            peak_viewers?: number;
            total_joins?: number;
          };
          // Counters flow to `stats` alone - never a new `live` object.
          if (
            typeof row.viewer_count === 'number' ||
            typeof row.likes_count === 'number' ||
            typeof row.peak_viewers === 'number' ||
            typeof row.total_joins === 'number'
          ) {
            setStats((previous) => {
              const next = {
                viewerCount: row.viewer_count ?? previous.viewerCount,
                likesCount: row.likes_count ?? previous.likesCount,
                peakViewers: row.peak_viewers ?? previous.peakViewers,
                totalJoins: row.total_joins ?? previous.totalJoins,
              };
              return next.viewerCount === previous.viewerCount &&
                next.likesCount === previous.likesCount &&
                next.peakViewers === previous.peakViewers &&
                next.totalJoins === previous.totalJoins
                ? previous
                : next;
            });
          }
          if (row.status === 'ended') {
            setLive((previous) => {
              if (!previous || previous.status === 'ended') return previous;
              return { ...previous, status: 'ended' };
            });
            void refresh();
          }
          if ('pinned_comment' in row) {
            const saved = row.pinned_comment as { id: string; userName: string; body: string } | null;
            setPin(
              saved
                ? { id: saved.id, liveId, userId: '', userName: saved.userName, body: saved.body, createdAt: 0 }
                : null,
            );
          }
          if ('goal_target' in row || 'goal_title' in row) {
            setLive((previous) => {
              if (!previous) return previous;
              const goalTarget =
                typeof row.goal_target === 'number' && row.goal_target > 0 ? row.goal_target : undefined;
              const goalTitle = typeof row.goal_title === 'string' && row.goal_title ? row.goal_title : undefined;
              return previous.goalTarget === goalTarget && previous.goalTitle === goalTitle
                ? previous
                : { ...previous, goalTarget, goalTitle };
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_guests', filter: `live_id=eq.${liveId}` },
        () => {
          service
            .listGuests(liveId)
            .then(setGuests)
            .catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      void getSupabaseClient().removeChannel(channel);
    };
  }, [liveId, refresh, service]);

  // ---- room channel -------------------------------------------------------
  const pushHeart = useCallback((heart: LiveHeart) => {
    setHearts((previous) => [...previous.slice(-29), heart]);
    window.setTimeout(() => {
      setHearts((previous) => previous.filter((entry) => entry.id !== heart.id));
    }, 2300);
  }, []);

  const onEvent = useCallback(
    (event: LiveRoomEvent) => {
      if (event.comment) {
        setComments((previous) => {
          if (previous.some((comment) => comment.id === event.comment!.id)) return previous;
          return [...previous.slice(-79), event.comment!];
        });
      }
      if (event.heart) {
        pushHeart(event.heart);
        countFan(event.heart.userId, event.heart.userName);
      }
      if (event.pin !== undefined) setPin(event.pin);
      if (event.join) {
        const join = event.join;
        setJoins((previous) => [...previous.slice(-9), join]);
        window.setTimeout(() => {
          setJoins((previous) => previous.filter((entry) => entry.id !== join.id));
        }, 6000);
      }
      if (event.wave) {
        if (event.wave.toUserId === meIdRef.current) {
          const stamp = { fromName: event.wave.fromName, at: Date.now() };
          setWave(stamp);
          window.setTimeout(() => {
            setWave((previous) => (previous?.at === stamp.at ? undefined : previous));
          }, 3000);
        }
      }
    },
    [pushHeart, countFan],
  );

  const { broadcastComment, broadcastHeart, broadcastPin, broadcastJoin, broadcastWave, viewers } = useLiveRoom(
    live ? live.id : undefined,
    meId ? { userId: meId, userName: meName } : undefined,
    onEvent,
  );

  // ---- history for late joiners -------------------------------------------
  useEffect(() => {
    if (!live) return;
    let active = true;
    service
      .listComments(live.id)
      .then((history) => {
        if (active) setComments(history.slice(-80));
      })
      .catch(() => undefined);
    service
      .readPin(live.id)
      .then((saved) => {
        if (active) setPin(saved);
      })
      .catch(() => undefined);
    service
      .listGuests(live.id)
      .then((rows) => {
        if (active) setGuests(rows);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [service, live?.id]);

  // ---- actions --------------------------------------------------------------
  const sendComment = useCallback(
    async (body: string) => {
      if (!live || !body.trim()) return;
      try {
        const saved = await service.postComment(live.id, body);
        if (saved) {
          setComments((previous) => [...previous.slice(-79), saved]);
          broadcastComment(saved);
        } else {
          // Preview mode (tables not deployed yet): local echo over broadcast.
          const echo: LiveComment = {
            id: crypto.randomUUID(),
            liveId: live.id,
            userId: meId ?? 'me',
            userName: meName,
            body: body.trim().slice(0, 200),
            createdAt: Date.now(),
          };
          setComments((previous) => [...previous.slice(-79), echo]);
          broadcastComment(echo);
        }
      } catch {
        // A comment that cannot send is dropped visibly nowhere - the input
        // keeps its text (the screen clears only on success).
      }
    },
    [service, live, broadcastComment, meId, meName],
  );

  const sendHeart = useCallback(
    (x?: number, y?: number) => {
      if (!live) return;
      const heart: LiveHeart = {
        id: crypto.randomUUID(),
        userId: meId ?? 'me',
        userName: meName,
        at: Date.now(),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
      };
      pushHeart(heart);
      countFan(heart.userId, heart.userName);
      broadcastHeart(heart);
    },
    [live, broadcastHeart, pushHeart, countFan, meId, meName],
  );

  const announceJoin = useCallback(() => {
    if (!live || !meId) return;
    broadcastJoin(meId, meName);
  }, [live, meId, meName, broadcastJoin]);

  const sendWave = useCallback(
    (toUserId: string) => {
      if (!live) return;
      broadcastWave(toUserId, meName);
    },
    [live, broadcastWave, meName],
  );

  const pinComment = useCallback(
    async (comment: LiveComment | null) => {
      if (!live) return;
      setPin(comment);
      broadcastPin(comment);
      await service.pinComment(live.id, comment);
    },
    [service, live, broadcastPin],
  );

  return {
    live,
    stats,
    loading,
    comments,
    hearts,
    joins,
    pin,
    guests,
    topFans,
    wave,
    viewers,
    meId,
    meName,
    myAvatarUrl: profile?.avatarUrl,
    sendComment,
    sendHeart,
    sendWave,
    announceJoin,
    pinComment,
    setLive,
  };
}

/** LiveKit grant, fetched once per session. Throws when not configured. */
export async function fetchLiveGrant(
  liveId: string,
): Promise<{ url: string; token: string; room: string; role: 'host' | 'guest' | 'viewer' }> {
  const { data, error } = await getSupabaseClient().functions.invoke('live-token', {
    body: { liveId },
  });
  if (error) throw new Error('Could not join the live.');
  const grant = data as { url?: string; token?: string; room?: string; role?: 'host' | 'guest' | 'viewer' };
  if (!grant?.url || !grant.token) throw new Error('Live is not configured yet.');
  return { url: grant.url, token: grant.token, room: grant.room ?? `live_${liveId}`, role: grant.role ?? 'viewer' };
}

export function useMountedRef(): MutableRefObject<boolean> {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}
