import { cn } from '@pingo/ui';
import { Heart, Loader2, Pause, Play } from 'lucide-react';

import { useMusicPlayer } from '../player.js';
import * as downloads from '../saavn/downloads.js';
import * as library from '../saavn/library.js';
import * as playback from '../saavn/playback.js';
import type { Song } from '../saavn/types.js';
import { Cover, clean, names } from './parts.js';

/** The line at the bottom: what is playing, and the one button that matters. */
export function MiniPlayer({ song, onOpen, toast }: { song: Song; onOpen: () => void; toast: (t: string) => void }) {
  const player = useMusicPlayer();
  const lib = library.useLibrary();
  const liked = lib.likes.some((l) => l.song.id === song.id);
  const length = player.length || song.secs || 0;
  const pct = length ? Math.min(100, (player.at / length) * 100) : 0;
  const busy = player.loading && !player.failed;
  const cover = downloads.useCover(song.id, song.image);
  return (
    <div className="absolute inset-x-2.5 bottom-[max(10px,env(safe-area-inset-bottom))] z-20">
      <div className="relative flex h-[62px] items-center gap-3 overflow-hidden rounded-[18px] bg-[color-mix(in_srgb,rgb(var(--pm-tone))_14%,var(--color-surface))] pl-2 pr-1.5 shadow-[0_14px_34px_-18px_rgba(0,0,0,0.55)] ring-1 ring-ink/5 backdrop-blur-xl">
        <button type="button" onClick={onOpen} aria-label="Open now playing" className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Cover src={cover} className="size-[46px] rounded-[11px]" />
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[14.5px] font-semibold">{clean(song.name)}</b>
            <small className="block truncate text-[12.5px] text-text-secondary">{names(song)}</small>
          </span>
        </button>
        <button type="button" aria-label={liked ? 'Remove from Liked songs' : 'Like'} onClick={() => toast(library.toggleLike(song) ? 'Added to Liked songs' : 'Removed from Liked songs')} className="grid size-10 place-items-center rounded-full">
          <Heart size={21} className={cn(liked && 'fill-[#e0559b] text-[#e0559b]')} />
        </button>
        <button type="button" aria-label={player.playing ? 'Pause' : 'Play'} onClick={playback.toggleCurrent} className="grid size-11 place-items-center rounded-full">
          {busy ? <Loader2 size={22} className="animate-spin" /> : player.playing ? <Pause size={24} className="fill-current" /> : <Play size={24} className="ml-0.5 fill-current" />}
        </button>
        <span aria-hidden className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-ink/8">
          <span className="block h-full rounded-full bg-[rgb(var(--pm-tone))]" style={{ width: `${pct}%` }} />
        </span>
      </div>
    </div>
  );
}
