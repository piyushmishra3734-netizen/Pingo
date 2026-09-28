import type { ProfileSong } from '@pingo/core';
import { cn } from '@pingo/ui';
import { Music2, Pause, Play } from 'lucide-react';

import { musicPlayer, useMusicPlayer } from './player.js';

/**
 * The song on a profile - Telegram's profile music, in PINGO's colours.
 *
 * A slim card under the details: the cover, the name, and a play button. It
 * plays through the app's one player, so it keeps going after you leave the
 * profile, with the bar across the top to stop it. While it plays the bars
 * beside the name move, so it is obvious which song is on.
 */
export function ProfileSongCard({ song, className, trailing }: { song: ProfileSong; className?: string; trailing?: React.ReactNode }) {
  const player = useMusicPlayer();
  const current = player.song?.url === song.url;
  const on = current && player.playing;
  const loading = current && player.loading;
  const total = (current ? player.length : 0) || song.secs || 0;
  const pct = current && total ? Math.min(100, (player.at / total) * 100) : 0;

  return (
    <div
      className={cn(
        'relative flex items-center gap-3 overflow-clip rounded-2xl p-2 pr-2.5',
        'bg-[linear-gradient(120deg,color-mix(in_srgb,var(--color-brand)_14%,var(--color-surface)),var(--color-surface))]',
        'ring-1 ring-line',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => musicPlayer.toggle(song)}
        aria-label={on ? `Pause ${song.name}` : `Play ${song.name}`}
        className="focus-ring relative size-12 shrink-0 overflow-hidden rounded-xl"
      >
        {song.img ? (
          <img src={song.img} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center bg-brand-soft text-brand"><Music2 size={20} /></span>
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/30 text-white">
          {loading ? (
            <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : on ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" className="ml-0.5" />
          )}
        </span>
      </button>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Equalizer on={on} />
          <span className="truncate text-[14px] font-semibold text-ink">{song.name}</span>
        </span>
        <span className="block truncate text-[12.5px] text-text-secondary">{song.artist || 'PINGO Music'}</span>
      </span>

      {trailing}

      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px]">
        <span className="block h-full bg-brand transition-[width] duration-300 ease-linear" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** Three bars that dance while the song plays, and rest as a music mark when it does not. */
function Equalizer({ on }: { on: boolean }) {
  if (!on) return <Music2 size={13} className="shrink-0 text-brand" aria-hidden />;
  return (
    <span aria-hidden className="flex h-3 shrink-0 items-end gap-[2px]">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-[3px] rounded-full bg-brand"
          style={{ height: '100%', transformOrigin: 'bottom', animation: `eq-bar 0.9s ease-in-out ${delay}ms infinite` }}
        />
      ))}
      <style>{'@keyframes eq-bar { 0%,100% { transform: scaleY(.3) } 50% { transform: scaleY(1) } }'}</style>
    </span>
  );
}
