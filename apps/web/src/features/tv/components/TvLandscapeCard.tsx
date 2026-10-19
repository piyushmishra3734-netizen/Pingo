import React from 'react';
import { Film, Play, Tv } from 'lucide-react';
import type { TmdbMedia } from '../types.js';
import { getTmdbBackdropUrl, getTmdbPosterUrl } from '../api/tmdb.js';

/** A wide card: the scene, the title under it, and a line of what it is (an episode, a year). */
export function TvLandscapeCard({ media, onSelect, caption, play = false }: { media: TmdbMedia; onSelect: (media: TmdbMedia) => void; caption?: string; play?: boolean }) {
  const title = media.title || media.name || 'Untitled';
  const type = media.media_type || (media.title ? 'movie' : 'tv');
  const [broken, setBroken] = React.useState(false);
  const src = getTmdbBackdropUrl(media.backdrop_path, 'w780') || getTmdbPosterUrl(media.poster_path, 'w342');
  const year = (media.release_date || media.first_air_date || '').slice(0, 4);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => onSelect(media)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(media);
        }
      }}
      className="group flex cursor-pointer flex-col text-left focus:outline-none"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-sunken ring-1 ring-white/[0.06] transition duration-200 group-hover:ring-white/30 group-focus-visible:ring-2 group-focus-visible:ring-white group-active:scale-[0.98]">
        {src && !broken ? (
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        ) : (
          <div className="flex size-full items-center justify-center text-text-tertiary">{type === 'movie' ? <Film className="size-6" /> : <Tv className="size-6" />}</div>
        )}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
        {play && (
          <span className="absolute bottom-2 left-2 grid size-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm">
            <Play className="size-3.5 fill-white" />
          </span>
        )}
      </div>
      <div className="mt-2 min-w-0">
        <h3 className="truncate text-[13px] font-semibold text-ink">{title}</h3>
        <p className="truncate text-[11.5px] text-text-secondary">{caption ?? (year ? `${type === 'movie' ? 'Movie' : 'Series'} · ${year}` : type === 'movie' ? 'Movie' : 'Series')}</p>
      </div>
    </div>
  );
}
