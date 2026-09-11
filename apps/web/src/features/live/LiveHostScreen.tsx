/**
 * Hosting a live.
 *
 * The host sees what the audience sees, plus the tools of the trade: flip the
 * camera, bring a viewer on screen, pin the comment worth answering, and end
 * it all from the X. Guests arrive as requests, leave as a tap, and the split
 * screen is the whole of the layout - host above, guest below, names on both.
 */

import {
  CameraFlipIcon,
  CheckIcon,
  CloseIcon,
  CommentIcon,
  EyeIcon,
  HeartIcon,
  MoreIcon,
  PingoDot,
  ShareIcon,
  UsersIcon,
  VideoOffIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useChat } from '@pingo/core';

import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';
import type { LiveHostRoom } from '../../lib/livekit/live-room.js';
import { useLive, useLivePresence } from './LiveContext.js';
import {
  LiveComments,
  LiveComposer,
  LiveHearts,
  LiveHostCluster,
  LivePin,
  LiveGoal,
  LiveTimer,
  FanRow,
  buzz,
  useTapGestures,
} from './LiveWidgets.js';
import { fetchLiveGrant, useLiveSession, useMountedRef } from './useLiveSession.js';
import { useLivePreview } from './useLivePreview.js';
import { PeoplePicker } from '../stories/PeoplePicker.js';

