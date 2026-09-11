/**
 * Setting up a live: frame yourself, name it, go.
 *
 * One camera, one decision. The preview is the screen; the title and audience
 * ride above a single Go Live button. Tapping it creates the live (which is
 * what notifies friends) and walks straight into the broadcast through a
 * brief connecting beat - no confirmation sheet, no countdown. Nobody else
 * asks twice, and the tap already said yes.
 */

import { CameraFlipIcon, CloseIcon, PingoDot, UsersIcon, VideoOffIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getSupabaseClient } from '../../lib/supabase/client.js';
import { useLive } from './LiveContext.js';
import { buzz } from './LiveWidgets.js';
import { useLivePreview } from './useLivePreview.js';

export function LiveSetupScreen() {
  const navigate = useNavigate();
  const { startLive } = useLive();
  const preview = useLivePreview(true);

  const [title, setTitle] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  /** Mutuals who will be notified the moment this goes live. */
  const [notifyCount, setNotifyCount] = useState<number | undefined>();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const client = getSupabaseClient();
        const { data: session } = await client.auth.getUser();
        const me = session.user?.id;
        if (!active || !me) return;
        const { data } = await client
          .from('follows')
          .select('follower_id, followee_id')
          .eq('status', 'accepted');
        if (!active) return;
        const iFollow = new Set<string>();
        const followsMe = new Set<string>();
        for (const row of (data ?? []) as { follower_id: string; followee_id: string }[]) {
          if (row.follower_id === me) iFollow.add(row.followee_id);
          if (row.followee_id === me) followsMe.add(row.follower_id);
        }
        setNotifyCount([...iFollow].filter((id) => followsMe.has(id)).length);
      } catch {
        // The count is a courtesy line; the setup works without it.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const ready = preview.status === 'ready' || preview.status === 'headless';
  const headless = preview.status === 'headless';

  const goLive = async () => {
    if (starting) return;
    setStarting(true);
    setError(undefined);
    buzz(20);
    try {
      const live = await startLive(title);
      navigate(`/live/host/${live.id}`, { replace: true });
    } catch (cause) {
      // Said out loud, not swallowed: while the backend is still landing,
      // the exact failure is what tells preview apart from a real problem.
      console.error('[live] start failed', cause);
      setStarting(false);
      const detail =
        cause instanceof Error && cause.message
          ? cause.message
          : typeof cause === 'string'
            ? cause
            : JSON.stringify(cause);
      setError(detail || "Couldn't start the live. Try again.");
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-backdrop">
      {/* ---- preview ---------------------------------------------------- */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {headless ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="grid size-18 place-items-center rounded-3xl bg-white/10 text-white">
              <VideoOffIcon size={32} />
            </span>
            <p className="text-body font-medium text-white">Camera is off</p>
            <p className="max-w-xs text-caption text-white/60">
              Testing mode - comments, hearts, guests and viewers all work, only the picture is missing.
            </p>
          </div>
        ) : ready ? (
          <video
            ref={preview.videoRef}
            playsInline
            muted
            className={cn(
              'absolute inset-0 size-full object-cover',
              preview.facing === 'user' && '-scale-x-100',
            )}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            {preview.status === 'starting' ? (
              <PingoDot state="loading" size={8} label="Starting camera" />
            ) : (
              <div className="flex flex-col items-center gap-4 px-8 text-center">
                <span className="grid size-18 place-items-center rounded-3xl bg-white/10 text-white">
                  <VideoOffIcon size={32} />
                </span>
                <div>
                  <p className="text-body text-white">The camera isn't available.</p>
                  <p className="mt-2 text-caption text-white/60">
                    Allow camera access - or keep testing without it.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={preview.goHeadless}
                  className="focus-ring rounded-full bg-white px-5 py-2.5 text-body font-medium text-backdrop transition-transform duration-instant active:scale-[0.98]"
                >
                  Continue without camera
                </button>
              </div>
            )}
          </div>
        )}

        {/* top bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button
            type="button"
            aria-label="Close live setup"
            onClick={() => navigate('/chats')}
            className="focus-ring grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-glass transition-transform duration-instant active:scale-95"
          >
            <CloseIcon size={19} />
          </button>
          <span className="rounded-full bg-black/45 px-3 py-1 text-caption font-semibold text-white backdrop-blur-glass">
            Live
          </span>
          <button
            type="button"
            aria-label="Switch camera"
            disabled={!ready}
            onClick={preview.flip}
            className="focus-ring grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-glass transition-transform duration-instant active:scale-95 disabled:opacity-40"
          >
            <CameraFlipIcon size={20} />
          </button>
        </div>

        {starting && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-backdrop/60">
            <div className="flex flex-col items-center gap-3">
              <PingoDot state="loading" size={8} label="Going live" />
              <p className="text-caption font-medium text-white">Connecting…</p>
            </div>
          </div>
        )}
      </div>

      {/* ---- title + audience + go -------------------------------------- */}
      <div className="shrink-0 space-y-3 bg-page px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="text-center text-caption text-danger">
            {error}
          </p>
        )}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, 80))}
          placeholder="Add a title…"
          aria-label="Live title"
          className="focus-ring w-full rounded-2xl border border-line/60 bg-surface px-4 py-3 text-body text-ink outline-none placeholder:text-text-tertiary"
        />
        <div className="flex items-center gap-2.5 rounded-2xl bg-sunken/60 px-4 py-3">
          <UsersIcon size={17} className="shrink-0 text-text-secondary" />
          <p className="min-w-0 flex-1 text-caption text-text-secondary">
            <span className="font-medium text-ink">Friends</span>{' '}
            {notifyCount === undefined || notifyCount === 0
              ? 'will be notified the moment you go live'
              : `${notifyCount} ${notifyCount === 1 ? 'friend' : 'friends'} will be notified the moment you go live`}
          </p>
        </div>
        <button
          type="button"
          disabled={!ready || starting}
          onClick={() => void goLive()}
          className={cn(
            'focus-ring w-full rounded-full bg-danger px-5 py-3.5 text-body font-semibold text-white',
            'shadow-[0_4px_16px_rgba(220,38,38,0.35)]',
            'transition-transform duration-[160ms] ease-standard active:scale-[0.97]',
            (!ready || starting) && 'opacity-50',
          )}
        >
          Go Live
        </button>
      </div>
    </div>
  );
}
