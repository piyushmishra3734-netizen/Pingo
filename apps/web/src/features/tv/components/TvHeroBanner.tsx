import React, { useEffect, useState } from 'react';
import { Bookmark, Check, Info, Play, Star, Volume2 } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbMedia } from '../types.js';
import { getTmdbBackdropUrl, getTmdbPosterUrl, isHindiTitle } from '../api/tmdb.js';
import { useWatchlist } from '../hooks/useWatchlist.js';

interface TvHeroBannerProps {
  items: TmdbMedia[];
  onPlayStream: (media: TmdbMedia) => void;
  onPlayTrailer: (media: TmdbMedia) => void;
  onOpenDetails: (media: TmdbMedia) => void;
}

export function TvHeroBanner({ items, onPlayStream, onPlayTrailer, onOpenDetails }: TvHeroBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const { isSaved, toggleWatchlist } = useWatchlist();

  // Take top 5 items for carousel
  const carouselItems = items.slice(0, 5);

  useEffect(() => {
    if (carouselItems.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % carouselItems.length);
    }, 6500);
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
  const backdropUrl = getTmdbBackdropUrl(current.backdrop_path, 'w1280') || getTmdbBackdropUrl(current.backdrop_path, 'w780');
  const isHindi = isHindiTitle(current);

  return (
    <div className="relative mx-3 sm:mx-6 my-2 overflow-hidden rounded-[20px] bg-[#08090d] shadow-2xl border border-white/5">
      {/* Background Media */}
      <div className="relative aspect-[16/9] max-h-[520px] min-h-[300px] sm:min-h-[380px] w-full">
        {backdropUrl ? (
          <img
            key={current.id}
            src={backdropUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-center transition-all duration-700 ease-out"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-tr from-[#141622] via-[#1a1226] to-[#08090d]" />
        )}

        {/* 8-Stop Non-Linear Calm Luxury Easing Scrims matching JioHotstar & Apple TV */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              linear-gradient(90deg, 
                rgba(8, 9, 13, 0.96) 0%, 
                rgba(8, 9, 13, 0.85) 24%, 
                rgba(8, 9, 13, 0.45) 52%, 
                rgba(8, 9, 13, 0.08) 72%, 
                rgba(8, 9, 13, 0) 88%
              ),
              linear-gradient(180deg,
                rgba(8, 9, 13, 0) 0%,
                rgba(8, 9, 13, 0.05) 38%,
                rgba(8, 9, 13, 0.25) 58%,
                rgba(8, 9, 13, 0.65) 80%,
                rgba(8, 9, 13, 0.92) 92%,
                #08090d 100%
              )
            `,
          }}
        />

        {/* Content Box */}
        <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-8 md:p-10 z-10">
          <div className="max-w-xl">
            {/* Meta Badges Row */}
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/20 bg-black/60 px-2 py-0.5 text-[11px] font-bold tracking-wider uppercase text-white/90 backdrop-blur-md">
                {mediaType === 'movie' ? 'Movie' : 'Series'}
              </span>

              {isHindi ? (
                <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-black text-black backdrop-blur-md shadow-sm">
                  हिन्दी
                </span>
              ) : (
                <span className="rounded-md border border-sky-400/40 bg-sky-950/70 px-2 py-0.5 text-[11px] font-bold text-sky-300 backdrop-blur-md">
                  SUB | DUB
                </span>
              )}

              <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">
                U/A 16+
              </span>

              {rating && (
                <span className="flex items-center gap-1 rounded-md bg-black/60 border border-white/10 px-2 py-0.5 text-xs font-bold text-amber-300 backdrop-blur-md">
                  <Star className="size-3 fill-amber-300 text-amber-300" />
                  {rating}
                </span>
              )}

              {year && <span className="text-xs font-semibold text-white/80">{year}</span>}
            </div>

            {/* Title */}
            <h1 className="line-clamp-2 text-2xl font-black tracking-tight text-white sm:text-4xl md:text-5xl drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)]">
              {title}
            </h1>

            {/* Overview */}
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/80 sm:text-sm drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] max-w-lg">
              {current.overview}
            </p>

            {/* Action Buttons */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {/* Official Pingo Brand Gradient Watch Now CTA */}
              <button
                type="button"
                onClick={() => onPlayStream(current)}
                style={{
                  background: 'linear-gradient(95deg, #4355f9 0%, #a824e8 33%, #ff2a70 68%, #ff8e1e 100%)',
                }}
                className="flex items-center gap-2.5 rounded-xl px-5 sm:px-6 py-3 text-sm font-bold text-white shadow-[0_12px_28px_-8px_rgba(255,42,112,0.55),0_4px_16px_-4px_rgba(67,85,249,0.45)] transition-all hover:scale-105 hover:brightness-110 active:scale-95"
              >
                <Play className="size-4 fill-current" />
                <span>Watch Now</span>
              </button>

              <button
                type="button"
                onClick={() => onPlayTrailer(current)}
                className="flex items-center gap-1.5 rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-sm font-semibold text-white backdrop-blur-md transition-all hover:bg-white/20 active:scale-95 shadow-sm"
              >
                <Volume2 className="size-4" />
                <span>Trailer</span>
              </button>

              <button
                type="button"
                onClick={() => toggleWatchlist(current)}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl px-4 py-3 text-sm font-medium transition-all active:scale-95 backdrop-blur-md',
                  saved
                    ? 'bg-brand/20 text-brand ring-1 ring-brand/40'
                    : 'bg-white/10 text-white/90 border border-white/20 hover:bg-white/20',
                )}
              >
                {saved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
                <span>{saved ? 'In Watchlist' : 'Watchlist'}</span>
              </button>

              <button
                type="button"
                aria-label="More Information"
                onClick={() => onOpenDetails(current)}
                className="grid size-11 place-items-center rounded-xl bg-white/10 border border-white/20 text-white backdrop-blur-md transition-all hover:bg-white/20 active:scale-95"
              >
                <Info className="size-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Edge Carousel Indicator Strip (Desktop) */}
        <div className="absolute right-6 bottom-6 hidden md:flex flex-col items-end gap-2.5 z-20">
          {/* Active Dot Row */}
          <div className="flex items-center gap-1.5">
            {carouselItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Slide ${idx + 1}`}
                onClick={() => setActiveIndex(idx)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  idx === activeIndex
                    ? 'w-6 bg-gradient-to-r from-[#4355f9] to-[#ff2a70]'
                    : 'w-1.5 bg-white/40 hover:bg-white/70',
                )}
              />
            ))}
          </div>

          {/* Interactive Thumbnail Cards (58px-wide) */}
          <div className="flex items-center gap-2">
            {carouselItems.map((item, idx) => {
              const thumbUrl =
                getTmdbBackdropUrl(item.backdrop_path, 'w780') ||
                getTmdbPosterUrl(item.poster_path, 'w185');
              const isSelected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  aria-label={item.title || item.name}
                  className={cn(
                    'relative h-[40px] w-[62px] shrink-0 overflow-hidden rounded-md transition-all duration-200 focus:outline-none',
                    isSelected
                      ? 'ring-2 ring-white scale-105 opacity-100 shadow-lg'
                      : 'opacity-50 hover:opacity-85 ring-1 ring-white/20',
                  )}
                >
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-white/10" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile Carousel Dots (Fallback) */}
        <div className="absolute right-4 bottom-4 flex md:hidden items-center gap-1.5 z-20">
          {carouselItems.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Slide ${idx + 1}`}
              onClick={() => setActiveIndex(idx)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                idx === activeIndex
                  ? 'w-5 bg-gradient-to-r from-[#4355f9] to-[#ff2a70]'
                  : 'w-1.5 bg-white/40 hover:bg-white/70',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
