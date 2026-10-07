import { cn } from '@pingo/ui';
import { Music2, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';

import { musicPlayer, useMusicPlayer } from './player.js';
import type { SharedSong } from './song-share.js';
import { nextSpeed } from './SongCard.js';

/**
 * The song that is playing, as an island at the top of the screen - the way an
 * iPhone shows music.
 *
 * ## Three shapes, one object
 *
 * Pressing play drops a small pill down from the top edge: the cover and a few
 * dancing bars, narrow enough to leave the screen alone. Tap it and it opens
 * into the full player - the cover, the name, the time and the controls - the
 * way the iPhone's island does. Tap anywhere else, or leave it a few seconds,
 * and it draws back up into the pill. The cross stops the song and the island
 * lifts away.
 *
 * It is one element that changes size, not two that swap, and it changes on a
 * spring that overshoots a touch - which is the whole difference between a
 * shape that moves and one that is replaced. The contents cross-fade through a
 * slight blur while it does, the way the real island's do.
 *
 * ## Where it does not go
 *
 * Above every screen but below stories, the story editor and the camera
 * (those sit at 500 and up), so it never covers something being made. The
 * camera route hides it outright.
 */

type Shape = 'gone' | 'drop' | 'open' | 'pill' | 'leave';

/** How long it stays open, untouched, before drawing back up into the pill. */
const SETTLE_MS = 6000;
/** How long the lift-away takes before it is removed. */
const LEAVE_MS = 340;

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Pulled about by a finger, it gives the way rubber does, and let go it springs
 * back home.
 *
 * The give is the iPhone's own scroll-edge curve: it follows the finger at
 * first and stiffens the further it goes, so it can be tugged but never thrown
 * off the screen. It stretches a touch along the pull, which is what makes it
 * read as soft rather than as a box being moved.
 *
 * Driven through the `translate` and `scale` properties rather than
 * `transform`: React owns `transform` (the shape's own spring), and the player
 * re-renders several times a second. These two it never touches, so a drag is
 * never reset under the finger, and they compose with the shape's transform.
 */
function useRubberPull(target: { readonly current: HTMLElement | null }, enabled: boolean) {
  const drag = useRef<
    { id: number; x: number; y: number; dx: number; dy: number; vx: number; vy: number; t: number; moved: boolean } | undefined
  >(undefined);
  const frame = useRef(0);
  /** Set when the last press was a pull, so the click it ends with does not open the player. */
  const pulled = useRef(false);

  /** Rubber: follows near 1:1 to begin with, and never passes `reach`. */
  const give = (d: number, reach: number) => (d * reach * 0.85) / (reach + 0.85 * Math.abs(d));

  const paint = (x: number, y: number) => {
    const el = target.current;
    if (!el) return;
    el.style.translate = x || y ? `${x.toFixed(2)}px ${y.toFixed(2)}px` : '';
    // Stretched along the pull, kept to its volume across it.
    const stretch = Math.min(0.14, Math.hypot(x, y) / 600);
    const along = Math.abs(x) >= Math.abs(y);
    el.style.scale = stretch > 0.002 ? (along ? `${1 + stretch} ${1 - stretch / 2}` : `${1 - stretch / 2} ${1 + stretch}`) : '';
  };

  /** A damped spring home from where it was let go, starting at the finger's speed. */
  const release = (x: number, y: number, vx: number, vy: number) => {
    cancelAnimationFrame(frame.current);
    const stiffness = 210;
    const damping = 11;
    let px = x;
    let py = y;
    let ux = vx;
    let uy = vy;
    let before = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - before) / 1000);
      before = now;
      ux += (-stiffness * px - damping * ux) * dt;
      uy += (-stiffness * py - damping * uy) * dt;
      px += ux * dt;
      py += uy * dt;
      if (Math.abs(px) < 0.3 && Math.abs(py) < 0.3 && Math.hypot(ux, uy) < 8) {
        paint(0, 0);
        return;
      }
      paint(px, py);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    cancelAnimationFrame(frame.current);
    pulled.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, vx: 0, vy: 0, t: performance.now(), moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const rawX = event.clientX - d.x;
    const rawY = event.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(rawX, rawY) < 6) return;
      d.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const nx = give(rawX, 300);
    const ny = give(rawY, 160);
    const now = performance.now();
    const dt = Math.max(1, now - d.t) / 1000;
    d.vx = (nx - d.dx) / dt;
    d.vy = (ny - d.dy) / dt;
    d.dx = nx;
    d.dy = ny;
    d.t = now;
    paint(nx, ny);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = undefined;
    if (!d.moved) return;
    pulled.current = true;
    // A finger lifted after holding still has no speed left in it.
    const stale = performance.now() - d.t > 80;
    release(d.dx, d.dy, stale ? 0 : d.vx, stale ? 0 : d.vy);
  };

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
    /** True once, right after a pull: the click that follows is the release, not a tap. */
    wasPull: () => {
      const was = pulled.current;
      pulled.current = false;
      return was;
    },
  };
}

