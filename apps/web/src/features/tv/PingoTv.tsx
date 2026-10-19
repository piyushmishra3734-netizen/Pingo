import React, { Suspense, useEffect, useState } from 'react';
import { Bookmark, Film, Flame, Loader2, Sparkles, Star, TrendingUp, Tv } from 'lucide-react';
import type { TmdbMedia, TvTab } from './types.js';
import {
  fetchByGenre,
  fetchPopularMovies,
  fetchPopularTv,
  fetchTopRated,
  fetchTrending,
} from './api/tmdb.js';
import { useWatchlist } from './hooks/useWatchlist.js';
import { TvNavigationTabs } from './components/TvNavigationTabs.js';
import { TvHeroBanner } from './components/TvHeroBanner.js';
import { TvMediaRail } from './components/TvMediaRail.js';
import { TvMediaCard } from './components/TvMediaCard.js';
import { TvSearch } from './components/TvSearch.js';
import { TvMediaDetailsModal } from './components/TvMediaDetailsModal.js';
import { TmdbAttribution } from './components/TmdbAttribution.js';

// Lazy-load the heavy players for code-splitting
const TvTrailerPlayer = React.lazy(() => import('./components/TvTrailerPlayer.js'));
const TvStreamPlayer = React.lazy(() => import('./components/TvStreamPlayer.js'));

