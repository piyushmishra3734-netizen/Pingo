import { cn } from '@pingo/ui';
import { ChevronDown, Ellipsis, Heart, ListMusic, Loader2, MicVocal, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, X } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { useBackStep } from '../../navigation/useBackStep.js';
import { musicPlayer, useMusicPlayer } from '../player.js';
import * as api from '../saavn/api.js';
import * as library from '../saavn/library.js';
import * as playback from '../saavn/playback.js';
import type { Song } from '../saavn/types.js';
import { SongRow, clean, fmt, names, useLoad } from './parts.js';

type Panel = 'lyrics' | 'queue' | undefined;

/**
 * The song playing, full screen: the cover large, the time, the controls, and
 * two panels that slide up over it, its lyrics and what plays next.
 */
export function NowPlaying({ open, onClose, onMore, onArtist, toast }: { open: boolean; onClose: () => void; onMore: (s: Song) => void; onArtist: (s: Song) => void; toast: (t: string) => void }) {
  const queue = playback.useQueue();
  const player = useMusicPlayer();
  const lib = library.useLibrary();
  const [panel, setPanel] = useState<Panel>();
  const song = playback.Q.current(queue);

  useBackStep(open && !panel, onClose);
  useBackStep(open && !!panel, () => setPanel(undefined));

  if (!song) return null;
  const liked = lib.likes.some((l) => l.song.id === song.id);
  const playing = player.playing;
  const busy = player.loading && !player.failed;
  const RepeatIcon = queue.repeat === 'one' ? Repeat1 : Repeat;

  return (
    <div
      aria-hidden={!open}
      {...(open ? {} : { inert: true })}
      className={cn(
        'absolute inset-0 z-30 flex flex-col overflow-clip bg-surface transition-transform duration-[420ms] ease-[var(--ease-standard)]',
        open ? 'translate-y-0' : 'translate-y-full',
      )}
    >
      {/* The cover's colour, washed across the screen. */}
      <img src={song.image} alt="" aria-hidden className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-30 blur-[60px] saturate-150" />
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-surface/30 via-surface/60 to-surface" />

      <div className="relative flex items-center gap-2 px-3 pt-3">
        <button type="button" onClick={onClose} aria-label="Close player" className="grid size-10 place-items-center rounded-full active:bg-sunken">
          <ChevronDown size={24} />
        </button>
        <p className="min-w-0 flex-1 text-center">
          <small className="block text-[11.5px] uppercase tracking-[0.08em] text-text-secondary">Playing from</small>
          <b className="block truncate text-[13.5px] font-semibold">{queue.source.label || 'PINGO Music'}</b>
        </p>
        <button type="button" onClick={() => onMore(song)} aria-label="More" className="grid size-10 place-items-center rounded-full active:bg-sunken">
          <Ellipsis size={22} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-8 py-6">
        <img
          src={song.image}
          alt=""
          draggable={false}
          className={cn(
            'aspect-square w-full max-w-[340px] rounded-[22px] object-cover shadow-[0_30px_60px_-30px_rgba(var(--pm-tone),1)] transition-transform duration-[520ms] ease-[var(--ease-standard)]',
            playing ? 'scale-100' : 'scale-[0.9]',
          )}
        />
      </div>

      <div className="relative px-7">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[22px] font-semibold tracking-[-0.01em]">{clean(song.name)}</h2>
            <button type="button" onClick={() => onArtist(song)} className="block max-w-full truncate text-left text-[15px] text-text-secondary">
              {names(song)}
            </button>
          </div>
          <button
            type="button"
            aria-label={liked ? 'Remove from Liked songs' : 'Like'}
            onClick={() => toast(library.toggleLike(song) ? 'Added to Liked songs' : 'Removed from Liked songs')}
            className="grid size-11 place-items-center rounded-full active:bg-sunken"
          >
            <Heart size={24} className={cn(liked && 'fill-[#e0559b] text-[#e0559b]')} />
          </button>
        </div>

        <Seek at={player.at} length={player.length || song.secs} />

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            aria-label="Shuffle"
            aria-pressed={queue.shuffle}
            onClick={() => {
              playback.toggleShuffle();
              toast(queue.shuffle ? 'Shuffle off' : 'Shuffle on');
            }}
            className={cn('grid size-11 place-items-center rounded-full', queue.shuffle ? 'text-[rgb(var(--pm-tone))]' : 'text-text-secondary')}
          >
            <Shuffle size={21} />
          </button>
          <button type="button" aria-label="Previous" onClick={playback.prev} className="grid size-14 place-items-center rounded-full active:bg-sunken">
            <SkipBack size={30} className="fill-current" />
          </button>
          <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={playback.toggleCurrent} className="grid size-[72px] place-items-center rounded-full bg-ink text-page transition-transform duration-quick active:scale-95">
            {busy ? <Loader2 size={30} className="animate-spin" /> : playing ? <Pause size={30} className="fill-current" /> : <Play size={30} className="ml-1 fill-current" />}
          </button>
          <button type="button" aria-label="Next" onClick={playback.next} className="grid size-14 place-items-center rounded-full active:bg-sunken">
            <SkipForward size={30} className="fill-current" />
          </button>
          <button
            type="button"
            aria-label="Repeat"
            onClick={() => {
              playback.cycleRepeat();
              toast(queue.repeat === 'off' ? 'Repeating all' : queue.repeat === 'all' ? 'Repeating this song' : 'Repeat off');
            }}
            className={cn('grid size-11 place-items-center rounded-full', queue.repeat !== 'off' ? 'text-[rgb(var(--pm-tone))]' : 'text-text-secondary')}
          >
            <RepeatIcon size={21} />
          </button>
        </div>
      </div>

      <div className="relative mb-[max(14px,env(safe-area-inset-bottom))] mt-4 flex justify-center gap-2 px-7">
        <button type="button" onClick={() => setPanel('lyrics')} className="flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium text-text-secondary active:bg-sunken">
          <MicVocal size={18} />
          Lyrics
        </button>
        <button type="button" onClick={() => setPanel('queue')} className="flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium text-text-secondary active:bg-sunken">
          <ListMusic size={18} />
          Up next
        </button>
      </div>

      <Sheet open={panel === 'lyrics'} title="Lyrics" onClose={() => setPanel(undefined)}>
        {panel === 'lyrics' && <LyricsBody song={song} />}
      </Sheet>
      <Sheet open={panel === 'queue'} title="Up next" onClose={() => setPanel(undefined)}>
        {panel === 'queue' && <QueueBody onMore={onMore} />}
      </Sheet>
    </div>
  );
}

