import React from 'react';
import { Bookmark, Check, Film, Star, Tv } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbMedia } from '../types.js';
import { getTmdbPosterUrl } from '../api/tmdb.js';
import { useWatchlist } from '../hooks/useWatchlist.js';

interface TvMediaCardProps {
  media: TmdbMedia;
  onSelect: (media: TmdbMedia) => void;
  className?: string;
}

export function TvMediaCard({ media, onSelect, className }: TvMediaCardProps) {
  const { isSaved, toggleWatchlist } = useWatchlist();
  const title = media.title || media.name || 'Untitled';
  const year = (media.release_date || media.first_air_date || '').slice(0, 4);
  const mediaType = media.media_type || (media.title ? 'movie' : 'tv');
  const rating = media.vote_average ? media.vote_average.toFixed(1) : null;
  const saved = isSaved(media.id, mediaType);
  const posterUrl = getTmdbPosterUrl(media.poster_path, 'w342');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(media)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(media);
        }
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden text-left focus:outline-none',
        className,
      )}
    >
      {/* Poster Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-sunken shadow-sm transition-all duration-200 group-hover:shadow-md group-hover:ring-2 group-hover:ring-brand/40 group-active:scale-[0.98]">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center p-3 text-center">
            {mediaType === 'movie' ? (
              <Film className="mb-2 size-8 text-text-secondary/50" />
            ) : (
              <Tv className="mb-2 size-8 text-text-secondary/50" />
            )}
            <span className="line-clamp-2 text-xs font-medium text-text-secondary">{title}</span>
          </div>
        )}

        {/* Gradient scrim for bottom metadata */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

        {/* Top Badges */}
        <div className="absolute top-1.5 left-1.5 flex flex-wrap items-center gap-1 z-10">
          {rating && (
            <span className="flex items-center gap-0.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur-sm border border-white/10">
              <Star className="size-2.5 fill-amber-300 text-amber-300" />
              {rating}
            </span>
          )}
          {media.original_language === 'hi' ? (
            <span className="rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-black text-black backdrop-blur-sm shadow-sm">
              हिन्दी
            </span>
          ) : media.media_type === 'tv' || media.genre_ids?.includes(16) ? (
            <span className="rounded-md bg-sky-950/80 px-1.5 py-0.5 text-[9.5px] font-bold text-sky-300 backdrop-blur-sm border border-sky-500/30">
              SUB | DUB
            </span>
          ) : null}
        </div>

        {/* Watchlist Quick Button */}
        <button
          type="button"
          aria-label={saved ? 'Remove from Watchlist' : 'Add to Watchlist'}
          onClick={(e) => {
            e.stopPropagation();
            toggleWatchlist(media);
          }}
          className={cn(
            'absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full text-xs shadow-md transition-all z-10',
            saved
              ? 'bg-brand text-on-brand'
              : 'bg-black/60 text-white/90 backdrop-blur-sm hover:bg-black/90 active:scale-90',
          )}
        >
          {saved ? <Check className="size-3.5" /> : <Bookmark className="size-3.5" />}
        </button>

        {/* Media type pill */}
        <div className="absolute bottom-1.5 left-1.5 z-10">
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase text-white/90 backdrop-blur-sm border border-white/10">
            {mediaType === 'movie' ? 'Movie' : 'Series'}
          </span>
        </div>
      </div>

      {/* Title & Metadata */}
      <div className="mt-1.5 flex flex-col">
        <h3 className="line-clamp-1 text-xs font-semibold text-ink group-hover:text-brand transition-colors">
          {title}
        </h3>
        <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          {year && <span>{year}</span>}
          {year && rating && <span>•</span>}
          {rating && (
            <span className="flex items-center gap-0.5">
              <Star className="size-2.5 fill-amber-400 text-amber-400" />
              {rating}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