export function MusicIsland() {
  const player = useMusicPlayer();
  const { pathname } = useLocation();
  const [shape, setShape] = useState<Shape>('gone');
  /** The song on show - kept through the lift-away, after the player has let go of it. */
  const [shown, setShown] = useState<SharedSong>();
  const [scrub, setScrub] = useState<number>();
  const box = useRef<HTMLDivElement>(null);
  const settle = useRef<number | undefined>(undefined);
  const last = useRef<{ url?: string; playing: boolean }>({ playing: false });

  const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Restarts the quiet-seconds clock: open, and draw up into the pill when nobody touches it. */
  const keepOpen = useCallback(() => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setShape((s) => (s === 'open' ? 'pill' : s)), SETTLE_MS);
  }, []);

  /** Opens the full player from the pill. */
  const open = useCallback(() => {
    setShape('open');
    keepOpen();
  }, [keepOpen]);

  /** Drops the pill down from above the screen, if it is not already there. */
  const arrive = useCallback(() => {
    setShape((s) => {
      if (s === 'gone' || s === 'leave') {
        requestAnimationFrame(() => requestAnimationFrame(() => setShape('pill')));
        return 'drop';
      }
      return s;
    });
  }, []);

  /*
   * Play pressed, or a new song: the pill drops down. The song going away (the
   * cross, or the player closing it) lifts the island off.
   */
  useEffect(() => {
    const song = player.song;
    const before = last.current;
    last.current = { url: song?.url, playing: player.playing };
    if (!song) {
      if (before.url) {
        window.clearTimeout(settle.current);
        setShape('leave');
        const t = window.setTimeout(() => {
          setShape('gone');
          setShown(undefined);
        }, LEAVE_MS);
        return () => window.clearTimeout(t);
      }
      return undefined;
    }
    setShown(song);
    if (song.url !== before.url || (player.playing && !before.playing)) arrive();
    return undefined;
  }, [player.song, player.playing, arrive]);

  // Tapping anywhere outside an open island closes it back up into the pill.
  useEffect(() => {
    if (shape !== 'open') return undefined;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setShape('pill');
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [shape]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  const pull = useRubberPull(box, shape === 'pill' && !still);

  if (!shown || shape === 'gone' || pathname.startsWith('/camera')) return null;

  const isOpen = shape === 'open';
  const total = player.length || shown.secs || 0;
  const at = scrub ?? player.at;
  const pct = total ? Math.min(100, (at / total) * 100) : 0;
  const playing = player.playing && player.song?.url === shown.url;

  /*
   * The shape, by state. The spring overshoots on the way down and open, and
   * eases plainly on the way out - nothing should bounce while it leaves.
   */
  const geometry =
    shape === 'open'
      ? { width: 'min(360px, calc(100vw - 24px))', height: 104, borderRadius: 30, transform: 'translate(-50%, 0) scale(1)', opacity: 1 }
      : shape === 'pill'
        ? { width: 112, height: 34, borderRadius: 19, transform: 'translate(-50%, 0) scale(1)', opacity: 1 }
        : { width: 84, height: 28, borderRadius: 16, transform: 'translate(-50%, -56px) scale(0.85)', opacity: 0 };
  /*
   * A spring with a small overshoot, the island's own feel: quick to start,
   * a touch past the mark, settled by the end. Height lags width by a hair,
   * so it reads as one shape swelling rather than a box being resized.
   */
  const spring = 'cubic-bezier(0.28, 1.22, 0.36, 1)';
  const transition = still
    ? 'opacity 200ms ease'
    : shape === 'leave'
      ? `width ${LEAVE_MS}ms ease-in, height ${LEAVE_MS}ms ease-in, border-radius ${LEAVE_MS}ms ease-in, transform ${LEAVE_MS}ms cubic-bezier(0.5, 0, 0.75, 0), opacity ${LEAVE_MS}ms ease-in`
      : `width 520ms ${spring}, height 560ms ${spring} 30ms, border-radius 520ms ${spring}, transform 620ms ${spring}, opacity 220ms ease, box-shadow 400ms ease`;

  /** Seeking by dragging along the track, as you would on the phone's own player. */
  const seekFrom = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return ratio * total;
  };

  const cover = (size: 'small' | 'large') =>
    shown.img ? (
      <img
        src={shown.img}
        alt=""
        draggable={false}
        className={cn(
          'island-cover shrink-0 object-cover',
          size === 'large' ? 'size-[52px] rounded-[13px]' : 'size-[22px] rounded-[7px]',
          !playing && size === 'large' && 'island-cover-rest',
        )}
      />
    ) : (
      <span
        className={cn(
          'island-cover grid shrink-0 place-items-center bg-brand-soft text-brand',
          size === 'large' ? 'size-[52px] rounded-[13px]' : 'size-[22px] rounded-[7px]',
          !playing && size === 'large' && 'island-cover-rest',
        )}
      >
        <Music2 size={size === 'large' ? 22 : 12} />
      </span>
    );

  return (
    <div
      ref={box}
      role="region"
      aria-label="Now playing"
      onPointerDown={() => {
        if (isOpen) keepOpen();
      }}
      className={cn(
        'fixed left-1/2 z-[450] overflow-hidden text-ink',
        // Glass: the app's own light surface, frosted, with a bright rim and a soft drop.
        'bg-surface/80 shadow-[0_14px_36px_-14px_rgba(90,40,130,0.45),0_2px_8px_-2px_rgba(16,17,20,0.12)] ring-1 ring-white/70 backdrop-blur-xl backdrop-saturate-150',
      )}
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)', ...geometry, transition }}
    >
      {/* The pill: the cover and a few bars that dance while it plays. */}
      <button
        type="button"
        {...pull.handlers}
        onClick={() => {
          if (!pull.wasPull()) open();
        }}
        aria-label={`${shown.name}, open the player`}
        tabIndex={isOpen ? -1 : 0}
        className={cn(
          'focus-ring absolute inset-0 flex touch-none items-center justify-between px-[6px] transition-[opacity,filter,transform] duration-200 active:scale-95',
          isOpen ? 'pointer-events-none scale-90 opacity-0 blur-[6px]' : 'scale-100 opacity-100 blur-0 delay-75',
        )}
      >
        {cover('small')}
        <span aria-hidden className={cn('island-bars mr-2', !playing && 'island-bars-rest')}>
          <i />
          <i />
          <i />
          <i />
        </span>
      </button>

      {/* Open: the cover, the song, the time and the controls. */}
      <div
        aria-hidden={!isOpen}
        className={cn(
          'absolute inset-x-0 top-0 grid origin-top gap-2.5 px-3.5 pt-3 transition-[opacity,filter,transform] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
          isOpen ? 'translate-y-0 scale-100 opacity-100 blur-0 delay-[120ms]' : 'pointer-events-none -translate-y-1 scale-[0.9] opacity-0 blur-[8px] duration-150',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {cover('large')}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[15px] font-extrabold">{shown.name}</span>
            <span className="mt-0.5 block truncate text-[12.5px] text-text-secondary">
              {player.failed ? 'Could not play. Tap play to try again.' : shown.artist || 'PINGO Music'}
            </span>
          </span>
          <button
            type="button"
            tabIndex={isOpen ? 0 : -1}
            onClick={() => musicPlayer.toggle(shown)}
            aria-label={playing ? 'Pause' : 'Play'}
            className="focus-ring relative grid size-10 shrink-0 place-items-center rounded-full transition-transform duration-150 active:scale-90"
          >
            {player.loading ? (
              <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
            ) : (
              <>
                <Pause
                  size={26}
                  fill="currentColor"
                  className={cn('absolute transition-[opacity,transform] duration-200', playing ? 'scale-100 opacity-100' : 'scale-50 -rotate-90 opacity-0')}
                />
                <Play
                  size={26}
                  fill="currentColor"
                  className={cn('absolute ml-0.5 transition-[opacity,transform] duration-200', playing ? 'scale-50 rotate-90 opacity-0' : 'scale-100 opacity-100')}
                />
              </>
            )}
          </button>
          <button
            type="button"
            tabIndex={isOpen ? 0 : -1}
            onClick={() => musicPlayer.close()}
            aria-label="Stop and close"
            className="focus-ring grid size-8 shrink-0 place-items-center rounded-full text-text-secondary transition-transform duration-150 active:scale-90"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            tabIndex={isOpen ? 0 : -1}
            onClick={() => musicPlayer.seek(player.at - 10)}
            aria-label="Back 10 seconds"
            className="focus-ring grid size-7 shrink-0 place-items-center rounded-full transition-transform duration-150 active:-rotate-45 active:scale-90"
          >
            <RotateCcw size={18} />
          </button>
          <span className="w-8 shrink-0 text-right text-[11.5px] font-medium text-text-secondary tabular-nums">{fmt(at)}</span>
          <div
            role="slider"
            tabIndex={isOpen ? 0 : -1}
            aria-label="Position in the song"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(at)}
            aria-valuetext={`${fmt(at)} of ${fmt(total)}`}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') musicPlayer.seek(player.at + 5);
              if (event.key === 'ArrowLeft') musicPlayer.seek(player.at - 5);
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setScrub(seekFrom(event));
            }}
            onPointerMove={(event) => {
              if (scrub !== undefined) setScrub(seekFrom(event));
            }}
            onPointerUp={(event) => {
              musicPlayer.seek(seekFrom(event));
              setScrub(undefined);
            }}
            onPointerCancel={() => setScrub(undefined)}
            className="focus-ring group relative flex h-5 min-w-0 flex-1 touch-none items-center"
          >
            <span className="h-1 w-full overflow-hidden rounded-full bg-ink/10">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-[#ec4899] to-[#a855f7]"
                style={{ width: `${pct}%`, transition: scrub === undefined ? 'width 250ms linear' : 'none' }}
              />
            </span>
            <span
              aria-hidden
              className={cn(
                'absolute size-3.5 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(16,17,20,0.3)] ring-1 ring-black/5 transition-transform duration-150',
                scrub !== undefined && 'scale-125',
              )}
              style={{ left: `${pct}%`, transition: scrub === undefined ? 'left 250ms linear, transform 150ms' : 'transform 150ms' }}
            />
          </div>
          <span className="w-8 shrink-0 text-[11.5px] font-medium text-text-secondary tabular-nums">{fmt(total)}</span>
          <button
            type="button"
            tabIndex={isOpen ? 0 : -1}
            onClick={() => musicPlayer.seek(player.at + 10)}
            aria-label="Forward 10 seconds"
            className="focus-ring grid size-7 shrink-0 place-items-center rounded-full transition-transform duration-150 active:rotate-45 active:scale-90"
          >
            <RotateCw size={18} />
          </button>
          <button
            type="button"
            tabIndex={isOpen ? 0 : -1}
            onClick={() => musicPlayer.setSpeed(nextSpeed(player.speed))}
            aria-label={`Speed ${player.speed}x`}
            className="focus-ring shrink-0 rounded-full bg-ink/[0.07] px-2.5 py-1 text-[12px] font-bold tabular-nums transition-transform duration-150 active:scale-90"
          >
            {player.speed}x
          </button>
        </div>
      </div>
    </div>
  );
}
