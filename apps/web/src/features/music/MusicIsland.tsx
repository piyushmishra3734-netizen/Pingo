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
 * Pressing play drops it down from the top edge already open: the cover, the
 * name, the time and the controls. After a few quiet seconds it draws itself up
 * into a small pill - the cover and a few dancing bars - so it stops taking the
 * screen. Tap the pill and it opens again; tap anywhere else and it closes back
 * up. The cross stops the song and the island lifts away.
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

/** How long it stays open on its own before drawing up into the pill. */
const SETTLE_MS = 4500;
/** How long the lift-away takes before it is removed. */
const LEAVE_MS = 340;

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

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

  const open = useCallback(() => {
    setShape((s) => {
      if (s === 'gone' || s === 'leave') {
        // One frame as a small pill above the screen, then down and open.
        requestAnimationFrame(() => requestAnimationFrame(() => setShape('open')));
        return 'drop';
      }
      return 'open';
    });
    keepOpen();
  }, [keepOpen]);

  /*
   * Play pressed, or a new song: drop down open. The song going away (the
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
    if (song.url !== before.url || (player.playing && !before.playing)) open();
    return undefined;
  }, [player.song, player.playing, open]);

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
        ? { width: 152, height: 36, borderRadius: 20, transform: 'translate(-50%, 0) scale(1)', opacity: 1 }
        : { width: 120, height: 32, borderRadius: 18, transform: 'translate(-50%, -64px) scale(0.82)', opacity: 0 };
  const spring = 'cubic-bezier(0.32, 1.3, 0.42, 1)';
  const transition = still
    ? 'opacity 200ms ease'
    : shape === 'leave'
      ? `width ${LEAVE_MS}ms ease-in, height ${LEAVE_MS}ms ease-in, border-radius ${LEAVE_MS}ms ease-in, transform ${LEAVE_MS}ms cubic-bezier(0.5, 0, 0.75, 0), opacity ${LEAVE_MS}ms ease-in`
      : `width 560ms ${spring}, height 560ms ${spring}, border-radius 480ms ${spring}, transform 600ms ${spring}, opacity 220ms ease`;

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
        onClick={open}
        aria-label={`${shown.name}, open the player`}
        tabIndex={isOpen ? -1 : 0}
        className={cn(
          'focus-ring absolute inset-0 flex items-center justify-between px-[7px] transition-[opacity,filter] duration-200',
          isOpen ? 'pointer-events-none opacity-0 blur-[6px]' : 'opacity-100 blur-0 delay-100',
        )}
      >
        {cover('small')}
        <span aria-hidden className={cn('island-bars mr-1.5', !playing && 'island-bars-rest')}>
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
          'absolute inset-x-0 top-0 grid gap-2.5 px-3.5 pt-3 transition-[opacity,filter] duration-300',
          isOpen ? 'opacity-100 blur-0 delay-100' : 'pointer-events-none opacity-0 blur-[8px]',
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
