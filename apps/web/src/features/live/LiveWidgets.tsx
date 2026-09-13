/**
 * The live overlay vocabulary, shared by host, guest and viewer.
 *
 * Drawn from the three apps that defined it rather than invented:
 *
 * - Comments are borderless white text with a shadow, straight on the video
 *   (Instagram). Bubbles belong to messaging; a live is a broadcast.
 * - Hearts bloom where the finger fell on a double-tap anywhere (TikTok,
 *   Instagram). The heart button is the secondary path, not the only one.
 * - A single tap hides every control for an unobstructed picture (Instagram).
 * - The top-left cluster names the host: face, name, LIVE, eye-count, and a
 *   Follow button for viewers (TikTok).
 */

import { Avatar, EyeIcon, HeartIcon, SendIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import type { LiveComment, LiveHeart, LivePresenceEvent } from './types.js';

/**
 * The motion vocabulary, in one place.
 *
 * Apple's grammar, adapted to the repo's laws (no springs, nothing over
 * 320ms): entries rise a few pixels and fade in fast; docks pop (small,
 * overshoot-free, 220ms); celebrations rain. One style block per screen root
 * renders it; everything below only names keyframes. Reduced motion silences
 * all of it - the information never rides on movement alone.
 */
export function LiveMotion() {
  return (
    <style>{`@keyframes live-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } } @keyframes live-pop { 0% { opacity: 0; transform: scale(0.6); } 60% { opacity: 1; transform: scale(1.04); } 100% { opacity: 1; transform: scale(1); } } @keyframes live-glow { 0%, 100% { box-shadow: 0 0 10px rgba(220,38,38,0.55), 0 0 2px rgba(220,38,38,0.9); } 50% { box-shadow: 0 0 18px rgba(220,38,38,0.8), 0 0 4px rgba(220,38,38,1); } } @media (prefers-reduced-motion: reduce) { .live-rise, .live-pop { animation: none !important; } }`}</style>
  );
}

/**
 * The broadcast grade: vignette, warmth, grain.
 *
 * Sterile video on flat gray is what reads as slop. A broadcast has light:
 * edges fall off into darkness, skin picks up warmth, and film carries a
 * whisper of grain. All three sit in one pointer-transparent layer over the
 * picture, under every control. Subtle on purpose - 5% grain, not a filter.
 */
export function LiveGrade() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 50% 42%, transparent 52%, rgba(0,0,0,0.42) 100%)' }}
      />
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}

/**
 * One frosted control, everywhere.
 *
 * Apple's glass buttons carry a hairline light-border - without it frosted
 * circles are flat gray blobs. Ring, blur, opacity-highlight, 100ms. Every
 * icon control on every live screen is this component, so the chrome reads
 * as one family instead of assembled parts.
 */
export function LiveIconButton({
  label,
  onClick,
  danger,
  alert,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  alert?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'focus-ring relative grid size-11 shrink-0 place-items-center rounded-full backdrop-blur-glass',
        'border transition-opacity duration-100 active:opacity-60',
        danger ? 'border-danger/60 bg-danger text-white' : 'border-white/25 bg-black/35 text-white',
        className,
      )}
    >
      {children}
      {alert && (
        <span className="absolute top-1 right-1 size-2.5 rounded-full border-2 border-backdrop bg-danger" />
      )}
    </button>
  );
}

/**
 * Haptics for the beats that matter, phones only.
 *
 * Apple pairs every meaningful visual with a tap you feel; the web equivalent
 * is `navigator.vibrate`, guarded because desktops and denials must be silent
 * rather than throwing. Short ticks for taps, a double-beat for wins.
 */
export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // A buzz that cannot happen is simply skipped.
  }
}

