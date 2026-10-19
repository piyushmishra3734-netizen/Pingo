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

/** TMDB genre ids, as the words Netflix puts under a title. */
const GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller',
  10752: 'War', 37: 'Western', 10759: 'Action', 10765: 'Sci-Fi', 10768: 'War', 10762: 'Kids', 10764: 'Reality', 10766: 'Soap',
};
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
  const genres = [...new Set((current.genre_ids ?? []).map((id) => GENRES[id]).filter((g): g is string => !!g))].slice(0, 3);
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
        <h1 className="line-clamp-2 text-balance text-[34px] font-extrabold leading-[1.02] tracking-[-0.03em] text-white md:text-[56px]">{title}</h1>

        {genres.length > 0 && (
          <p className="flex flex-wrap items-center justify-center gap-x-2 text-[13px] font-medium text-white md:justify-start md:text-sm">
            {genres.map((g, i) => (
              <React.Fragment key={g}>
                {i > 0 && <span aria-hidden className="text-[8px] text-white/60">&bull;</span>}
                <span>{g}</span>
              </React.Fragment>
            ))}
          </p>
        )}

        <p className="hidden max-w-lg text-base leading-snug text-white/90 md:line-clamp-3 md:block">{current.overview}</p>

        <div className="mt-1 flex w-full items-stretch justify-center gap-2 md:w-auto md:justify-start md:gap-3">
          <button
            type="button"
            onClick={() => onPlayStream(current)}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md bg-white px-6 text-base font-bold text-black transition hover:bg-white/80 active:scale-[0.97] md:h-12 md:flex-none md:px-8 md:text-lg"
          >
            <Play className="size-6 fill-black" /> Play
          </button>
          <button
            type="button"
            onClick={() => toggleWatchlist(current)}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md bg-[#6d6d6eb3] px-5 text-base font-semibold text-white transition hover:bg-[#6d6d6e66] active:scale-[0.97] md:h-12 md:flex-none md:px-7 md:text-lg"
          >
            {saved ? <Check className="size-5" strokeWidth={2.6} /> : <Plus className="size-5" strokeWidth={2.4} />} My List
          </button>
          <button
            type="button"
            onClick={() => onOpenDetails(current)}
            className="hidden h-12 items-center justify-center gap-2 rounded-md bg-[#6d6d6eb3] px-7 text-lg font-semibold text-white transition hover:bg-[#6d6d6e66] active:scale-[0.97] md:flex"
          >
            <Info className="size-5" /> More Info
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
