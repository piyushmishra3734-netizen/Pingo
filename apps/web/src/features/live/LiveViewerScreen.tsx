/**
 * Watching a live.
 *
 * The shape every live app converged on: the broadcast full-bleed, the host
 * named top-left with a Follow button beside them, close top-right, comments
 * as bare text over the picture, a heart wherever a double-tap lands, and a
 * single tap hiding all of it for the unobstructed picture. Join lines and the
 * viewer count are the social proof; the guest button is the way in.
 */

import { Avatar, CloseIcon, PingoDot, ShareIcon, UsersIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProfile, type FollowState } from '@pingo/core';

import { Sheet, SheetCancel } from '../../components/Sheet.js';
import type { LiveViewerRoom } from '../../lib/livekit/live-room.js';
import { useLive, useLivePresence } from './LiveContext.js';
import {
  FanRow,
  LiveComments,
  LiveComposer,
  LiveHearts,
  LiveHostCluster,
  LivePin,
  LiveGoal,
  buzz,
  readBumpStreak,
  useTapGestures,
} from './LiveWidgets.js';
import { fetchLiveGrant, useLiveSession, useMountedRef } from './useLiveSession.js';

export function LiveViewerScreen() {
  const { liveId } = useParams<{ liveId: string }>();
  const navigate = useNavigate();
  const { service: lives } = useLive();
  const { service: profiles } = useProfile();
  const session = useLiveSession(liveId);
  const {
    live,
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
    sendComment,
    sendHeart,
    announceJoin,
  } = session;
  const mounted = useMountedRef();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<LiveViewerRoom | undefined>(undefined);
  const [joined, setJoined] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [shared, setShared] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [follow, setFollow] = useState<FollowState | undefined>();
  const [requesting, setRequesting] = useState(false);
  const [fansTab, setFansTab] = useState(false);
  /** Consecutive lives of this host watched. The streak that brings you back. */
  const [streak, setStreak] = useState(1);

  useLivePresence(live?.id, meId ? { userId: meId, userName: meName } : undefined);

  // Counted once per mount: walking in extends the streak.
  useEffect(() => {
    if (live && meId && live.hostId !== meId) {
      setStreak(readBumpStreak(live.hostId, live.id));
      buzz(10);
    }
  }, [live?.id]);

  const watchers = viewers.filter((viewer) => viewer.userId !== meId);
  const audience = watchers.length + 1;
  const mySeat = guests.find((guest) => guest.userId === meId);
  const onAirGuest = guests.find((guest) => guest.status === 'joined');

  // Follow state drives the button beside the host's name.
  useEffect(() => {
    if (!live || live.hostId === meId) {
      setFollow(undefined);
      return;
    }
    let active = true;
    profiles
      .followState(live.hostId)
      .then((state) => {
        if (active) setFollow(state);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [profiles, live?.id, live?.hostId, meId]);

  // ---- subscribe ---------------------------------------------------------
  useEffect(() => {
    if (!live || live.status !== 'live' || roomRef.current) return;
    let cancelled = false;

    announceJoin();
    (async () => {
      try {
        const grant = await fetchLiveGrant(live.id);
        const { joinLiveAsViewer } = await import('../../lib/livekit/live-room.js');
        if (cancelled) return;
        const room = await joinLiveAsViewer(
          grant,
          (stream) => {
            const element = videoRef.current;
            if (!element) return;
            element.srcObject = stream;
            void element.play().catch(() => undefined);
            if (mounted.current) setJoined(true);
          },
          () => {
            if (mounted.current) setJoined(false);
          },
          () => {
            if (mounted.current) setJoined(false);
          },
        );
        if (cancelled) {
          await room.leave().catch(() => undefined);
          return;
        }
        roomRef.current = room;
      } catch {
        // No transport (or no grant): comments, hearts and presence still
        // work - the picture waits for the broadcast instead of erroring.
        if (mounted.current) setJoined(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [live?.id, live?.status, announceJoin, mounted]);

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = undefined;
      if (room) void room.leave().catch(() => undefined);
    };
  }, []);

  // An invite or approval lands while watching: go be a guest.
  useEffect(() => {
    if (mySeat && (mySeat.status === 'invited' || mySeat.status === 'joined')) {
      navigate(`/live/guest/${liveId}`, { replace: true });
    }
  }, [mySeat?.status, liveId, navigate]);

  const gestures = useTapGestures({
    onSingleTap: () => setChrome((visible) => !visible),
    onDoubleTap: (x, y) => {
      sendHeart(x, y);
    },
  });

  const followHost = async () => {
    if (!live || follow !== 'none') return;
    try {
      setFollow(await profiles.requestFollow(live.hostId));
    } catch {
      // The button keeps its label; the request can be retried.
    }
  };

  const askToJoin = async () => {
    if (!liveId || requesting) return;
    setRequesting(true);
    try {
      await lives.requestToJoin(liveId);
    } catch {
      // The button stays; asking twice is harmless.
    } finally {
      if (mounted.current) setRequesting(false);
    }
  };

  const share = async () => {
    if (!live) return;
    const url = `${window.location.origin}/live/${live.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${live.hostName} is live on PINGO`, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // The rail already leads here; sharing is a courtesy.
      }
    }
    setShared(true);
    window.setTimeout(() => {
      if (mounted.current) setShared(false);
    }, 1600);
  };

  const leave = () => navigate('/chats');

  // ---- states ---------------------------------------------------------------
  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-backdrop">
        <PingoDot state="loading" size={8} label="Joining live" />
      </div>
    );
  }

  if (!live || live.status === 'ended') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-backdrop px-8 text-center">
        <Avatar name={live?.hostName ?? '?'} id={live?.hostId} {...(live?.hostAvatarUrl ? { src: live.hostAvatarUrl } : {})} size="lg" />
        <p className="mt-2 text-h2 text-white">This live has ended</p>
        <p className="text-body text-white/60">
          {live ? `${live.hostName}'s broadcast is over.` : 'It may have just finished.'}
        </p>
        <button
          type="button"
          onClick={leave}
          className="focus-ring mt-2 rounded-full bg-white px-5 py-2.5 text-body font-medium text-backdrop"
        >
          Back to chats
        </button>
      </div>
    );
  }

  const asked = mySeat?.status === 'requested';

  return (
    <div ref={gestures} className="relative flex h-full touch-none flex-col overflow-hidden bg-backdrop select-none">
      {/* ---- picture ------------------------------------------------------ */}
      <div className="absolute inset-0">
        <video ref={videoRef} playsInline className="absolute inset-0 size-full object-cover" />
        {!joined && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <Avatar name={live.hostName} id={live.hostId} {...(live.hostAvatarUrl ? { src: live.hostAvatarUrl } : {})} size="lg" />
            <p className="text-body font-medium text-white">{live.hostName} is live</p>
            <p className="flex items-center gap-2 text-caption text-white/60">
              <PingoDot state="loading" size={4} />
              Joining the broadcast…
            </p>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/65 to-transparent" />
      </div>

      <LiveHearts hearts={hearts} />

      {/* A wave landing: the host noticed you, personally. */}
      {wave && (
        <div className="animate-fade-in pointer-events-none absolute inset-x-0 top-24 z-20 flex justify-center">
          <p className="rounded-full bg-white px-4 py-2 text-body font-semibold text-ink shadow-lg">
            👋 {wave.fromName} waved at you
          </p>
        </div>
      )}

      {/* ---- top ------------------------------------------------------------ */}
      <div
        className={cn(
          'relative z-10 flex items-start justify-between gap-3 px-4 pt-[max(0.875rem,env(safe-area-inset-top))]',
          'transition-opacity duration-200',
          !chrome && 'pointer-events-none opacity-0',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <LiveHostCluster
            hostName={live.hostName}
            hostId={live.hostId}
            {...(live.hostAvatarUrl ? { hostAvatarUrl: live.hostAvatarUrl } : {})}
            viewerCount={audience}
            {...(follow === 'none'
              ? { followLabel: 'Follow', onFollow: () => void followHost() }
              : follow === 'requested'
                ? { followLabel: 'Requested' }
                : {})}
          />
          {onAirGuest && (
            <span className="shrink-0 rounded-full bg-black/45 px-2.5 py-1 text-[0.6875rem] font-medium text-white backdrop-blur-glass">
              + {onAirGuest.userName.split(' ')[0]}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label={shared ? 'Link copied' : 'Share live'}
            onClick={() => void share()}
            className={cn(
              'focus-ring grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-glass',
              'transition-transform duration-instant active:scale-95',
              shared && 'bg-white text-ink',
            )}
          >
            <ShareIcon size={18} />
          </button>
          <button
            type="button"
            aria-label="Leave live"
            onClick={leave}
            className="focus-ring grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-glass transition-transform duration-instant active:scale-95"
          >
            <CloseIcon size={19} />
          </button>
        </div>
      </div>

      {/* ---- bottom ----------------------------------------------------------- */}
      <div
        className={cn(
          'relative z-10 mt-auto space-y-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
          'transition-opacity duration-200',
          !chrome && 'pointer-events-none opacity-0',
        )}
      >
        <button
          type="button"
          onClick={() => setShowViewers(true)}
          className="focus-ring flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 text-caption text-white backdrop-blur-glass"
        >
          <UsersIcon size={14} />
          <span className="tabular-nums">{audience}</span>
          {streak >= 2 && (
            <span className="font-bold text-white" aria-label={`${streak} live streak`}>
              · 🔥{streak}
            </span>
          )}
        </button>

        {pin && <LivePin comment={pin} />}

        {live.goalTarget && (
          <LiveGoal title={live.goalTitle ?? ''} target={live.goalTarget} current={live.likesCount} />
        )}

        <LiveComments comments={comments} joins={joins} />

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <LiveComposer onSend={(body) => void sendComment(body)} onHeart={() => sendHeart()} placeholder="Say hi…" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={asked || requesting}
            onClick={() => void askToJoin()}
            className={cn(
              'focus-ring flex flex-1 items-center justify-center gap-2 rounded-full border border-white/30 bg-black/30 py-2.5 text-caption font-semibold text-white backdrop-blur-glass',
              'transition-transform duration-instant active:scale-[0.98] disabled:opacity-60',
            )}
          >
            <UsersIcon size={15} />
            {asked ? 'Request sent - waiting for host' : requesting ? 'Asking…' : 'Request to join'}
          </button>
        </div>
      </div>

      {/* ---- viewers ------------------------------------------------------------ */}
      {showViewers && (
        <Sheet
          title={fansTab ? 'Top fans' : `${audience} watching`}
          onClose={() => {
            setShowViewers(false);
            setFansTab(false);
          }}
          elevated
        >
          <div className="mt-2 flex gap-1.5" role="tablist" aria-label="Viewers">
            {(['watching', 'fans'] as const).map((tab) => {
              const active = fansTab === (tab === 'fans');
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFansTab(tab === 'fans')}
                  className={cn(
                    'focus-ring flex-1 rounded-full py-2 text-caption font-semibold',
                    active ? 'bg-ink text-white' : 'bg-sunken text-text-secondary',
                  )}
                >
                  {tab === 'watching' ? `Watching (${audience})` : 'Top fans'}
                </button>
              );
            })}
          </div>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {!fansTab &&
              watchers.length === 0 &&
              topFans.length === 0 && (
                <li className="px-1 py-4 text-center text-caption text-text-secondary">
                  Just you and the host, for now.
                </li>
              )}
            {!fansTab &&
              watchers.map((viewer) => (
                <FanRow key={viewer.userId} name={viewer.userName} />
              ))}
            {fansTab &&
              topFans.length === 0 && (
                <li className="px-1 py-4 text-center text-caption text-text-secondary">
                  No hearts yet - tap to take the crown.
                </li>
              )}
            {fansTab &&
              topFans.map((fan, index) => (
                <FanRow
                  key={fan.userId}
                  name={fan.userName}
                  count={fan.count}
                  rank={index + 1}
                  you={fan.userId === meId}
                />
              ))}
          </ul>
          <SheetCancel
            onClick={() => {
              setShowViewers(false);
              setFansTab(false);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