/** Face, name, LIVE, eye-count - and Follow for viewers. */
export function LiveHostCluster({
  hostName,
  hostId,
  hostAvatarUrl,
  viewerCount,
  followLabel,
  onFollow,
}: {
  hostName: string;
  hostId: string;
  hostAvatarUrl?: string;
  viewerCount: number;
  /** Absent means no follow button (the host's own screen). */
  followLabel?: string;
  onFollow?: () => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={hostName} id={hostId} {...(hostAvatarUrl ? { src: hostAvatarUrl } : {})} size="md" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
            {hostName}
          </span>
          <span
            className="shrink-0 rounded-md bg-danger px-1.5 py-px text-[0.625rem] font-bold tracking-widest text-white"
            style={{ animation: 'live-glow 2.4s ease-in-out infinite' }}
          >
            LIVE
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[0.75rem] font-semibold text-white tabular-nums drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
          <EyeIcon size={13} />
          <span className="tabular-nums">{viewerCount} watching</span>
        </span>
      </span>
      {followLabel && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onFollow?.();
          }}
          className="focus-ring ml-1 shrink-0 rounded-full bg-white/20 px-3 py-1.5 text-caption font-semibold text-white backdrop-blur-glass transition-transform duration-instant active:scale-95"
        >
          {followLabel}
        </button>
      )}
    </span>
  );
}

