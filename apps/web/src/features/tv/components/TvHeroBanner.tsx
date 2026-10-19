import React, { useEffect, useRef, useState } from 'react';
import { Check, Info, Play, Plus, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbMedia } from '../types.js';
import { fetchVideos, getTmdbBackdropUrl, getTmdbPosterUrl } from '../api/tmdb.js';
import { useWatchlist } from '../hooks/useWatchlist.js';

interface TvHeroBannerProps {
  items: TmdbMedia[];
  onPlayStream: (media: TmdbMedia) => void;
  onPlayTrailer: (media: TmdbMedia) => void;
  onOpenDetails: (media: TmdbMedia) => void;
  /** Held while a title, player or trailer page is open over the hero: no picture and, above all, no sound under it. */
  paused?: boolean;
}

const SLIDES = 5;

/** The trailer for a title, found once: official trailer, then any trailer, then a teaser. */
const trailerKeys = new Map<string, string | null>();
function useTrailerKey(media: TmdbMedia | undefined): string | null {
  const type = media ? media.media_type || (media.title ? 'movie' : 'tv') : null;
  const cacheKey = media && type ? `${type}-${media.id}` : '';
  const [key, setKey] = useState<string | null>(() => (cacheKey ? (trailerKeys.get(cacheKey) ?? null) : null));
  useEffect(() => {
    if (!media || !type) return setKey(null);
    const known = trailerKeys.get(cacheKey);
    if (known !== undefined) return setKey(known);
    setKey(null);
    let live = true;
    void fetchVideos(type, media.id).then((videos) => {
      const pick =
        videos.find((v) => v.type === 'Trailer' && v.official) ?? videos.find((v) => v.type === 'Trailer') ?? videos.find((v) => v.type === 'Teaser');
      const found = pick?.key ?? null;
      trailerKeys.set(cacheKey, found);
      if (live) setKey(found);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);
  return key;
}

/** Autoplaying video is skipped for people who asked for less motion or less data. */
function motionAllowed(): boolean {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    return !(conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? ''));
  } catch {
    return true;
  }
}

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
export function TvHeroBanner({ items, onPlayStream, onOpenDetails, paused = false }: TvHeroBannerProps) {
  const [active, setActive] = useState(0);
  const { isSaved, toggleWatchlist } = useWatchlist();
  const slides = items.slice(0, SLIDES);
  const touch = useRef<number | null>(null);
  const root = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [muted, setMuted] = useState(true);
  const [allowed] = useState(motionAllowed);

  useEffect(() => {
    setActive(0);
  }, [items]);

  const current = slides[active] ?? slides[0];
  const trailer = useTrailerKey(current);
  const playTrailer = Boolean(trailer) && allowed && onScreen && !paused;

  // The picture comes in once the trailer is actually playing, never as a black box first.
  useEffect(() => setRolling(false), [trailer, active]);

  // With a trailer the slide stays until the person moves it; without one it turns by itself.
  useEffect(() => {
    if (slides.length <= 1 || trailer) return;
    const timer = setTimeout(() => setActive((i) => (i + 1) % slides.length), AUTO_MS);
    return () => clearTimeout(timer);
  }, [active, slides.length, trailer]);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting && entry.intersectionRatio > 0.3)), { threshold: [0, 0.3, 0.6] });
    watch.observe(el);
    return () => watch.disconnect();
  }, [current?.id]);

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: next ? 'mute' : 'unMute', args: [] }), '*');
  };

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
      ref={root}
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

      {/*
        The trailer, covering the hero like a background video: sized from the
        hero's own box so it fills it at any shape, with the controls and the
        YouTube chrome pushed out of frame. Muted, because sound nobody asked for
        is the one thing worse than a still image.
      */}
      {playTrailer && trailer && (
        <div aria-hidden className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden transition-opacity duration-700 [container-type:size]', rolling ? 'opacity-100' : 'opacity-0')}>
          <iframe
            key={trailer}
            ref={frame}
            title=""
            tabIndex={-1}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&mute=1&controls=0&loop=1&playlist=${trailer}&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1`}
            onLoad={() => window.setTimeout(() => setRolling(true), 1400)}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-0"
            style={{ width: 'max(100cqw, 177.78cqh)', height: 'max(100cqh, 56.25cqw)' }}
          />
        </div>
      )}

      {/* Down into the page, and in from the left so text always has a dark ground. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-page via-page/70 via-35% to-transparent to-65%" />
      <div aria-hidden className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-page/90 via-page/40 via-45% to-transparent md:block" />
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-32 bg-gradient-to-b from-black/60 to-transparent" />

      {playTrailer && rolling && (
        <button
          type="button"
          aria-label={muted ? 'Turn sound on' : 'Mute'}
          onClick={toggleSound}
          className="absolute right-4 top-[132px] grid size-10 place-items-center rounded-full border border-white/40 bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95 md:top-auto md:right-10 md:bottom-16"
        >
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
      )}

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
