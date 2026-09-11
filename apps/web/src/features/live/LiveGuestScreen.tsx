/**
 * On air as a guest.
 *
 * The split screen both sides see: the host above, you below, one comment
 * flow underneath. You publish your camera like a second host and watch the
 * host's picture like a viewer. Leaving the seat drops you back into the
 * audience; the host removing you does the same without asking.
 */

import { CloseIcon, PingoDot, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type { LiveGuestRoom } from '../../lib/livekit/live-room.js';
import { useLive, useLivePresence } from './LiveContext.js';
import {
  LiveComments,
  LiveComposer,
  LiveHearts,
  LivePin,
  LiveGoal,
  LiveTimer,
  useTapGestures,
} from './LiveWidgets.js';
import { fetchLiveGrant, useLiveSession, useMountedRef } from './useLiveSession.js';
import { useLivePreview } from './useLivePreview.js';

export function LiveGuestScreen() {
  const { liveId } = useParams<{ liveId: string }>();
  const navigate = useNavigate();
  const { service } = useLive();
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
    viewers,
    wave,
    meId,
    meName,
    sendComment,
    sendHeart,
  } = session;
  const preview = useLivePreview(true);
  const mounted = useMountedRef();

  const roomRef = useRef<LiveGuestRoom | undefined>(undefined);
  const hostVideoRef = useRef<HTMLVideoElement | null>(null);
  const [hostStream, setHostStream] = useState<MediaStream | undefined>();
  const [previewMode, setPreviewMode] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useLivePresence(live?.id, meId ? { userId: meId, userName: meName } : undefined);

  const mySeat = guests.find((guest) => guest.userId === meId);

  const gestures = useTapGestures({
    onSingleTap: () => setChrome((visible) => !visible),
    onDoubleTap: (x, y) => sendHeart(x, y),
  });

  // Removed, or the live ended: back to the audience (or home).
  useEffect(() => {
    if (!live || !meId) return;
    if (live.status === 'ended') {
      navigate(`/live/${live.id}`, { replace: true });
      return;
    }
    if (mySeat && (mySeat.status === 'removed' || mySeat.status === 'declined' || mySeat.status === 'left')) {
      navigate(`/live/${live.id}`, { replace: true });
    }
  }, [live?.status, mySeat?.status, live?.id, meId, navigate]);

  // ---- publish + subscribe -------------------------------------------------
  // No camera: subscribe like a viewer so the host is still visible. The seat
  // is held the same way; only the outgoing picture is missing.
  useEffect(() => {
    if (!live || live.status !== 'live' || roomRef.current) return;
    if (mySeat && !['invited', 'joined'].includes(mySeat.status)) return;
    if (!preview.stream) {
      let cancelled = false;
      (async () => {
        try {
          const grant = await fetchLiveGrant(live.id);
          const { joinLiveAsViewer } = await import('../../lib/livekit/live-room.js');
          if (cancelled) return;
          const room = await joinLiveAsViewer(
            grant,
            (stream) => {
              if (mounted.current) setHostStream(stream);
            },
            () => {
              if (mounted.current) setHostStream(undefined);
            },
            () => {
              if (mounted.current) setPreviewMode(true);
            },
          );
          if (cancelled) {
            await room.leave().catch(() => undefined);
            return;
          }
          roomRef.current = room;
        } catch {
          if (!cancelled && mounted.current) setPreviewMode(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;

    (async () => {
      try {
        const grant = await fetchLiveGrant(live.id);
        const { joinLiveAsGuest } = await import('../../lib/livekit/live-room.js');
        if (cancelled) return;
        const room = await joinLiveAsGuest(grant, preview.stream!, {
          onCoStream: (_userId, stream) => {
            if (mounted.current) setHostStream(stream);
          },
          onCoGone: () => {
            if (mounted.current) setHostStream(undefined);
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
        // Announce the seat as taken once media actually flows.
        if (meId) await service.setGuestStatus(live.id, meId, 'joined').catch(() => undefined);
      } catch {
        if (!cancelled && mounted.current) setPreviewMode(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [live?.id, live?.status, preview.stream, mySeat?.status, meId, service, mounted]);

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = undefined;
      if (room) void room.leave().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const element = hostVideoRef.current;
    if (!element || !hostStream) return;
    element.srcObject = hostStream;
    void element.play().catch(() => undefined);
  }, [hostStream]);

  const leaveSeat = async () => {
    if (!live || !meId || leaving) return;
    setLeaving(true);
    try {
      await service.setGuestStatus(live.id, meId, 'left');
    } catch {
      // The row disagrees; leaving the picture still stands.
    }
    const room = roomRef.current;
    roomRef.current = undefined;
    if (room) await room.leave().catch(() => undefined);
    navigate(`/live/${live.id}`, { replace: true });
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-backdrop">
        <PingoDot state="loading" size={8} label="Joining live" />
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

  const ready = preview.status === 'ready';
  const headless = preview.status === 'headless';

  return (
    <div ref={gestures} className="relative flex h-full touch-none flex-col overflow-hidden bg-backdrop select-none">
      {/* ---- split: host above, you below ---------------------------------- */}
      <div className="absolute inset-0 flex flex-col">
        <div className="relative h-1/2 overflow-hidden">
          {hostStream ? (
            <video ref={hostVideoRef} playsInline className="absolute inset-0 size-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center px-8 text-center">
              <p className="flex items-center gap-2 text-caption text-white/70">
                <PingoDot state="loading" size={4} />
                Connecting to {live.hostName}…
              </p>
            </div>
          )}
          <span className="absolute bottom-2 left-3 rounded-full bg-black/45 px-2.5 py-1 text-[0.6875rem] font-semibold text-white backdrop-blur-glass">
            {live.hostName}
          </span>
        </div>
        <div className="relative h-1/2 overflow-hidden border-t-2 border-backdrop">
          {headless ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
              <p className="text-caption font-medium text-white/80">Your camera is off</p>
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
              <PingoDot state="loading" size={6} label="Starting camera" />
            </div>
          )}
            <span className="absolute bottom-2 left-3 rounded-full bg-danger px-2.5 py-1 text-[0.6875rem] font-bold text-white">
              YOU · <LiveTimer startedAt={live.startedAt} />
            </span>
          {previewMode && (
            <span className="absolute top-2 left-3 rounded-lg bg-black/45 px-2 py-1 text-[0.6875rem] text-white/85 backdrop-blur-glass">
              Preview mode
            </span>
          )}
        </div>
      </div>

      <LiveHearts hearts={hearts} />

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
          'relative z-10 flex items-start justify-end px-4 pt-[max(0.875rem,env(safe-area-inset-top))]',
          'transition-opacity duration-200',
          !chrome && 'pointer-events-none opacity-0',
        )}
      >
        <button
          type="button"
          aria-label="Leave the broadcast"
          disabled={leaving}
          onClick={() => void leaveSeat()}
          className="focus-ring grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-glass transition-transform duration-instant active:scale-95 disabled:opacity-50"
        >
          <CloseIcon size={19} />
        </button>
      </div>

      {/* ---- bottom ----------------------------------------------------------- */}
      <div
        className={cn(
          'relative z-10 mt-auto space-y-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
          'transition-opacity duration-200',
          !chrome && 'pointer-events-none opacity-0',
        )}
      >
        {pin && <LivePin comment={pin} />}
        {live.goalTarget && (
          <LiveGoal title={live.goalTitle ?? ''} target={live.goalTarget} current={stats.likesCount} />
        )}
        <LiveComments comments={comments} joins={joins} />
        <LiveComposer onSend={(body) => void sendComment(body)} onHeart={() => sendHeart()} />
        <button
          type="button"
          disabled={leaving}
          onClick={() => void leaveSeat()}
          className="focus-ring w-full rounded-full border border-white/30 bg-black/30 py-2.5 text-caption font-semibold text-white backdrop-blur-glass transition-transform duration-instant active:scale-[0.98] disabled:opacity-50"
        >
          {leaving ? 'Leaving…' : 'Step down'}
        </button>
      </div>

      <span className="sr-only" aria-live="polite">
        {viewers.length} watching
      </span>
    </div>
  );
}