/** The scrolling comment flow: borderless, newest last, joins as faint lines. */
export function LiveComments({
  comments,
  joins,
  shouts = [],
  onPin,
}: {
  comments: LiveComment[];
  joins: LivePresenceEvent[];
  /** Room-wide moments: gold, centered, gone in seconds. */
  shouts?: { id: string; text: string }[];
  /**
   * Host-only: hold a comment to pin it. Interactive rows opt out of the
   * gesture layer below them so a hold never toggles the chrome.
   */
  onPin?: (comment: LiveComment) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  /*
   * Stays pinned to the bottom while you watch the latest - inside this box
   * only, and instantly. The old version called `scrollIntoView({ smooth })`,
   * which scrolled the whole page on every line and read as the live itself
   * reloading. If you scrolled up to read, it stays where you put it.
   */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }, [comments.length, joins.length, shouts.length]);

  const holdTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
    };
  }, []);

  const beginHold = (comment: LiveComment) => {
    if (!onPin) return;
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => onPin(comment), 500);
  };
  const endHold = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  };

  type Row =
    | { kind: 'comment'; id: string; at: number; node: React.ReactNode }
    | { kind: 'join'; id: string; at: number; node: React.ReactNode };

  const rows: Row[] = [
    ...shouts.slice(-2).map(
      (shout): Row => ({
        kind: 'join',
        id: shout.id,
        at: Date.now(),
        node: (
          <p className="live-pop mx-auto w-fit rounded-full border border-online/40 bg-online/25 px-3 py-1 text-center text-[0.6875rem] font-bold text-white backdrop-blur-glass" style={{ animation: 'live-pop 220ms ease-out' }}>
            {shout.text}
          </p>
        ),
      }),
    ),    ...comments.slice(-14).map(
      (comment, index, list): Row => ({
        kind: 'comment',
        id: comment.id,
        at: comment.createdAt,
        /*
         * Depth by age: the newest lines burn full white, older ones sink.
         * A flat stack of equal lines is a log; a fading one is a room.
         */
        node: onPin ? (
          <button
            type="button"
            aria-label={`Pin comment by ${comment.userName}`}
            onPointerDown={() => beginHold(comment)}
            onPointerUp={endHold}
            onPointerCancel={endHold}
            onPointerLeave={endHold}
            onContextMenu={(event) => event.preventDefault()}
            className={cn(
              'focus-ring block w-fit max-w-full rounded-lg text-left transition-opacity duration-500',
              index < list.length - 4 && 'opacity-60',
            )}
          >
            <span className="live-rise block text-[0.8125rem] leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" style={{ animation: 'live-rise 180ms ease-out' }}>
              <span className="mr-1.5 font-semibold text-white/90">{comment.userName}</span>
              {comment.body}
            </span>
          </button>
        ) : (
          <p
            className={cn(
              'live-rise w-fit max-w-full text-[0.8125rem] leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] transition-opacity duration-500',
              index < list.length - 4 && 'opacity-60',
            )}
            style={{ animation: 'live-rise 180ms ease-out' }}
          >
            <span className="mr-1.5 font-semibold text-white/90">{comment.userName}</span>
            {comment.body}
          </p>
        ),
      }),
    ),
    ...joins.slice(-6).map(
      (join): Row => ({
        kind: 'join',
        id: join.id,
        at: join.at,
        node: (
          <p className="live-rise w-fit text-[0.6875rem] text-white/60 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]" style={{ animation: 'live-rise 180ms ease-out' }}>
            {join.userName} joined
          </p>
        ),
      }),
    ),
  ].sort((a, b) => a.at - b.at);

  return (
    <div
      ref={boxRef}
      className={cn(
        'flex max-h-52 min-h-0 flex-col justify-end gap-1 overflow-y-auto',
        onPin ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-live="polite"
      aria-label="Live comments"
    >
      {rows.map((row) => (
        <div key={row.id}>{row.node}</div>
      ))}
    </div>
  );
}

/** The host's pinned comment, riding just above the composer. */
export function LivePin({
  comment,
  canUnpin,
  onUnpin,
}: {
  comment: LiveComment;
  canUnpin?: boolean;
  onUnpin?: () => void;
}) {
  return (
    <div className="live-pop flex w-fit max-w-full items-center gap-2 rounded-full border border-white/25 bg-black/40 py-1 pr-1.5 pl-3 backdrop-blur-glass" style={{ animation: 'live-pop 220ms ease-out' }}>
      <p className="min-w-0 truncate text-caption text-white">
        <span className="mr-1.5 font-semibold">📌 {comment.userName}</span>
        {comment.body}
      </p>
      {canUnpin && (
        <button
          type="button"
          aria-label="Unpin comment"
          onClick={onUnpin}
          className="focus-ring grid size-6 shrink-0 place-items-center rounded-full bg-white/20 text-[0.6875rem] font-bold text-white"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Hearts blooming where fingers fell.
 *
 * Positioned by fractional tap coords; button-sent hearts arrive without
 * coords and rise along the right edge, where the thumb already is.
 */
export function LiveHearts({ hearts }: { hearts: LiveHeart[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <style>{`@keyframes live-heart-rise { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.5); } 12% { opacity: 1; } 100% { opacity: 0; transform: translate(calc(-50% + var(--drift, 0px)), -140px) scale(1.2); } }`}</style>
      {hearts.slice(-18).map((heart, index) => {
        const left = heart.x !== undefined ? `${heart.x * 100}%` : undefined;
        const top = heart.y !== undefined ? `${heart.y * 100}%` : undefined;
        return (
          <span
            key={heart.id}
            className={cn(
              'absolute text-danger drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]',
              left === undefined && 'right-4 bottom-32',
            )}
            style={{
              ...(left !== undefined ? { left, top } : {}),
              animation: 'live-heart-rise 2.2s ease-out forwards',
              ['--drift' as string]: `${((hashId(heart.id) + index * 41) % 48) - 24}px`,
            }}
          >
            <HeartIcon size={24 + ((hashId(heart.id) + index) % 14)} fill="currentColor" />
          </span>
        );
      })}
    </div>
  );
}

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

/** The comment field with its send arrow, plus the heart button. */
export function LiveComposer({
  onSend,
  onHeart,
  onMilestone,
  placeholder = 'Add a comment…',
}: {
  onSend: (body: string) => void;
  onHeart: () => void;
  /** Fires at ×10/25/50 and every ×100: the room should hear about it. */
  onMilestone?: (combo: number) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  /**
   * The combo: rapid taps chain into x2, x3… TikTok's applause meter.
   *
   * A tap more than a beat after the last one starts a fresh run. Milestones
   * buzz the phone so a streak feels like something even with eyes closed.
   */
  const [combo, setCombo] = useState(0);
  const comboTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (comboTimer.current) window.clearTimeout(comboTimer.current);
    };
  }, []);

  const tapHeart = () => {
    onHeart();
    setCombo((previous) => {
      const next = previous + 1;
      if (next === 10 || next === 25 || next === 50 || next % 100 === 0) buzz([12, 40, 18]);
      else buzz(8);
      return next;
    });
    if (comboTimer.current) window.clearTimeout(comboTimer.current);
    comboTimer.current = window.setTimeout(() => setCombo(0), 1200);
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    buzz(10);
    onSend(text);
    setDraft('');
  };

  return (
    <div className="relative flex items-center gap-2">
      {combo >= 3 && (
        <span
          key={combo}
          aria-hidden
          className="live-pop absolute -top-7 right-1 rounded-full bg-danger px-2 py-0.5 text-[0.6875rem] font-bold text-white tabular-nums shadow-sm"
          style={{ animation: 'live-pop 200ms ease-out' }}
        >
          ×{combo}
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-white/30 bg-black/30 backdrop-blur-glass">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, 200))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchEnd={(event) => event.stopPropagation()}
          placeholder={placeholder}
          aria-label="Add a comment"
          className="focus-ring min-w-0 flex-1 bg-transparent px-4 py-2.5 text-body text-white outline-none placeholder:text-white/60"
        />
        {draft.trim() && (
          <button
            type="button"
            aria-label="Send comment"
            onClick={submit}
            onPointerDown={(event) => event.stopPropagation()}
            className="live-pop focus-ring mr-1 grid size-9 shrink-0 place-items-center rounded-full bg-white text-ink transition-opacity duration-100 active:opacity-60"
            style={{ animation: 'live-pop 200ms ease-out' }}
          >
            <SendIcon size={17} />
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Send a heart"
        onClick={tapHeart}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          'focus-ring grid size-11 shrink-0 place-items-center rounded-full text-white',
          'transition-opacity duration-100 active:opacity-60',
        )}
      >
        <HeartIcon size={combo >= 25 ? 30 : 26} />
      </button>
    </div>
  );
}

/**
 * The shared hearts goal: a thin bar with a number chasing it.
 *
 * TikTok's LIVE goals without the coins - the host names a target and what
 * happens at it, and every tap moves the same bar on every screen. Crossing
 * it rains hearts on all of them once, with a buzz, because a win nobody
 * feels is just a number changing.
 */
export function LiveGoal({
  title,
  target,
  current,
}: {
  title: string;
  target: number;
  current: number;
}) {
  const done = current >= target;
  const ratio = target > 0 ? Math.min(1, current / target) : 0;
  const celebrated = useRef(false);

  useEffect(() => {
    if (done && !celebrated.current) {
      celebrated.current = true;
      buzz([15, 50, 15, 50, 30]);
    }
    if (!done) celebrated.current = false;
  }, [done]);

  return (
    <div className="relative">
      {done && (
        <div className="pointer-events-none absolute -top-24 right-0 left-0 h-24 overflow-visible" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className="absolute top-full text-danger drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]"
              style={{
                left: `${8 + ((i * 37) % 84)}%`,
                animation: 'live-heart-rise 1.8s ease-out forwards',
                animationDelay: `${(i % 4) * 120}ms`,
              }}
            >
              <HeartIcon size={16 + ((i * 13) % 12)} fill="currentColor" />
            </span>
          ))}
        </div>
      )}
    <div
      className={cn(
        'rounded-2xl border px-3 py-2 backdrop-blur-glass',
        done ? 'border-online/50 bg-online/20' : 'border-white/20 bg-black/30',
      )}
      role="status"
      aria-label={done ? `Goal reached: ${title}` : `Goal: ${title}, ${current} of ${target} hearts`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[0.6875rem] font-semibold text-white">
          {done ? `🎉 ${title}` : `🎯 ${title || 'Hearts goal'}`}
        </p>
        <p className="shrink-0 text-[0.6875rem] font-bold text-white tabular-nums">
          {done ? 'Done' : `${current}/${target}`}
        </p>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/20">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-standard',
            done ? 'bg-online' : 'bg-brand-gradient',
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
    </div>
  );
}

/**
 * Consecutive lives of one host watched, kept on this device.
 *
 * Twitch taught that streaks bring people back tomorrow; this is the
 * no-backend version. Joining a new live of the same host within a week of
 * the last one extends it, anything else restarts it at one.
 */
const STREAK_DAYS = 7;

export function readBumpStreak(hostId: string, liveId: string): number {
  try {
    const key = `pingo:live-streak:${hostId}`;
    const raw = localStorage.getItem(key);
    const now = Date.now();
    if (raw) {
      const saved = JSON.parse(raw) as { count: number; liveId: string; at: number };
      if (saved.liveId === liveId) return saved.count;
      if (now - saved.at < STREAK_DAYS * 24 * 60 * 60 * 1000) {
        const next = { count: saved.count + 1, liveId, at: now };
        localStorage.setItem(key, JSON.stringify(next));
        return next.count;
      }
    }
    localStorage.setItem(key, JSON.stringify({ count: 1, liveId, at: now }));
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Single tap toggles chrome, double-tap blooms a heart at the point.
 *
 * Pointer events cover touch and mouse alike. The single tap waits out the
 * double-tap window (260ms) so the first tap of a double never flashes the
 * chrome - the flicker that gives gesture code away.
 */
export function useTapGestures({
  onSingleTap,
  onDoubleTap,
}: {
  onSingleTap: () => void;
  onDoubleTap: (x: number, y: number) => void;
}): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const pending = useRef<{ timer: number; x: number; y: number } | undefined>(undefined);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const point = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.min(0.95, Math.max(0.05, (event.clientX - rect.left) / rect.width)),
        y: Math.min(0.95, Math.max(0.05, (event.clientY - rect.top) / rect.height)),
      };
    };

    const onUp = (event: PointerEvent) => {
      // Controls handle their own taps; only the bare picture gestures.
      if ((event.target as HTMLElement).closest('button, input, textarea, a')) return;
      const { x, y } = point(event);
      const last = pending.current;
      if (last && Math.hypot(x - last.x, y - last.y) < 0.12) {
        window.clearTimeout(last.timer);
        pending.current = undefined;
        onDoubleTap(x, y);
        return;
      }
      if (last) window.clearTimeout(last.timer);
      pending.current = {
        x,
        y,
        timer: window.setTimeout(() => {
          pending.current = undefined;
          onSingleTap();
        }, 260),
      };
    };

    element.addEventListener('pointerup', onUp);
    return () => {
      element.removeEventListener('pointerup', onUp);
      if (pending.current) window.clearTimeout(pending.current.timer);
    };
  }, [onSingleTap, onDoubleTap]);

  return ref;
}

/** One row of the Watching / Top fans sheets. */
export function FanRow({
  name,
  count,
  rank,
  you,
  action,
}: {
  name: string;
  count?: number;
  rank?: number;
  you?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2 text-body text-ink">
      {rank !== undefined ? (
        <span
          className={
            rank === 1
              ? 'grid size-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-body font-bold text-on-brand'
              : 'grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-caption font-bold text-text-secondary'
          }
        >
          {rank}
        </span>
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-caption font-semibold text-brand">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {name}
        {you && <span className="ml-1.5 text-caption text-brand">· you</span>}
      </span>
      {count !== undefined && (
        <span className="shrink-0 text-caption font-bold text-danger tabular-nums">♥ {count}</span>
      )}
      {action}
    </li>
  );
}

/**
 * Somebody else's picture.
 *
 * Browsers refuse to autoplay a stream WITH sound until the viewer has tapped
 * - and a refused `play()` leaves a black box with no error on screen, which
 * reads as "their camera is broken". So sound is attempted first; when the
 * browser says no, the picture plays muted and one explicit tap brings the
 * sound (a tap always counts as a gesture). Never a black box, either way.
 */
export function RemoteVideo({
  stream,
  className,
  label,
}: {
  stream: MediaStream | undefined;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    element.muted = false;
    setNeedsTap(false);
    void element.play().catch(() => {
      element.muted = true;
      void element.play().catch(() => undefined);
      setNeedsTap(true);
    });
  }, [stream]);

  const unmute = () => {
    const element = ref.current;
    if (!element) return;
    element.muted = false;
    void element
      .play()
      .then(() => setNeedsTap(false))
      .catch(() => undefined);
  };

  return (
    <span className={cn('relative block size-full', className)}>
      <video ref={ref} playsInline aria-label={label} className="absolute inset-0 size-full object-cover" />
      {needsTap && (
        <button
          type="button"
          onClick={unmute}
          className="focus-ring absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 px-4 py-2 text-caption font-semibold whitespace-nowrap text-white backdrop-blur-glass transition-opacity duration-100 active:opacity-60"
        >
          <span aria-hidden>🔇</span> Tap for sound
        </button>
      )}
    </span>
  );
}

/** Ticks `mm:ss` (or `h:mm:ss`) from a start instant. */export function useLiveTimer(startedAt: number | undefined): string {  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!startedAt) return '0:00';
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

/**
 * The on-air clock as its own component.
 *
 * The tick re-renders only this line. When the hook lived in the screen, the
 * whole broadcast tree re-rendered every second - cheap for React, but it is
 * exactly the kind of churn that reads as flicker next to video.
 */
export function LiveTimer({ startedAt, className }: { startedAt: number | undefined; className?: string }) {
  const text = useLiveTimer(startedAt);
  return (
    <span className={className} role="timer">
      {text}
    </span>
  );
}