export function LiveHostScreen() {
  const { liveId } = useParams<{ liveId: string }>();
  const navigate = useNavigate();
  const { service, endLive } = useLive();
  const { service: chat } = useChat();
  const session = useLiveSession(liveId);
  const {
    live,
    stats,
    loading,
    comments,
    hearts,
    joins,
    pin,
    guests,
    topFans,
    viewers,
    meId,
    meName,
    sendComment,
    sendHeart,
    sendWave,
    pinComment,
  } = session;
  const preview = useLivePreview(true);
  const mounted = useMountedRef();

  const [previewMode, setPreviewMode] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [commentsHidden, setCommentsHidden] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState<{ duration: string; peak: number; joins: number; likes: number } | undefined>();
  const [showViewers, setShowViewers] = useState(false);
  const [fansTab, setFansTab] = useState(false);
  const [showGuests, setShowGuests] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showGoal, setShowGoal] = useState(false);
  const [goalTarget, setGoalTarget] = useState('500');
  const [goalTitle, setGoalTitle] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [inviteSent, setInviteSent] = useState(0);

  const roomRef = useRef<LiveHostRoom | undefined>(undefined);
  const guestVideoRef = useRef<HTMLVideoElement | null>(null);
  const [guestStream, setGuestStream] = useState<MediaStream | undefined>();
  const likesRef = useRef(0);
  const joinsRef = useRef<Set<string>>(new Set());
  const endedAtRef = useRef<number | undefined>(undefined);
  /** New requests since the sheet was last opened: the badge + the buzz. */
  const seenRequests = useRef<Set<string>>(new Set());

  useLivePresence(live?.id, meId ? { userId: meId, userName: meName } : undefined);

  const watchers = viewers.filter((viewer) => viewer.userId !== meId);
  const requests = guests.filter((guest) => guest.status === 'requested');
  const onAir = guests.find((guest) => guest.status === 'joined');

  // A new face at the door buzzes once. Seen requests never buzz twice.
  useEffect(() => {
    const fresh = requests.filter((request) => !seenRequests.current.has(request.userId));
    if (fresh.length > 0 && mounted.current) buzz([15, 40, 15]);
    for (const request of requests) seenRequests.current.add(request.userId);
  }, [requests.length, mounted]);

  // A guest on air is a moment: feel it.
  const hadGuest = useRef(false);
  useEffect(() => {
    if (onAir && !hadGuest.current) buzz([15, 40, 25]);
    hadGuest.current = Boolean(onAir);
  }, [onAir?.userId]);

  const gestures = useTapGestures({
    onSingleTap: () => setChrome((visible) => !visible),
    onDoubleTap: (x, y) => {
      sendHeart(x, y);
      likesRef.current += 1;
    },
  });

  // ---- publish -----------------------------------------------------------
  useEffect(() => {
    if (!live || live.status !== 'live' || roomRef.current) return;
    // No tracks, nothing to publish - the room is skipped and the flow runs
    // on broadcast only. Testing without a camera, not a failure.
    if (!preview.stream) {
      setPreviewMode(true);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const grant = await fetchLiveGrant(live.id);
        const { joinLiveAsHost } = await import('../../lib/livekit/live-room.js');
        if (cancelled) return;
        const room = await joinLiveAsHost(grant, preview.stream!, {
          onCoStream: (_userId, stream) => {
            if (mounted.current) setGuestStream(stream);
          },
          onCoGone: () => {
            if (mounted.current) setGuestStream(undefined);
          },
          onDisconnected: () => {
            if (mounted.current) setPreviewMode(true);
          },
        });
        if (cancelled) {
          await room.leave().catch(() => undefined);
          return;
        }
        roomRef.current = room;
        room.onViewersChanged(() => undefined);
      } catch {
        if (!cancelled && mounted.current) setPreviewMode(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [live?.id, live?.status, preview.stream, mounted]);

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = undefined;
      if (room) void room.leave().catch(() => undefined);
    };
  }, []);

  // The guest's picture lands on its element whenever either arrives first.
  useEffect(() => {
    const element = guestVideoRef.current;
    if (!element || !guestStream) return;
    element.srcObject = guestStream;
    void element.play().catch(() => undefined);
  }, [guestStream, onAir?.userId]);

  // ---- counters ------------------------------------------------------------
  useEffect(() => {
    if (!live || live.status !== 'live') return;
    for (const viewer of watchers) joinsRef.current.add(viewer.userId);
    const count = watchers.length;
    const flush = () => {
      void service.updateCounters(live.id, {
        viewerCount: count,
        likesCount: likesRef.current,
        totalJoins: joinsRef.current.size,
      });
      void service.notePeak(live.id, count);
    };
    flush();
    const tick = window.setInterval(flush, 5000);
    return () => window.clearInterval(tick);
  }, [service, live?.id, live?.status, watchers.length]);

  // ---- guest handshake -------------------------------------------------------
  const approveGuest = async (userId: string) => {
    if (!liveId) return;
    // v1 seats one guest: approving a second waits until the seat is free.
    if (onAir && onAir.userId !== userId) return;
    await service.setGuestStatus(liveId, userId, 'joined');
  };

  const declineGuest = async (userId: string) => {
    if (!liveId) return;
    await service.setGuestStatus(liveId, userId, 'declined');
  };

  const removeGuest = async (userId: string) => {
    if (!liveId) return;
    await service.setGuestStatus(liveId, userId, 'removed');
    setGuestStream(undefined);
  };

  const inviteWatcher = async (userId: string) => {
    if (!liveId) return;
    await service.inviteGuest(liveId, userId);
  };

  /** The shared hearts goal: a target with a promise attached. */
  const saveGoal = async () => {
    if (!liveId || savingGoal) return;
    const target = Math.floor(Number(goalTarget));
    setSavingGoal(true);
    try {
      if (!target || target <= 0) {
        await service.setGoal(liveId, null, '');
      } else {
        await service.setGoal(liveId, Math.min(target, 1000000), goalTitle.trim());
      }
      buzz(15);
      if (mounted.current) setShowGoal(false);
    } finally {
      if (mounted.current) setSavingGoal(false);
    }
  };

  // ---- invite to watch (DM + its notification) ----------------------------------
  const invite = async () => {
    if (!live || invited.size === 0 || inviting) return;
    setInviting(true);
    const url = `${window.location.origin}/live/${live.id}`;
    const body = `I'm live now${live.title ? ` - ${live.title}` : ''}. Tap to watch: ${url}`;
    const results = await Promise.allSettled(
      [...invited].map(async (userId) => {
        const conversationId = await chat.startDirectConversation(userId);
        await chat.sendMessage({ conversationId, body });
      }),
    );
    const sent = results.filter((result) => result.status === 'fulfilled').length;
    if (mounted.current) {
      setInviteSent(sent);
      setInviting(false);
    }
  };

  const finish = async () => {
    if (!live || ending) return;
    setConfirmingEnd(false);
    setEnding(true);
    endedAtRef.current = Date.now();
    try {
      await service.updateCounters(live.id, {
        viewerCount: 0,
        likesCount: likesRef.current,
        totalJoins: joinsRef.current.size,
      });
    } catch {
      // Bookkeeping must not block ending.
    }
    try {
      await endLive(live.id);
    } catch {
      // The picture matters more than the row agreeing immediately.
    }
    const room = roomRef.current;
    roomRef.current = undefined;
    if (room) await room.leave().catch(() => undefined);
    if (!mounted.current) return;
    const endedAt = endedAtRef.current ?? Date.now();
    const seconds = Math.max(0, Math.floor((endedAt - (live.startedAt ?? endedAt)) / 1000));
    const two = (n: number) => String(n).padStart(2, '0');
    setSummary({
      duration: `${Math.floor(seconds / 60)}:${two(seconds % 60)}`,
      peak: Math.max(stats.peakViewers, live.peakViewers, watchers.length),
      joins: Math.max(stats.totalJoins, live.totalJoins, joinsRef.current.size),
      likes: Math.max(stats.likesCount, live.likesCount, likesRef.current),
    });
    setEnding(false);
  };

  // ---- states ---------------------------------------------------------------
  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-backdrop">
        <PingoDot state="loading" size={8} label="Opening live" />
      </div>
    );
  }

  if (!live) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-backdrop px-8 text-center">
        <p className="text-body text-white">Couldn't open this live.</p>
        <button
          type="button"
          onClick={() => navigate('/chats')}
          className="focus-ring rounded-full bg-white px-5 py-2.5 text-body font-medium text-backdrop"
        >
          Back to chats
        </button>
      </div>
    );
  }

  if (live.status === 'ended' && !summary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-backdrop px-8 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-brand-gradient text-on-brand">
          <CheckIcon size={30} />
        </span>
        <p className="text-h2 text-white">Live ended</p>
        <button
          type="button"
          onClick={() => navigate('/chats')}
          className="focus-ring mt-2 rounded-full bg-white px-5 py-2.5 text-body font-medium text-backdrop"
        >
          Done
        </button>
      </div>
    );
  }

  if (summary) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-backdrop px-8 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-brand-gradient text-on-brand">
          <CheckIcon size={30} />
        </span>
        <h1 className="mt-5 text-h1 text-white">Live ended</h1>
        <p className="mt-1.5 text-body text-white/60">{summary.duration} on air</p>
        <dl className="mt-7 grid w-full max-w-xs grid-cols-3 gap-2">
          {[
            { label: 'Viewers', value: summary.joins },
            { label: 'Peak', value: summary.peak },
            { label: 'Hearts', value: summary.likes },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl bg-white/10 px-2 py-3.5 backdrop-blur-glass">
              <dt className="text-caption text-white/60">{stat.label}</dt>
              <dd className="mt-0.5 text-h2 text-white tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={() => navigate('/chats')}
          className="focus-ring mt-8 w-full max-w-xs rounded-full bg-white py-3.5 text-body font-medium text-backdrop transition-transform duration-instant active:scale-[0.98]"
        >
          Done
        </button>
      </div>
    );
  }

  const ready = preview.status === 'ready' || preview.status === 'headless';
  const headless = preview.status === 'headless';
  const split = Boolean(onAir && guestStream);

  return (
    <div ref={gestures} className="relative flex h-full touch-none flex-col overflow-hidden bg-backdrop select-none">
      {/* ---- picture: host above, guest below when on air ------------------ */}
      <div className="absolute inset-0 flex flex-col">
        <div className={cn('relative overflow-hidden', split ? 'h-1/2' : 'h-full')}>
          {headless ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
              <span className="grid size-16 place-items-center rounded-3xl bg-white/10 text-white">
                <VideoOffIcon size={28} />
              </span>
              <p className="text-caption font-medium text-white/80">Camera is off - testing mode</p>
            </div>
          ) : ready ? (
            <video
              ref={preview.videoRef}
              playsInline
              muted
              className={cn('absolute inset-0 size-full object-cover', preview.facing === 'user' && '-scale-x-100')}
            />
          ) : preview.status === 'failed' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <p className="text-caption text-white/80">Camera unavailable on this screen.</p>
              <button
                type="button"
                onClick={preview.goHeadless}
                className="focus-ring rounded-full bg-white px-4 py-2 text-caption font-semibold text-ink"
              >
                Continue without camera
              </button>
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <PingoDot state="loading" size={8} label="Starting camera" />
            </div>
          )}
          <span className="absolute bottom-2 left-3 rounded-full bg-black/45 px-2.5 py-1 text-[0.6875rem] font-semibold text-white backdrop-blur-glass">
            You
          </span>
        </div>
        {split && (
          <div className="relative h-1/2 overflow-hidden border-t-2 border-backdrop">
            <video ref={guestVideoRef} playsInline className="absolute inset-0 size-full object-cover" />
            <span className="absolute bottom-2 left-3 rounded-full bg-black/45 px-2.5 py-1 text-[0.6875rem] font-semibold text-white backdrop-blur-glass">
              {onAir?.userName}
            </span>
            <button
              type="button"
              aria-label={`Remove ${onAir?.userName} from the live`}
              onClick={() => onAir && void removeGuest(onAir.userId)}
              className="focus-ring absolute right-3 bottom-2 rounded-full bg-black/45 px-3 py-1.5 text-[0.6875rem] font-semibold text-white backdrop-blur-glass active:bg-danger"
            >
              Remove
            </button>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />
        {!split && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/65 to-transparent" />
        )}
      </div>

      <LiveHearts hearts={hearts} />

      {/* ---- top ------------------------------------------------------------ */}
      <div
        className={cn(
          'relative z-10 flex items-start justify-between gap-3 px-4 pt-[max(0.875rem,env(safe-area-inset-top))]',
          'transition-opacity duration-200',
          !chrome && 'pointer-events-none opacity-0',
        )}
      >
        <div className="min-w-0">
          <LiveHostCluster
            hostName={live.title || 'Your live'}
            hostId={meId ?? 'me'}
            {...(session.myAvatarUrl ? { hostAvatarUrl: session.myAvatarUrl } : {})}
            viewerCount={watchers.length}
          />
          <p className="mt-1 pl-13 text-caption font-medium text-white/85 tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
            <LiveTimer
              startedAt={live.startedAt}
              className="tabular-nums"
            />
            {previewMode && (headless ? ' · camera off' : ' · preview')}
          </p>
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
        {!commentsHidden && (
          <>
            {live.goalTarget && (
              <LiveGoal title={live.goalTitle ?? ''} target={live.goalTarget} current={Math.max(stats.likesCount, likesRef.current)} />
            )}
            {pin && <LivePin comment={pin} canUnpin onUnpin={() => void pinComment(null)} />}
            <LiveComments comments={comments} joins={joins} onPin={(comment) => void pinComment(comment)} />
          </>
        )}
        {commentsHidden && live.goalTarget && (
          <LiveGoal title={live.goalTitle ?? ''} target={live.goalTarget} current={Math.max(stats.likesCount, likesRef.current)} />
        )}

        <div className="flex items-center gap-2">
          <LiveToolButton label="Flip camera" onClick={preview.flip}>
            <CameraFlipIcon size={20} />
          </LiveToolButton>
          <LiveToolButton
            label={requests.length > 0 ? `${requests.length} guest requests` : 'Guests'}
            alert={requests.length > 0}
            onClick={() => setShowGuests(true)}
          >
            <UsersIcon size={20} />
          </LiveToolButton>
          <LiveToolButton label="More options" onClick={() => setShowMore(true)}>
            <MoreIcon size={20} />
          </LiveToolButton>
          <LiveToolButton label="End live" danger onClick={() => setConfirmingEnd(true)}>
            <CloseIcon size={20} />
          </LiveToolButton>
          <div className="min-w-0 flex-1">
            <LiveComposer
              onSend={(body) => void sendComment(body)}
              onHeart={() => {
                sendHeart();
                likesRef.current += 1;
              }}
            />
          </div>
        </div>
        <p className="text-center text-[0.6875rem] text-white/50">Hold a comment to pin it</p>
      </div>

      {/* ---- guests ------------------------------------------------------------ */}
      {showGuests && (
        <Sheet title="Guests" description="Viewers ask here. Approve one to split the screen." onClose={() => setShowGuests(false)} elevated>
          <div className="mt-3 space-y-4">
            {onAir && (
              <div className="flex items-center gap-3 rounded-2xl bg-online/10 px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-online/20 text-caption font-semibold text-online">
                  {onAir.userName.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 text-body text-ink">
                  <span className="block truncate font-medium">{onAir.userName}</span>
                  <span className="block text-caption text-online">On air</span>
                </span>
                <button
                  type="button"
                  onClick={() => void removeGuest(onAir.userId)}
                  className="focus-ring rounded-full bg-danger-soft px-4 py-2 text-caption font-semibold text-danger"
                >
                  Remove
                </button>
              </div>
            )}
            {requests.length === 0 && !onAir && (
              <p className="py-3 text-center text-caption text-text-secondary">
                No requests yet. Viewers tap “Request to join” to appear here.
              </p>
            )}
            {requests.map((request) => (
              <div key={request.userId} className="flex items-center gap-3 rounded-2xl bg-sunken/60 px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-caption font-semibold text-brand">
                  {request.userName.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{request.userName}</span>
                <button
                  type="button"
                  disabled={Boolean(onAir)}
                  onClick={() => void approveGuest(request.userId)}
                  className="focus-ring rounded-full bg-brand px-4 py-2 text-caption font-semibold text-on-brand disabled:opacity-40"
                >
                  Go live
                </button>
                <button
                  type="button"
                  onClick={() => void declineGuest(request.userId)}
                  aria-label={`Decline ${request.userName}`}
                  className="focus-ring grid size-9 place-items-center rounded-full bg-hover text-caption font-bold text-text-secondary"
                >
                  ×
                </button>
              </div>
            ))}
            <div>
              <p className="mb-1.5 px-1 text-[0.6875rem] font-semibold text-text-tertiary">Invite a watcher on air</p>
              {watchers.length === 0 ? (
                <p className="px-1 text-caption text-text-tertiary">Nobody watching yet.</p>
              ) : (
                <ul className="max-h-44 space-y-1 overflow-y-auto">
                  {watchers.map((viewer) => {
                    const state = guests.find((guest) => guest.userId === viewer.userId)?.status;
                    return (
                      <li key={viewer.userId} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-caption font-semibold text-brand">
                          {viewer.userName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-body text-ink">{viewer.userName}</span>
                        <button
                          type="button"
                          disabled={state === 'invited' || state === 'joined' || Boolean(onAir)}
                          onClick={() => void inviteWatcher(viewer.userId)}
                          className="focus-ring rounded-full bg-hover px-3.5 py-1.5 text-caption font-semibold text-ink disabled:opacity-40"
                        >
                          {state === 'invited' ? 'Invited' : state === 'joined' ? 'On air' : 'Invite'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <SheetCancel onClick={() => setShowGuests(false)} />
        </Sheet>
      )}

      {/* ---- more ---------------------------------------------------------------- */}
      {showMore && (
        <Sheet title="Live options" onClose={() => setShowMore(false)} elevated>
          <div className="mt-3 flex flex-col gap-1">
            <SheetItem
              icon={<CommentIcon size={20} />}
              label={commentsHidden ? 'Show comments' : 'Hide comments'}
              hint={commentsHidden ? 'Let everyone react again' : 'A quiet broadcast'}
              onClick={() => {
                setCommentsHidden(!commentsHidden);
                setShowMore(false);
              }}
            />
            <SheetItem
              icon={<HeartIcon size={20} />}
              label={live.goalTarget ? 'Edit hearts goal' : 'Set hearts goal'}
              hint={
                live.goalTarget
                  ? `${Math.max(stats.likesCount, likesRef.current)} of ${live.goalTarget} hearts`
                  : 'A target with a promise attached'
              }
              onClick={() => {
                setGoalTarget(live.goalTarget ? String(live.goalTarget) : '500');
                setGoalTitle(live.goalTitle ?? '');
                setShowMore(false);
                setShowGoal(true);
              }}
            />
            <SheetItem
              icon={<ShareIcon size={20} />}
              label="Copy live link"
              hint="Share it anywhere"
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/live/${live.id}`).catch(() => undefined);
                setShowMore(false);
              }}
            />
            <SheetItem
              icon={<UsersIcon size={20} />}
              label="Invite friends to watch"
              hint="A message each, with the link"
              onClick={() => {
                setShowMore(false);
                setShowInvite(true);
              }}
            />
            <SheetItem
              icon={<EyeIcon size={20} />}
              label={`${watchers.length} watching`}
              hint="See everyone here"
              onClick={() => {
                setShowMore(false);
                setShowViewers(true);
              }}
            />
            <SheetCancel onClick={() => setShowMore(false)} />
          </div>
        </Sheet>
      )}

      {/* ---- invite to watch -------------------------------------------------------- */}
      {showInvite && (
        <Sheet
          title="Invite friends"
          description="They each get a message with the live link - and a notification with it."
          onClose={() => {
            setShowInvite(false);
            setInviteSent(0);
          }}
          elevated
        >
          <PeoplePicker
            selected={invited}
            onToggle={(userId, next) =>
              setInvited((previous) => {
                const updated = new Set(previous);
                if (next) updated.add(userId);
                else updated.delete(userId);
                return updated;
              })
            }
            emptyLabel="Nobody to invite yet."
          />
          {inviteSent > 0 && (
            <p role="status" className="mt-2 text-center text-caption text-online">
              Invited {inviteSent} {inviteSent === 1 ? 'friend' : 'friends'}
            </p>
          )}
          <div className="mt-2 flex flex-col gap-1">
            <button
              type="button"
              disabled={invited.size === 0 || inviting}
              onClick={() => void invite()}
              className="focus-ring w-full rounded-full bg-brand-gradient px-5 py-3.5 text-body font-semibold text-on-brand transition-transform duration-[160ms] active:scale-[0.97] disabled:opacity-50"
            >
              {inviting ? 'Inviting…' : `Invite${invited.size > 0 ? ` (${invited.size})` : ''}`}
            </button>
            <SheetCancel
              onClick={() => {
                setShowInvite(false);
                setInviteSent(0);
              }}
            />
          </div>
        </Sheet>
      )}

      {/* ---- goal ---------------------------------------------------------------- */}
      {showGoal && (
        <Sheet
          title="Hearts goal"
          description="Name a target and what happens at it. Every tap moves one bar on every screen."
          onClose={() => setShowGoal(false)}
          elevated
        >
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Goal presets">
            {['100', '500', '1000', '5000'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setGoalTarget(preset)}
                aria-pressed={goalTarget === preset}
                className={cn(
                  'focus-ring rounded-full px-4 py-2 text-caption font-semibold',
                  goalTarget === preset ? 'bg-ink text-white' : 'bg-sunken text-text-secondary',
                )}
              >
                {preset}
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex gap-2">
            <input
              value={goalTarget}
              onChange={(event) => setGoalTarget(event.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
              inputMode="numeric"
              placeholder="Custom target"
              aria-label="Custom hearts target"
              className="focus-ring min-w-0 flex-1 rounded-2xl border border-line/60 bg-surface px-4 py-3 text-body text-ink outline-none placeholder:text-text-tertiary"
            />
          </div>
          <input
            value={goalTitle}
            onChange={(event) => setGoalTitle(event.target.value.slice(0, 80))}
            placeholder="The promise - e.g. Q&A at 500"
            aria-label="Goal reward"
            className="focus-ring mt-2 w-full rounded-2xl border border-line/60 bg-surface px-4 py-3 text-body text-ink outline-none placeholder:text-text-tertiary"
          />
          <div className="mt-3 flex flex-col gap-1">
            <button
              type="button"
              disabled={savingGoal}
              onClick={() => void saveGoal()}
              className="focus-ring w-full rounded-full bg-brand-gradient px-5 py-3.5 text-body font-semibold text-on-brand transition-transform duration-[160ms] active:scale-[0.97] disabled:opacity-50"
            >
              {savingGoal ? 'Setting…' : 'Set goal'}
            </button>
            {live.goalTarget && (
              <button
                type="button"
                disabled={savingGoal}
                onClick={() => {
                  setGoalTarget('');
                  setGoalTitle('');
                  void service.setGoal(liveId!, null, '').then(() => {
                    if (mounted.current) setShowGoal(false);
                  });
                }}
                className="focus-ring w-full rounded-full px-5 py-2.5 text-caption font-medium text-danger disabled:opacity-50"
              >
                Clear goal
              </button>
            )}
            <SheetCancel onClick={() => setShowGoal(false)} />
          </div>
        </Sheet>
      )}

      {/* ---- viewers ------------------------------------------------------------ */}
      {showViewers && (
        <Sheet
          title={fansTab ? 'Top fans' : `${watchers.length} watching`}
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
                  {tab === 'watching' ? `Watching (${watchers.length})` : 'Top fans'}
                </button>
              );
            })}
          </div>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {!fansTab && watchers.length === 0 && (
              <li className="px-1 py-4 text-center text-caption text-text-secondary">
                Nobody yet - share the live to bring people in.
              </li>
            )}
            {!fansTab &&
              watchers.map((viewer) => (
                <FanRow
                  key={viewer.userId}
                  name={viewer.userName}
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        sendWave(viewer.userId);
                        buzz(12);
                      }}
                      className="focus-ring shrink-0 rounded-full bg-hover px-3.5 py-1.5 text-caption font-semibold text-ink"
                    >
                      👋 Wave
                    </button>
                  }
                />
              ))}
            {fansTab && topFans.length === 0 && (
              <li className="px-1 py-4 text-center text-caption text-text-secondary">
                No hearts yet.
              </li>
            )}
            {fansTab &&
              topFans.map((fan, index) => (
                <FanRow key={fan.userId} name={fan.userName} count={fan.count} rank={index + 1} />
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

      {/* ---- end confirm ------------------------------------------------------ */}
      {confirmingEnd && (
        <Sheet
          title="End live video?"
          description="Viewers will be sent home. This cannot be undone."
          onClose={() => setConfirmingEnd(false)}
          elevated
        >
          <div className="mt-4 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => void finish()}
              className="focus-ring w-full rounded-full bg-danger px-5 py-3.5 text-body font-semibold text-white transition-transform duration-[160ms] active:scale-[0.97]"
            >
              End live
            </button>
            <SheetCancel onClick={() => setConfirmingEnd(false)} label="Keep going" />
          </div>
        </Sheet>
      )}
    </div>
  );
}

function LiveToolButton({
  label,
  alert,
  danger,
  onClick,
  children,
}: {
  label: string;
  alert?: boolean;
  /** FaceTime's red ender: the one destructive control in the row. */
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'focus-ring relative grid size-11 shrink-0 place-items-center rounded-full backdrop-blur-glass',
        'transition-opacity duration-100 active:opacity-60',
        danger ? 'bg-danger text-white' : 'bg-black/35 text-white',
      )}
    >
      {children}
      {alert && (
        <span className="absolute top-1 right-1 size-2.5 rounded-full border-2 border-backdrop bg-danger" />
      )}
    </button>
  );
}
