import { TvLogo } from './TvLogo.js';
import React, { useEffect, useState } from 'react';
import { Bookmark, Check, Clock, Film, Loader2, Play, Star, Tv, X } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { MediaType, TmdbMedia, TmdbMediaDetails } from '../types.js';
import { fetchDetails, getTmdbBackdropUrl, getTmdbPosterUrl } from '../api/tmdb.js';
import { useWatchlist } from '../hooks/useWatchlist.js';
import { TvMediaCard } from './TvMediaCard.js';

interface TvMediaDetailsModalProps {
  media: TmdbMedia;
  onClose: () => void;
  onPlayStream: (media: TmdbMedia, season?: number, episode?: number) => void;
  onPlayTrailer: (media: TmdbMedia) => void;
  onSelectMedia: (media: TmdbMedia) => void;
}

export function TvMediaDetailsModal({
  media,
  onClose,
  onPlayStream,
  onPlayTrailer,
  onSelectMedia,
}: TvMediaDetailsModalProps) {
  const [details, setDetails] = useState<TmdbMediaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const { isSaved, toggleWatchlist } = useWatchlist();

  const title = media.title || media.name || 'Untitled';
  const mediaType: MediaType = media.media_type || (media.title ? 'movie' : 'tv');
  const saved = isSaved(media.id, mediaType);

  useEffect(() => {
    let active = true;
    setLoading(true);

    void fetchDetails(mediaType, media.id).then((data) => {
      if (!active) return;
      setDetails(data);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [media.id, mediaType]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const year = (
    details?.release_date ||
    details?.first_air_date ||
    media.release_date ||
    media.first_air_date ||
    ''
  ).slice(0, 4);

  const rating = (details?.vote_average || media.vote_average || 0).toFixed(1);
  const backdropUrl = getTmdbBackdropUrl(details?.backdrop_path || media.backdrop_path, 'w780');
  const posterUrl = getTmdbPosterUrl(details?.poster_path || media.poster_path, 'w342');
  const genres = details?.genres || [];
  const cast = details?.credits?.cast?.slice(0, 8) || [];
  const similar = details?.similar?.results?.slice(0, 6) || [];

  return (
    <div className="fixed inset-0 z-[210] flex items-end justify-center sm:items-center sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      {/* Click outside to dismiss */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* Modal Dialog Content */}
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-y-auto rounded-t-xl bg-surface shadow-2xl sm:rounded-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TvLogo markOnly className="absolute top-4 left-4 z-20 [&_img]:h-7" />

        {/* Close Button */}
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 grid size-8 place-items-center rounded-full bg-black/60 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/90 active:scale-90"
        >
          <X className="size-4" />
        </button>

        {/* Hero Backdrop Banner */}
        <div className="relative aspect-[16/9] w-full min-h-[220px] max-h-[340px] bg-sunken overflow-hidden">
          {backdropUrl ? (
            <img
              src={backdropUrl}
              alt={title}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-tr from-brand-alt to-brand" />
          )}

          {/* Scrims */}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
        </div>

        {/* Body Content */}
        <div className="px-5 pb-8 -mt-16 sm:-mt-20 relative z-10 flex flex-col">
          {/* Header row: Poster + Title + Actions */}
          <div className="flex gap-4 items-end">
            {/* Small Poster */}
            <div className="hidden sm:block shrink-0 aspect-[2/3] w-28 overflow-hidden rounded-xl bg-sunken shadow-md ring-2 ring-surface">
              {posterUrl ? (
                <img src={posterUrl} alt={title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Film className="size-8 text-text-secondary/50" />
                </div>
              )}
            </div>

            {/* Title & Metadata */}
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-text-secondary">
                  {mediaType === 'movie' ? 'Movie' : 'Series'}
                </span>
                {rating !== '0.0' && (
                  <span className="flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 text-xs font-semibold text-amber-300">
                    <Star className="size-3 fill-amber-300 text-amber-300" />
                    {rating}
                  </span>
                )}
                {year && <span className="text-xs font-medium text-text-secondary">{year}</span>}
                {details?.runtime ? (
                  <span className="flex items-center gap-1 text-xs text-text-secondary">
                    <Clock className="size-3" />
                    {Math.floor(details.runtime / 60)}h {details.runtime % 60}m
                  </span>
                ) : details?.number_of_seasons ? (
                  <span className="text-xs text-text-secondary">
                    {details.number_of_seasons} {details.number_of_seasons === 1 ? 'Season' : 'Seasons'}
                  </span>
                ) : null}
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-ink tracking-tight">{title}</h2>
              {details?.tagline && (
                <p className="mt-0.5 text-xs italic text-text-secondary">{details.tagline}</p>
              )}
            </div>
          </div>

          {/* Action CTAs */}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onPlayStream(media, 1, 1)}
              className="flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-bold text-black transition active:scale-95 hover:bg-white/85"
            >
              <Play className="size-4 fill-current" />
              <span>Watch Now</span>
            </button>

            <button
              type="button"
              onClick={() => onPlayTrailer(media)}
              className="flex items-center gap-1.5 rounded-md bg-white/15 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/25 active:scale-95"
            >
              <span>Watch Trailer</span>
            </button>

            <button
              type="button"
              onClick={() => toggleWatchlist(media)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-5 py-2.5 text-sm font-semibold transition-all active:scale-95',
                saved
                  ? 'bg-white/25 text-white'
                  : 'bg-white/15 text-white hover:bg-white/25',
              )}
            >
              {saved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
              <span>{saved ? 'In My List' : 'My List'}</span>
            </button>
          </div>

          {/* Quick TV Episode Launcher (if series) */}
          {mediaType === 'tv' && (
            <div className="mt-4 rounded-xl bg-sunken p-3 ring-1 ring-line">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                  Season 1 Episodes:
                </span>
                <span className="text-[11px] text-brand font-medium">Click to stream</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((ep) => (
                  <button
                    key={ep}
                    type="button"
                    onClick={() => onPlayStream(media, 1, ep)}
                    className="flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line hover:bg-brand hover:text-on-brand active:scale-95 transition-all"
                  >
                    <Play className="size-2.5 fill-current" />
                    <span>Ep {ep}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Genre Badges */}
          {genres.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {genres.map((g) => (
                <span
                  key={g.id}
                  className="text-[13px] font-medium text-text-secondary after:ml-2 after:text-white/30 after:content-['\2022'] last:after:hidden"
                >
                  {g.name}
                </span>
              ))}
            </div>
          )}

          {/* Synopsis Overview */}
          <div className="mt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">Synopsis</h3>
            <p className="mt-1 text-xs sm:text-sm leading-relaxed text-ink/90">
              {details?.overview || media.overview || 'No synopsis provided.'}
            </p>
          </div>

          {/* Cast */}
          {cast.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-text-secondary">Top Cast</h3>
              <div className="flex gap-2.5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {cast.map((actor) => (
                  <div key={actor.id} className="w-20 shrink-0 text-center">
                    <div className="mx-auto aspect-square w-14 overflow-hidden rounded-full bg-sunken">
                      {actor.profile_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w185${actor.profile_path}`}
                          alt={actor.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center font-bold text-xs text-text-secondary">
                          {actor.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-1 text-[11px] font-medium text-ink">{actor.name}</p>
                    <p className="line-clamp-1 text-[10px] text-text-secondary">{actor.character}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Similar Recommendations */}
          {similar.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-secondary">
                More Like This
              </h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {similar.map((sim) => (
                  <TvMediaCard
                    key={`${sim.media_type || 'm'}-${sim.id}`}
                    media={sim}
                    onSelect={(selected) => onSelectMedia(selected)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
