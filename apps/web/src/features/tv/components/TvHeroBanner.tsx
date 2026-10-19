import React, { useEffect, useRef, useState } from 'react';
import { Check, Info, Play, Plus } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbMedia } from '../types.js';
import { getTmdbBackdropUrl, getTmdbPosterUrl } from '../api/tmdb.js';
import { useWatchlist } from '../hooks/useWatchlist.js';

interface TvHeroBannerProps {
  items: TmdbMedia[];
  onPlayStream: (media: TmdbMedia) => void;
  onPlayTrailer: (media: TmdbMedia) => void;
  onOpenDetails: (media: TmdbMedia) => void;
}

const SLIDES = 5;
const AUTO_MS = 7000;

/**
 * The feature at the top: full width, edge to edge, running up under the bar.
 * Tall and poster-led on a phone, wide and backdrop-led on a desktop, always
 * fading into the page so the first rail starts from the same black.
 */
export function TvHeroBanner({ items, onPlayStream, onOpenDetails }: TvHeroBannerProps) {
  const [active, setActive] = useState(0);
  const { isSaved, toggleWatchlist } = useWatchlist();
  const slides = items.slice(0, SLIDES);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    setActive(0);
  }, [items]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setTimeout(() => setActive((i) => (i + 1) % slides.length), AUTO_MS);
    return () => clearTimeout(timer);
  }, [active, slides.length]);

  const current = slides[active] ?? slides[0];
  if (!current) return null;

  const title = current.title || current.name || 'Featured';
  const type = current.media_type || (current.title ? 'movie' : 'tv');
  const year = (current.release_date || current.first_air_date || '').slice(0, 4);
  const rating = current.vote_average ? current.vote_average.toFixed(1) : null;
  const saved = isSaved(current.id, type);
  const backdrop = getTmdbBackdropUrl(current.backdrop_path, 'w1280');
  const poster = getTmdbPosterUrl(current.poster_path, 'w500');

  const go = (delta: number) => setActive((i) => (i + delta + slides.length) % slides.length);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      className="relative isolate h-[min(78svh,640px)] min-h-[460px] w-full overflow-hidden bg-[#0d0e14] md:h-[min(72svh,720px)]"
      onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null || Math.abs(end - start) < 48) return;
        go(end < start ? 1 : -1);
      }}
    >
      {/* Phone: the poster, filling the width. Desktop: the backdrop. */}
      <div key={current.id} className="absolute inset-0 -z-10 animate-fade-in">
        {poster && <img src={poster} alt="" draggable={false} className="h-full w-full object-cover object-top md:hidden" />}
        {backdrop && <img src={backdrop} alt="" draggable={false} className={cn('h-full w-full object-cover object-[50%_20%]', poster ? 'hidden md:block' : '')} />}
      </div>

      {/* Down into the page, and in from the left so text always has a dark ground. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-page via-page/70 via-35% to-transparent to-65%" />
      <div aria-hidden className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-page/90 via-page/40 via-45% to-transparent md:block" />
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-32 bg-gradient-to-b from-black/60 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-5 pb-9 text-center md:max-w-[640px] md:items-start md:px-10 md:pb-14 md:text-left">
        <h1 className="line-clamp-2 text-balance text-[32px] font-black leading-[1.05] tracking-tight text-white drop-shadow-lg md:text-5xl">{title}</h1>

        <p className="flex flex-wrap items-center justify-center gap-x-2 text-[13px] font-medium text-white/80 md:justify-start">
          <span>{type === 'movie' ? 'Movie' : 'Series'}</span>
          {year && <><span aria-hidden className="text-white/35">·</span><span>{year}</span></>}
          {rating && <><span aria-hidden className="text-white/35">·</span><span>{rating} / 10</span></>}
          {current.original_language === 'hi' && <><span aria-hidden className="text-white/35">·</span><span>Hindi</span></>}
        </p>

        <p className="line-clamp-2 max-w-md text-[13px] leading-relaxed text-white/70 md:line-clamp-3 md:text-sm">{current.overview}</p>

        <div className="mt-1 flex w-full items-center justify-center gap-2.5 md:justify-start">
          <button
            type="button"
            onClick={() => onPlayStream(current)}
            className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-white px-6 text-[15px] font-bold text-black transition active:scale-[0.97] md:h-12 md:flex-none md:px-8"
          >
            <Play className="size-5 fill-black" /> Watch now
          </button>
          <button
            type="button"
            aria-label={saved ? 'Remove from My Space' : 'Add to My Space'}
            onClick={() => toggleWatchlist(current)}
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/15 text-white backdrop-blur-md transition hover:bg-white/25 active:scale-95"
          >
            {saved ? <Check className="size-5" strokeWidth={2.6} /> : <Plus className="size-5" strokeWidth={2.4} />}
          </button>
          <button
            type="button"
            aria-label="More info"
            onClick={() => onOpenDetails(current)}
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/15 text-white backdrop-blur-md transition hover:bg-white/25 active:scale-95"
          >
            <Info className="size-5" />
          </button>
        </div>

        {slides.length > 1 && (
          <div role="tablist" aria-label="Featured titles" className="mt-2 flex items-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`Show ${s.title || s.name}`}
                onClick={() => setActive(i)}
                className={cn('h-1 rounded-full transition-all duration-300', i === active ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60')}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