/** The progress line, which a finger can drag. */
function Seek({ at, length }: { at: number; length: number }) {
  const [drag, setDrag] = useState<number>();
  const bar = useRef<HTMLDivElement>(null);
  const t = drag ?? at;
  const pct = length ? Math.min(100, (t / length) * 100) : 0;
  const pick = (e: ReactPointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * length;
  };
  return (
    <div className="mt-4">
      <div
        ref={bar}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(t)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') musicPlayer.seek(at + 5);
          if (e.key === 'ArrowLeft') musicPlayer.seek(at - 5);
        }}
        onPointerDown={(e) => {
          if (!length) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(pick(e));
        }}
        onPointerMove={(e) => drag !== undefined && setDrag(pick(e))}
        onPointerUp={(e) => {
          if (drag === undefined) return;
          musicPlayer.seek(pick(e));
          setDrag(undefined);
        }}
        onPointerCancel={() => setDrag(undefined)}
        className="group relative flex h-6 touch-none items-center"
      >
        <span className="h-1 w-full overflow-hidden rounded-full bg-ink/12">
          <span className="block h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
        </span>
        <span className={cn('absolute size-3.5 -translate-x-1/2 rounded-full bg-ink transition-transform duration-quick', drag !== undefined ? 'scale-125' : 'scale-100')} style={{ left: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[12px] tabular-nums text-text-tertiary">
        <span>{fmt(t)}</span>
        <span>{length ? `-${fmt(Math.max(0, length - t))}` : ''}</span>
      </div>
    </div>
  );
}

/** A panel that slides up over the player. */
function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      aria-hidden={!open}
      {...(open ? {} : { inert: true })}
      className={cn(
        'absolute inset-x-0 bottom-0 top-14 z-10 flex flex-col rounded-t-[26px] bg-surface shadow-[0_-20px_40px_-30px_rgba(0,0,0,0.5)] transition-transform duration-[380ms] ease-[var(--ease-standard)]',
        open ? 'translate-y-0' : 'translate-y-[105%]',
      )}
    >
      <div className="flex items-center px-5 pb-1 pt-4">
        <h3 className="flex-1 text-[17px] font-semibold">{title}</h3>
        <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="grid size-9 place-items-center rounded-full bg-sunken">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );
}

function LyricsBody({ song }: { song: Song }) {
  // Asked for every song: a song found by search does not always say whether it has them.
  const l = useLoad(`lyrics:${song.id}`, () => api.lyrics(song.id));
  if (l.loading) return <Loader2 size={22} className="mx-auto mt-12 animate-spin text-text-tertiary" />;
  if (l.error || !l.data?.lines.length) return <p className="px-8 py-12 text-center text-[14px] text-text-secondary">No lyrics for this one yet.</p>;
  return (
    <div className="px-6 pt-2">
      {l.data.lines.map((line, i) => (line.trim() ? (
        <p key={i} className="text-[21px] font-semibold leading-snug tracking-[-0.01em]">{line}</p>
      ) : (
        <div key={i} className="h-5" />
      )))}
      {l.data.copyright && <p className="mt-8 text-[11.5px] text-text-tertiary">{l.data.copyright}</p>}
    </div>
  );
}

function QueueBody({ onMore }: { onMore: (s: Song) => void }) {
  const queue = playback.useQueue();
  const player = useMusicPlayer();
  const now = playback.Q.current(queue);
  const next = queue.order.slice(queue.at + 1).map((i, k) => ({ song: queue.items[i]!, orderIndex: queue.at + 1 + k }));
  return (
    <div className="px-2">
      {now && (
        <>
          <p className="mx-3 mb-1 mt-2 text-[12.5px] font-medium text-text-secondary">Now playing</p>
          <SongRow song={now} now paused={!player.playing} onPlay={playback.toggleCurrent} />
        </>
      )}
      <p className="mx-3 mb-1 mt-4 text-[12.5px] font-medium text-text-secondary">
        {next.length ? `Next from ${queue.source.label || 'your queue'}` : playback.Q.isRadio(queue) ? 'Finding more like this…' : 'Nothing after this one'}
      </p>
      {next.map(({ song, orderIndex }) => (
        <div key={`${song.id}-${orderIndex}`} className="flex items-center">
          <div className="min-w-0 flex-1">
            <SongRow song={song} onPlay={() => playback.jumpTo(orderIndex)} onMore={() => onMore(song)} />
          </div>
          <button type="button" aria-label={`Remove ${clean(song.name)} from the queue`} onClick={() => playback.removeFromQueue(orderIndex)} className="grid size-9 shrink-0 place-items-center rounded-full text-text-tertiary active:bg-sunken">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
