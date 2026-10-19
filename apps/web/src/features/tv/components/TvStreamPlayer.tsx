import React, { useState } from 'react';
import { AlertCircle, Check, Film, Maximize2, MonitorPlay, Play, Sparkles, Tv, X } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { MediaType, TmdbMedia } from '../types.js';

export interface StreamProvider {
  id: string;
  name: string;
  badge?: string;
  isHindi?: boolean;
  buildUrl: (mediaType: MediaType, id: number | string, season: number, episode: number) => string;
}

// Complete provider lineup ported directly from Pingo TV prototype
export const STREAM_PROVIDERS: StreamProvider[] = [
  {
    id: 'nhd',
    name: 'NHD Embed',
    badge: 'Hindi Audio',
    isHindi: true,
    buildUrl: (type, id, s, e) =>
      type === 'movie' ? `https://nhdapi.com/movie/${id}` : `https://nhdapi.com/tv/${id}/${s}/${e}`,
  },
  {
    id: 'vidsrc_pm',
    name: 'VidSrc.pm',
    badge: 'Multi-Audio',
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://vidsrc.pm/embed/movie/${id}`
        : `https://vidsrc.pm/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'vidlink',
    name: 'VidLink',
    badge: 'Fast HD',
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://vidlink.pro/movie/${id}`
        : `https://vidlink.pro/tv/${id}/${s}/${e}`,
  },
  {
    id: 'vidfast',
    name: 'VidFast',
    badge: 'AutoPlay',
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://vidfast.vc/movie/${id}?autoPlay=true`
        : `https://vidfast.vc/tv/${id}/${s}/${e}?autoPlay=true`,
  },
  {
    id: 'vidsrc_pk',
    name: 'VidSrc.pk',
    badge: 'Hindi Dub',
    isHindi: true,
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://embed.vidsrc.pk/movie/${id}?lang=Hindi`
        : `https://embed.vidsrc.pk/tv/${id}/${s}-${e}?lang=Hindi`,
  },
  {
    id: 'apiplayer',
    name: 'ApiPlayer',
    badge: 'Hindi/Eng',
    isHindi: true,
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://apiplayer.ru/embed/movie/${id}?lang=hi`
        : `https://apiplayer.ru/embed/tv/${id}/${s}/${e}?lang=hi`,
  },
  {
    id: 'autoembed',
    name: 'AutoEmbed',
    badge: 'Global',
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://autoembed.co/movie/tmdb/${id}`
        : `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`,
  },
  {
    id: 'vidsrc_io',
    name: 'VidSrc.io',
    badge: 'Alternative',
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://vidsrc.io/embed/movie/${id}`
        : `https://vidsrc.io/embed/tv/${id}/${s}/${e}`,
  },
];

interface TvStreamPlayerProps {
  media: TmdbMedia;
  initialSeason?: number;
  initialEpisode?: number;
  onClose: () => void;
  onOpenTrailer?: (media: TmdbMedia) => void;
}

export function TvStreamPlayer({
  media,
  initialSeason = 1,
  initialEpisode = 1,
  onClose,
  onOpenTrailer,
}: TvStreamPlayerProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string>('nhd');
  const [season, setSeason] = useState<number>(initialSeason);
  const [episode, setEpisode] = useState<number>(initialEpisode);
  const [isTheater, setIsTheater] = useState<boolean>(false);

  const title = media.title || media.name || 'Untitled';
  const mediaType: MediaType = media.media_type || (media.title ? 'movie' : 'tv');
  const isTv = mediaType === 'tv';

  const provider = STREAM_PROVIDERS.find((p) => p.id === selectedProviderId) || STREAM_PROVIDERS[0]!;
  const streamUrl = provider.buildUrl(mediaType, media.id, season, episode);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/95 p-1 sm:p-4 backdrop-blur-md animate-fadeIn">
      {/* Click backdrop to close */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* Main Player Box */}
      <div
        className={cn(
          'relative z-10 flex flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-white/10 transition-all duration-300',
          isTheater ? 'h-full w-full max-w-full rounded-none' : 'h-full max-h-[96vh] w-full max-w-5xl',
        )}
      >
        {/* Player Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand shadow-sm">
              {isTv ? <Tv className="size-4" /> : <Film className="size-4" />}
            </span>
            <div className="flex items-baseline gap-2 truncate">
              <h3 className="truncate text-sm font-bold text-ink sm:text-base">{title}</h3>
              {isTv && (
                <span className="shrink-0 rounded bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">
                  S{season} : E{episode}
                </span>
              )}
            </div>
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenTrailer && (
              <button
                type="button"
                onClick={() => onOpenTrailer(media)}
                className="hidden sm:flex items-center gap-1.5 rounded-lg bg-line px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-ink"
              >
                <Play className="size-3.5 fill-current text-brand" />
                <span>Trailer</span>
              </button>
            )}

            <button
              type="button"
              aria-label="Toggle Theater Mode"
              onClick={() => setIsTheater((prev) => !prev)}
              className="grid size-8 place-items-center rounded-full text-text-secondary transition-colors hover:bg-line hover:text-ink active:scale-95"
            >
              <Maximize2 className="size-4" />
            </button>

            <button
              type="button"
              aria-label="Close player"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-full text-text-secondary transition-colors hover:bg-line hover:text-ink active:scale-95"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Video Frame */}
        <div className="relative aspect-video w-full flex-1 bg-black">
          <iframe
            key={`${provider.id}-${mediaType}-${media.id}-${season}-${episode}`}
            src={streamUrl}
            title={`${title} Live Stream`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="h-full w-full border-0"
          />
        </div>

        {/* Player Bottom Control Strip */}
        <div className="flex flex-col gap-2.5 border-t border-line bg-sunken px-4 py-2.5">
          {/* Source Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary">
              <MonitorPlay className="size-3.5 text-brand" />
              <span>Stream Source:</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {STREAM_PROVIDERS.map((p) => {
                const active = selectedProviderId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProviderId(p.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all active:scale-95',
                      active
                        ? 'bg-brand text-on-brand shadow-sm'
                        : 'bg-surface text-text-secondary hover:bg-line hover:text-ink ring-1 ring-line',
                    )}
                  >
                    <span>{p.name}</span>
                    {p.badge && (
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.2 text-[9px] font-bold uppercase',
                          active
                            ? 'bg-white/20 text-white'
                            : p.isHindi
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-brand/15 text-brand',
                        )}
                      >
                        {p.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TV Season & Episode Navigation */}
          {isTv && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-text-secondary">Season:</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSeason(s);
                        setEpisode(1);
                      }}
                      className={cn(
                        'size-6 rounded-md text-xs font-bold transition-all',
                        season === s
                          ? 'bg-brand text-on-brand'
                          : 'bg-surface text-text-secondary hover:bg-line ring-1 ring-line/50',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <span className="font-semibold text-text-secondary shrink-0">Episode:</span>
                {Array.from({ length: 24 }, (_, i) => i + 1).map((ep) => (
                  <button
                    key={ep}
                    type="button"
                    onClick={() => setEpisode(ep)}
                    className={cn(
                      'min-w-6 px-1.5 h-6 rounded-md text-xs font-bold transition-all',
                      episode === ep
                        ? 'bg-brand text-on-brand'
                        : 'bg-surface text-text-secondary hover:bg-line ring-1 ring-line/50',
                    )}
                  >
                    {ep}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TvStreamPlayer;
