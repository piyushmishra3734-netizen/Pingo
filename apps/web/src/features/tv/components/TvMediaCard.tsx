import React, { useState } from 'react';
import { Check, Film, Plus, Tv } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbMedia } from '../types.js';
import { getTmdbPosterUrl } from '../api/tmdb.js';
import { useWatchlist } from '../hooks/useWatchlist.js';

interface TvMediaCardProps {
  media: TmdbMedia;
  onSelect: (media: TmdbMedia) => void;
  className?: string;
  /** Rails show posters alone; grids (search, watchlist) add the title underneath. */
  showTitle?: boolean;
}

export function TvMediaCard({ media, onSelect, className, showTitle = true }: TvMediaCardProps) {
  const { isSaved, toggleWatchlist } = useWatchlist();
  const [broken, setBroken] = useState(false);
  const title = media.title || media.name || 'Untitled';
  const year = (media.release_date || media.first_air_date || '').slice(0, 4);
  const mediaType = media.media_type || (media.title ? 'movie' : 'tv');
  const saved = isSaved(media.id, mediaType);
  const posterUrl = getTmdbPosterUrl(media.poster_path, 'w342');

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
      className={cn('group relative flex cursor-pointer flex-col text-left focus:outline-none', className)}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-sunken transition duration-200 group-focus-visible:ring-2 group-focus-visible:ring-white group-active:scale-[0.97]">
        {posterUrl && !broken ? (
          <img
            src={posterUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
            {mediaType === 'movie' ? <Film className="size-7 text-text-tertiary" /> : <Tv className="size-7 text-text-tertiary" />}
            <span className="line-clamp-3 text-xs font-medium text-text-secondary">{title}</span>
          </div>
        )}

        <button
          type="button"
          aria-label={saved ? 'Remove from My List' : 'Add to My List'}
          onClick={(e) => {
            e.stopPropagation();
            toggleWatchlist(media);
          }}
          className={cn(
            'absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full backdrop-blur-md transition active:scale-90',
            saved
              ? 'bg-white text-black opacity-100'
              : 'bg-black/55 text-white opacity-0 hover:bg-black/80 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          {saved ? <Check className="size-4" strokeWidth={2.6} /> : <Plus className="size-4" strokeWidth={2.4} />}
        </button>
      </div>

      {showTitle && (
        <div className="mt-2 min-w-0">
          <h3 className="line-clamp-1 text-[13px] font-semibold text-ink">{title}</h3>
          {year && <p className="text-[11px] text-text-secondary">{year}</p>}
        </div>
      )}
    </div>
  );
}
