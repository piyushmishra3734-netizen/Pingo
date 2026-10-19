import React, { useEffect, useState } from 'react';
import { AlertCircle, Film, Loader2, X } from 'lucide-react';
import type { MediaType, TmdbMedia } from '../types.js';
import { fetchVideos } from '../api/tmdb.js';
import { TvLogo } from './TvLogo.js';

interface TvTrailerPlayerProps {
  media: TmdbMedia;
  onClose: () => void;
}

export function TvTrailerPlayer({ media, onClose }: TvTrailerPlayerProps) {
  const [videoKey, setVideoKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const title = media.title || media.name || 'Official Trailer';
  const mediaType: MediaType = media.media_type || (media.title ? 'movie' : 'tv');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void fetchVideos(mediaType, media.id)
      .then((videos) => {
        if (!active) return;
        // Prioritize official trailers, then trailers, then any teaser
        const trailer =
          videos.find((v) => v.type === 'Trailer' && v.official) ||
          videos.find((v) => v.type === 'Trailer') ||
          videos.find((v) => v.type === 'Teaser') ||
          videos[0];

        if (trailer && trailer.key) {
          setVideoKey(trailer.key);
        } else {
          setError('No official trailer found on TMDB for this title.');
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('Unable to load video trailer.');
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

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/90 p-2 sm:p-6 backdrop-blur-md animate-fadeIn">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* Video Container */}
      <div className="relative z-10 flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-white/10">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <TvLogo markOnly className="shrink-0 [&_img]:h-6" />
            <h3 className="line-clamp-1 text-sm font-semibold text-ink sm:text-base">{title}</h3>
            <span className="rounded bg-brand/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand">
              Trailer
            </span>
          </div>

          <button
            type="button"
            aria-label="Close trailer"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-text-secondary transition-colors hover:bg-line hover:text-ink active:scale-95"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Video Player Frame */}
        <div className="relative aspect-video w-full bg-black">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-secondary">
              <Loader2 className="size-8 animate-spin text-brand" />
              <span className="text-xs">Loading trailer...</span>
            </div>
          )}

          {!loading && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-text-secondary">
              <AlertCircle className="size-10 text-amber-500" />
              <p className="text-sm font-medium text-ink">{error}</p>
              <p className="max-w-xs text-xs">
                Official licensed trailers are sourced from TMDB and YouTube.
              </p>
            </div>
          )}

          {!loading && videoKey && (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoKey}?autoplay=1&rel=0&modestbranding=1`}
              title={`${title} Official Trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default TvTrailerPlayer;
