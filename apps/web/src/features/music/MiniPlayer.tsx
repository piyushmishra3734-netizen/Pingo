import { cn } from '@pingo/ui';
import { Music2, Pause, Play, X } from 'lucide-react';

import { musicPlayer, useMusicPlayer } from './player.js';
import { nextSpeed } from './SongCard.js';

/**
 * The bar across the top while a song is playing - Telegram's way.
 *
 * It sits above every screen, so a song started in one chat carries on while
 * you read another, open settings or look at a profile, and it is always one
 * tap to pause. It goes only when the cross is pressed.
 */
export function MiniPlayer() {
  const player = useMusicPlayer();
  const song = player.song;
  if (!song) return null;

  const total = player.length || song.secs || 0;
  const pct = total ? Math.min(100, (player.at / total) * 100) : 0;

  return (
    <div
      role="region"
      aria-label="Now playing"
      className="relative z-[450] shrink-0 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur-md animate-fade-in"
    >
      <div className="mx-auto flex h-12 w-full max-w-2xl items-center gap-2.5 px-3">
        <button
          type="button"
          onClick={() => musicPlayer.toggle(song)}
          aria-label={player.playing ? 'Pause' : 'Play'}
          className="focus-ring grid size-9 shrink-0 place-items-center rounded-full bg-brand text-on-brand active:scale-95"
        >
          {player.loading ? (
            <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-on-brand/30 border-t-on-brand" />
          ) : player.playing ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" className="ml-0.5" />
          )}
        </button>

        {song.img ? (
          <img src={song.img} alt="" className={cn('size-8 shrink-0 rounded-md object-cover', player.playing && 'animate-[spin_8s_linear_infinite] rounded-full')} />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand"><Music2 size={16} /></span>
        )}

        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13.5px] font-semibold text-ink">{song.name}</span>
          <span className="block truncate text-[12px] text-text-secondary">
            {player.failed ? 'Could not play. Tap play to try again.' : song.artist || 'PINGO Music'}
          </span>
        </span>

        <button
          type="button"
          onClick={() => musicPlayer.setSpeed(nextSpeed(player.speed))}
          aria-label={`Speed ${player.speed}x`}
          className="focus-ring h-7 shrink-0 rounded-full bg-sunken px-2 text-[11.5px] font-bold text-text-secondary tabular-nums"
        >
          {player.speed}x
        </button>
        <button
          type="button"
          onClick={() => musicPlayer.close()}
          aria-label="Stop and close"
          className="focus-ring grid size-8 shrink-0 place-items-center rounded-full text-text-secondary active:bg-pressed"
        >
          <X size={18} />
        </button>
      </div>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-brand/15">
        <span className="block h-full bg-brand transition-[width] duration-300 ease-linear" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