export function PingoTv() {
  const [tab, setTab] = useState<TvTab>('home');
  const [loading, setLoading] = useState(true);

  // Data states
  const [trending, setTrending] = useState<TmdbMedia[]>([]);
  const [popularMovies, setPopularMovies] = useState<TmdbMedia[]>([]);
  const [popularShows, setPopularShows] = useState<TmdbMedia[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<TmdbMedia[]>([]);
  const [topRatedShows, setTopRatedShows] = useState<TmdbMedia[]>([]);
  const [actionMovies, setActionMovies] = useState<TmdbMedia[]>([]);
  const [animeShows, setAnimeShows] = useState<TmdbMedia[]>([]);
  const [sciFiMovies, setSciFiMovies] = useState<TmdbMedia[]>([]);

  // Modals
  const [selectedMedia, setSelectedMedia] = useState<TmdbMedia | null>(null);
  const [trailerMedia, setTrailerMedia] = useState<TmdbMedia | null>(null);
  const [streamingTarget, setStreamingTarget] = useState<{
    media: TmdbMedia;
    season: number;
    episode: number;
  } | null>(null);

  const { watchlist } = useWatchlist();

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      fetchTrending('all', 'day'),
      fetchPopularMovies(),
      fetchPopularTv(),
      fetchTopRated('movie'),
      fetchTopRated('tv'),
      fetchByGenre('movie', 28), // Action
      fetchByGenre('tv', 16), // Animation / Anime
      fetchByGenre('movie', 878), // Sci-Fi
    ])
      .then(([trend, popM, popT, topM, topT, action, anime, sciFi]) => {
        if (!active) return;
        setTrending(trend);
        setPopularMovies(popM);
        setPopularShows(popT);
        setTopRatedMovies(topM);
        setTopRatedShows(topT);
        setActionMovies(action);
        setAnimeShows(anime);
        setSciFiMovies(sciFi);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const watchlistAsMedia: TmdbMedia[] = watchlist.map((w) => ({
    id: Number(w.media_id) || Math.floor(Math.random() * 100000),
    title: w.title,
    name: w.title,
    overview: w.overview || '',
    poster_path: w.poster_path,
    backdrop_path: w.backdrop_path,
    vote_average: w.rating || 0,
    media_type: w.media_type,
    release_date: w.release_year ? `${w.release_year}-01-01` : undefined,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-page text-ink [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Pingo TV Top Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-page/90 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-on-brand shadow-sm">
            <Tv className="size-4" />
          </span>
          <span className="text-base font-black tracking-tight text-ink sm:text-lg">
            PINGO <span className="text-brand">TV</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setTab('search')}
          className="flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-line hover:text-ink"
        >
          <span>Search</span>
        </button>
      </header>

      {/* Category Navigation Pills */}
      <div className="sticky top-[calc(2.75rem+max(0.75rem,env(safe-area-inset-top)))] z-30 border-b border-line/60 bg-page/80 backdrop-blur-sm">
        <TvNavigationTabs
          currentTab={tab}
          onTabChange={setTab}
          watchlistCount={watchlist.length}
        />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {loading ? (
          <div className="flex h-80 flex-col items-center justify-center gap-3 text-text-secondary">
            <Loader2 className="size-8 animate-spin text-brand" />
            <span className="text-sm font-medium">Curating Pingo TV titles...</span>
          </div>
        ) : (
          <>
            {/* 1. HOME / FEATURED VIEW */}
            {tab === 'home' && (
              <>
                <TvHeroBanner
                  items={trending}
                  onPlayStream={(media) => setStreamingTarget({ media, season: 1, episode: 1 })}
                  onPlayTrailer={(media) => setTrailerMedia(media)}
                  onOpenDetails={(media) => setSelectedMedia(media)}
                />

                {/* Watchlist Rail (if items saved) */}
                {watchlistAsMedia.length > 0 && (
                  <TvMediaRail
                    title="Your Watchlist"
                    icon={<Bookmark className="size-4" />}
                    items={watchlistAsMedia}
                    onSelect={(m) => setSelectedMedia(m)}
                  />
                )}

                <TvMediaRail
                  title="Trending Today"
                  icon={<Flame className="size-4" />}
                  items={trending}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Popular Movies"
                  icon={<Film className="size-4" />}
                  items={popularMovies}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Popular TV Series"
                  icon={<Tv className="size-4" />}
                  items={popularShows}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Critically Acclaimed"
                  icon={<Star className="size-4" />}
                  items={topRatedMovies}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Anime & Animation"
                  icon={<Sparkles className="size-4" />}
                  items={animeShows}
                  onSelect={(m) => setSelectedMedia(m)}
                />
              </>
            )}

            {/* 2. MOVIES VIEW */}
            {tab === 'movies' && (
              <>
                <TvHeroBanner
                  items={popularMovies}
                  onPlayStream={(media) => setStreamingTarget({ media, season: 1, episode: 1 })}
                  onPlayTrailer={(media) => setTrailerMedia(media)}
                  onOpenDetails={(media) => setSelectedMedia(media)}
                />

                <TvMediaRail
                  title="Trending Movies"
                  icon={<TrendingUp className="size-4" />}
                  items={popularMovies}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Top Rated Cinema"
                  icon={<Star className="size-4" />}
                  items={topRatedMovies}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Action & Adrenaline"
                  icon={<Flame className="size-4" />}
                  items={actionMovies}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Sci-Fi & Odyssey"
                  icon={<Sparkles className="size-4" />}
                  items={sciFiMovies}
                  onSelect={(m) => setSelectedMedia(m)}
                />
              </>
            )}

            {/* 3. SHOWS VIEW */}
            {tab === 'shows' && (
              <>
                <TvHeroBanner
                  items={popularShows}
                  onPlayStream={(media) => setStreamingTarget({ media, season: 1, episode: 1 })}
                  onPlayTrailer={(media) => setTrailerMedia(media)}
                  onOpenDetails={(media) => setSelectedMedia(media)}
                />

                <TvMediaRail
                  title="Trending TV Series"
                  icon={<Tv className="size-4" />}
                  items={popularShows}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Highest Rated TV"
                  icon={<Star className="size-4" />}
                  items={topRatedShows}
                  onSelect={(m) => setSelectedMedia(m)}
                />

                <TvMediaRail
                  title="Anime & Animation Series"
                  icon={<Sparkles className="size-4" />}
                  items={animeShows}
                  onSelect={(m) => setSelectedMedia(m)}
                />
              </>
            )}

            {/* 4. SEARCH VIEW */}
            {tab === 'search' && (
              <TvSearch onSelect={(media) => setSelectedMedia(media)} />
            )}

            {/* 5. WATCHLIST VIEW */}
            {tab === 'watchlist' && (
              <div className="px-4 pt-3">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-ink">My Watchlist</h2>
                  <span className="text-xs text-text-secondary">{watchlist.length} titles</span>
                </div>

                {watchlist.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-text-secondary">
                    <Bookmark className="size-10 text-text-secondary/40" />
                    <p className="text-sm font-semibold text-ink">Your watchlist is empty</p>
                    <p className="max-w-xs text-xs">
                      Bookmark movies and TV series you want to watch later and access them anytime.
                    </p>
                    <button
                      type="button"
                      onClick={() => setTab('home')}
                      className="mt-3 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-on-brand"
                    >
                      Browse Featured
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {watchlistAsMedia.map((m) => (
                      <TvMediaCard
                        key={`${m.media_type || 'm'}-${m.id}`}
                        media={m}
                        onSelect={(selected) => setSelectedMedia(selected)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TMDB Legal Attribution */}
            <TmdbAttribution />
          </>
        )}
      </main>

      {/* Details Sheet / Modal */}
      {selectedMedia && (
        <TvMediaDetailsModal
          media={selectedMedia}
          onClose={() => setSelectedMedia(null)}
          onPlayStream={(m, s = 1, ep = 1) => {
            setSelectedMedia(null);
            setStreamingTarget({ media: m, season: s, episode: ep });
          }}
          onPlayTrailer={(m) => setTrailerMedia(m)}
          onSelectMedia={(m) => setSelectedMedia(m)}
        />
      )}

      {/* Lazy-Loaded Streaming Player (NHD Hindi / Multi-Source) */}
      {streamingTarget && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/90">
              <Loader2 className="size-8 animate-spin text-brand" />
            </div>
          }
        >
          <TvStreamPlayer
            media={streamingTarget.media}
            initialSeason={streamingTarget.season}
            initialEpisode={streamingTarget.episode}
            onClose={() => setStreamingTarget(null)}
            onOpenTrailer={(m) => {
              setStreamingTarget(null);
              setTrailerMedia(m);
            }}
          />
        </Suspense>
      )}

      {/* Lazy-Loaded Trailer Player */}
      {trailerMedia && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80">
              <Loader2 className="size-8 animate-spin text-brand" />
            </div>
          }
        >
          <TvTrailerPlayer
            media={trailerMedia}
            onClose={() => setTrailerMedia(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

export default PingoTv;
