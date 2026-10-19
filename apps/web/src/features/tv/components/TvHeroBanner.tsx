import React, { useEffect, useState } from 'react';
import { Bookmark, Check, Info, Play, Star } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbMedia } from '../types.js';
import { getTmdbBackdropUrl } from '../api/tmdb.js';
import { useWatchlist } from '../hooks/useWatchlist.js';

interface TvHeroBannerProps {
  items: TmdbMedia[];
  onPlayTrailer: (media: TmdbMedia) => void;
  onOpenDetails: (media: TmdbMedia) => void;
}

export function TvHeroBanner({ items, onPlayTrailer, onOpenDetails }: TvHeroBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const { isSaved, toggleWatchlist } = useWatchlist();

  // Take top 5 items for carousel
  const carouselItems = items.slice(0, 5);

  useEffect(() => {
    if (carouselItems.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % carouselItems.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [carouselItems.length]);

  if (carouselItems.length === 0) return null;

  const current = carouselItems[activeIndex] ?? carouselItems[0];
  if (!current) return null;

  const title = current.title || current.name || 'Featured Title';
  const year = (current.release_date || current.first_air_date || '').slice(0, 4);
  const mediaType = current.media_type || (current.title ? 'movie' : 'tv');
  const rating = current.vote_average ? current.vote_average.toFixed(1) : null;
  const saved = isSaved(current.id, mediaType);
  const backdropUrl = getTmdbBackdropUrl(current.backdrop_path, 'w780');

  return (
    <div className="relative mx-3 sm:mx-4 my-2 overflow-hidden rounded-2xl bg-sunken shadow-lg">
      {/* Background Media */}
      <div className="relative aspect-[16/9] max-h-[460px] w-full min-h-[280px]">
        {backdropUrl ? (
          <img
            key={current.id}
            src={backdropUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-opacity duration-700 ease-out animate-fadeIn"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-tr from-brand-alt to-brand" />
        )}

        {/* Cinematic Scrims (Multi-stop gradient for maximum text contrast) */}
        <div className="absolute inset-0 bg-gradient-to-t from-page via-page/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-page/90 via-page/40 to-transparent" />

        {/* Content Box */}
        <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-8">
          <div className="max-w-xl">
            {/* Meta Row */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded bg-brand/15 px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase text-brand">
                {mediaType === 'movie' ? 'Movie' : 'Series'}
              </span>
              {rating && (
                <span className="flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 text-xs font-semibold text-amber-300 backdrop-blur-sm">
                  <Star className="size-3 fill-amber-300 text-amber-300" />
                  {rating}
                </span>
              )}
              {year && <span className="text-xs font-medium text-text-secondary">{year}</span>}
            </div>

            {/* Title */}
            <h1 className="line-clamp-2 text-2xl font-black tracking-tight text-ink sm:text-4xl">
              {title}
            </h1>

            {/* Overview */}
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-secondary sm:text-sm">
              {current.overview}
            </p>

            {/* Action Buttons */}
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onPlayTrailer(current)}
                className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-xs font-semibold text-on-brand shadow-sm transition-all hover:opacity-95 active:scale-95 sm:text-sm"
              >
                <Play className="size-4 fill-current" />
                <span>Watch Trailer</span>
              </button>

              <button
                type="button"
                onClick={() => toggleWatchlist(current)}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-medium transition-all active:scale-95 sm:text-sm',
                  saved
                    ? 'bg-brand/15 text-brand ring-1 ring-brand/30'
                    : 'bg-surface/80 text-ink backdrop-blur-sm hover:bg-surface active:scale-95 ring-1 ring-line',
                )}
              >
                {saved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
                <span>{saved ? 'In Watchlist' : 'Watchlist'}</span>
              </button>

              <button
                type="button"
                aria-label="More Information"
                onClick={() => onOpenDetails(current)}
                className="grid size-10 place-items-center rounded-xl bg-surface/80 text-ink ring-1 ring-line backdrop-blur-sm transition-all hover:bg-surface active:scale-95"
              >
                <Info className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Carousel Dots */}
        {carouselItems.length > 1 && (
          <div className="absolute right-4 bottom-4 flex items-center gap-1.5">
            {carouselItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Slide ${idx + 1}`}
                onClick={() => setActiveIndex(idx)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  idx === activeIndex ? 'w-5 bg-brand' : 'w-1.5 bg-text-secondary/40 hover:bg-text-secondary/70',
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
