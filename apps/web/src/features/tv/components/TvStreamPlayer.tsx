import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Film,
  Maximize2,
  MonitorPlay,
  Play,
  RefreshCw,
  SkipForward,
  Sparkles,
  Tv,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@pingo/ui';
import type { MediaType, TmdbMedia } from '../types.js';

export interface StreamProvider {
  id: string;
  name: string;
  badge?: string;
  isHindi?: boolean;
  buildUrl: (mediaType: MediaType, id: number | string, season: number, episode: number) => string;
}

// Complete provider lineup with Hindi and fallback priority
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
    id: 'vidlink',
    name: 'VidLink',
    badge: 'Fast HD',
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://vidlink.pro/movie/${id}`
        : `https://vidlink.pro/tv/${id}/${s}/${e}`,
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
    badge: 'Global CDN',
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

const LAST_SOURCE_KEY = 'pingo:lastSource';

interface TvStreamPlayerProps {
  media: TmdbMedia;
  initialSeason?: number;
  initialEpisode?: number;
  onClose: () => void;
  onOpenTrailer?: (media: TmdbMedia) => void;
  /** Told when the episode changes, so friends can see which one this is. */
  onEpisodeChange?: (season: number, episode: number) => void;
}

export function TvStreamPlayer({
  media,
  initialSeason = 1,
  initialEpisode = 1,
  onClose,
  onOpenTrailer,
  onEpisodeChange,
}: TvStreamPlayerProps) {
  // Initialize with last good working source or default to NHD Hindi
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(LAST_SOURCE_KEY);
      if (saved && STREAM_PROVIDERS.some((p) => p.id === saved)) {
        return saved;
      }
    } catch {
      // Ignore localStorage errors
    }
    return 'nhd';
  });

  const [season, setSeason] = useState<number>(initialSeason);
  const [episode, setEpisode] = useState<number>(initialEpisode);
  useEffect(() => {
    onEpisodeChange?.(season, episode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, episode]);
  const [isTheater, setIsTheater] = useState<boolean>(false);
  const [autoSwitchEnabled, setAutoSwitchEnabled] = useState<boolean>(true);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [notification, setNotification] = useState<string | null>(null);
  const [isCheckingNext, setIsCheckingNext] = useState<boolean>(false);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const title = media.title || media.name || 'Untitled';
  const mediaType: MediaType = media.media_type || (media.title ? 'movie' : 'tv');
  const isTv = mediaType === 'tv';

  const providerIndex = STREAM_PROVIDERS.findIndex((p) => p.id === selectedProviderId);
  const provider = STREAM_PROVIDERS[providerIndex >= 0 ? providerIndex : 0]!;
  const streamUrl = provider.buildUrl(mediaType, media.id, season, episode);

  // Switch to next source in priority lineup
  const switchToNextSource = useCallback(() => {
    const nextIdx = (providerIndex + 1) % STREAM_PROVIDERS.length;
    const nextProvider = STREAM_PROVIDERS[nextIdx];
    if (nextProvider) {
      setSelectedProviderId(nextProvider.id);
      try {
        localStorage.setItem(LAST_SOURCE_KEY, nextProvider.id);
      } catch {
        // Ignore
      }
      setNotification(`Auto-switched to ${nextProvider.name}`);
      setTimeout(() => setNotification(null), 3000);
    }
  }, [providerIndex]);

  // Handle manual provider selection
  const handleSelectProvider = (id: string) => {
    setSelectedProviderId(id);
    try {
      localStorage.setItem(LAST_SOURCE_KEY, id);
    } catch {
      // Ignore
    }
    const target = STREAM_PROVIDERS.find((p) => p.id === id);
    if (target) {
      setNotification(`Switched to ${target.name}`);
      setTimeout(() => setNotification(null), 2500);
    }
  };

  // Reload current iframe stream
  const handleReload = () => {
    setReloadKey((k) => k + 1);
    setNotification('Reloading stream...');
    setTimeout(() => setNotification(null), 2000);
  };

  // Auto-switch safety watcher: If a stream does not establish or encounters an issue,
  // allow 12 seconds grace period before suggesting or performing auto-switch
  useEffect(() => {
    if (!autoSwitchEnabled) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setIsCheckingNext(false);

    // After 10 seconds of no interaction, arm the auto-switch banner
    timeoutRef.current = setTimeout(() => {
      setIsCheckingNext(true);
    }, 10000);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [selectedProviderId, reloadKey, season, episode, autoSwitchEnabled]);

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/95 p-1 sm:p-4 backdrop-blur-md animate-fadeIn">
      {/* Click backdrop to close */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* Main Player Box */}
      <div
        className={cn(
          'relative z-10 flex flex-col overflow-hidden rounded-2xl bg-[#090a0f] shadow-2xl ring-1 ring-white/10 transition-all duration-300',
          isTheater ? 'h-full w-full max-w-full rounded-none' : 'h-full max-h-[96dvh] w-full max-w-5xl',
        )}
      >
        {/* Player Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#12141c] px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand shadow-sm">
              {isTv ? <Tv className="size-4" /> : <Film className="size-4" />}
            </span>
            <div className="flex items-baseline gap-2 truncate">
              <h3 className="truncate text-sm font-bold text-white sm:text-base">{title}</h3>
              {isTv && (
                <span className="shrink-0 rounded bg-brand/20 border border-brand/40 px-2 py-0.5 text-xs font-semibold text-brand">
                  S{season} : E{episode}
                </span>
              )}
            </div>
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Auto-Switch Toggle */}
            <button
              type="button"
              onClick={() => setAutoSwitchEnabled((prev) => !prev)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all active:scale-95',
                autoSwitchEnabled
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-text-secondary border border-white/10',
              )}
              title="Automatically hops to the next source if current server is unavailable"
            >
              <Zap className="size-3.5 fill-current" />
              <span className="hidden sm:inline">Auto-Switch: {autoSwitchEnabled ? 'ON' : 'OFF'}</span>
            </button>

            {/* Next Source Button */}
            <button
              type="button"
              onClick={switchToNextSource}
              className="flex items-center gap-1.5 rounded-lg bg-brand/20 border border-brand/40 px-2.5 py-1 text-xs font-bold text-brand hover:bg-brand/30 transition-all active:scale-95 shadow-sm"
              title="Switch to next streaming source"
            >
              <SkipForward className="size-3.5" />
              <span>Next Source ▸</span>
            </button>

            {/* Reload Stream */}
            <button
              type="button"
              onClick={handleReload}
              className="grid size-8 place-items-center rounded-full text-text-secondary hover:bg-white/10 hover:text-white transition-colors active:scale-95"
              title="Reload current stream"
            >
              <RefreshCw className="size-3.5" />
            </button>

            {/* Open Direct External Stream */}
            <a
              href={streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="grid size-8 place-items-center rounded-full text-text-secondary hover:bg-white/10 hover:text-white transition-colors active:scale-95"
              title="Open stream in a new tab"
            >
              <ExternalLink className="size-3.5" />
            </a>

            {onOpenTrailer && (
              <button
                type="button"
                onClick={() => onOpenTrailer(media)}
                className="hidden sm:flex items-center gap-1.5 rounded-lg bg-white/10 border border-white/20 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <Play className="size-3.5 fill-current text-brand" />
                <span>Trailer</span>
              </button>
            )}

            <button
              type="button"
              aria-label="Toggle Theater Mode"
              onClick={() => setIsTheater((prev) => !prev)}
              className="grid size-8 place-items-center rounded-full text-text-secondary hover:bg-white/10 hover:text-white transition-colors active:scale-95"
            >
              <Maximize2 className="size-4" />
            </button>

            <button
              type="button"
              aria-label="Close player"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-full text-text-secondary hover:bg-white/10 hover:text-white transition-colors active:scale-95"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Video Frame */}
        <div className="relative aspect-video w-full flex-1 bg-black">
          {/* Notification Toast */}
          {notification && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-black/85 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur-md border border-white/20 shadow-xl animate-fadeIn">
              <Zap className="size-3.5 text-brand" />
              <span>{notification}</span>
            </div>
          )}

          {/* Auto-Switch Assistance Floating Banner */}
          {isCheckingNext && autoSwitchEnabled && (
            <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-20 flex flex-wrap items-center gap-3 rounded-xl bg-[#12141c]/90 px-4 py-2.5 backdrop-blur-xl border border-white/10 shadow-2xl">
              <div className="flex items-center gap-2 text-xs text-white">
                <AlertCircle className="size-4 text-amber-400 shrink-0" />
                <span>Stream not starting?</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={switchToNextSource}
                  className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-on-brand shadow-sm transition-transform active:scale-95"
                >
                  Auto-Switch to Next Server
                </button>
                <button
                  type="button"
                  onClick={() => setIsCheckingNext(false)}
                  className="rounded-lg bg-white/10 px-2 py-1 text-xs text-text-secondary hover:text-white"
                >
                  Stay
                </button>
              </div>
            </div>
          )}

          <iframe
            key={`${provider.id}-${mediaType}-${media.id}-${season}-${episode}-${reloadKey}`}
            src={streamUrl}
            title={`${title} Live Stream`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture; accelerometer; gyroscope"
            allowFullScreen
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
            onError={() => {
              if (autoSwitchEnabled) {
                switchToNextSource();
              }
            }}
          />
        </div>

        {/* Player Bottom Control Strip */}
        <div className="flex flex-col gap-2.5 border-t border-white/10 bg-[#12141c] px-4 py-2.5">
          {/* Source Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-secondary">
              <MonitorPlay className="size-3.5 text-brand" />
              <span>Sources ({STREAM_PROVIDERS.length}):</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {STREAM_PROVIDERS.map((p, idx) => {
                const active = selectedProviderId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectProvider(p.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all active:scale-95',
                      active
                        ? 'bg-brand text-on-brand shadow-sm'
                        : 'bg-white/5 text-text-secondary hover:bg-white/10 hover:text-white ring-1 ring-white/10',
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
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-brand/20 text-brand',
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2 text-xs">
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
                          : 'bg-white/5 text-text-secondary hover:bg-white/10 ring-1 ring-white/10',
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
                        : 'bg-white/5 text-text-secondary hover:bg-white/10 ring-1 ring-white/10',
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
