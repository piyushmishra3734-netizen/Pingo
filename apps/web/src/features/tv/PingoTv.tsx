import React, { Suspense, useEffect, useState } from 'react';
import {
  Bookmark,
  Clapperboard,
  Compass,
  Film,
  Flame,
  Laugh,
  Loader2,
  Search,
  Skull,
  Sparkles,
  Star,
  TrendingUp,
  Tv,
} from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbMedia, TvTab } from './types.js';
import {
  fetchByGenre,
  fetchNowPlaying,
  fetchOnTheAirTv,
  fetchPopularMovies,
  fetchPopularTv,
  fetchTop10Hindi,
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

  // Exact 9 rails matching e:\pingo tv\server.js
  const [trending, setTrending] = useState<TmdbMedia[]>([]);
  const [top10Hindi, setTop10Hindi] = useState<TmdbMedia[]>([]);
  const [nowPlaying, setNowPlaying] = useState<TmdbMedia[]>([]);
  const [latestEpisodes, setLatestEpisodes] = useState<TmdbMedia[]>([]);
  const [actionMovies, setActionMovies] = useState<TmdbMedia[]>([]);
  const [horrorMovies, setHorrorMovies] = useState<TmdbMedia[]>([]);
  const [comedyMovies, setComedyMovies] = useState<TmdbMedia[]>([]);
  const [blockbusters, setBlockbusters] = useState<TmdbMedia[]>([]);
  const [topRated, setTopRated] = useState<TmdbMedia[]>([]);
  const [animeShows, setAnimeShows] = useState<TmdbMedia[]>([]);
  const [popularShows, setPopularShows] = useState<TmdbMedia[]>([]);

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
      fetchTrending('all', 'week'),
      fetchTop10Hindi('hi'),
      fetchNowPlaying(),
      fetchOnTheAirTv(),
      fetchByGenre('movie', 53), // Action & Thrillers
      fetchByGenre('movie', 27), // Edge-of-the-Seat Horror
      fetchByGenre('movie', 35), // Comedy Carnival
      fetchPopularMovies(), // Blockbuster Cinema
      fetchTopRated('movie'), // Top Rated on IMDb
      fetchByGenre('tv', 16), // Anime & Asian Dramas
      fetchPopularTv(),
    ])
      .then(([trend, top10, nowP, onAir, action, horror, comedy, popM, topM, anime, popT]) => {
        if (!active) return;
        setTrending(trend);
        setTop10Hindi(top10);
        setNowPlaying(nowP);
        setLatestEpisodes(onAir);
        setActionMovies(action);
        setHorrorMovies(horror);
        setComedyMovies(comedy);
        setBlockbusters(popM);
        setTopRated(topM);
        setAnimeShows(anime);
        setPopularShows(popT);
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

  const navItems: Array<{ id: TvTab; label: string; icon: React.ReactNode }> = [
    { id: 'home', label: 'Home', icon: <Flame className="size-5" /> },
    { id: 'shows', label: 'TV Shows', icon: <Tv className="size-5" /> },
    { id: 'movies', label: 'Movies', icon: <Film className="size-5" /> },
    { id: 'search', label: 'Search', icon: <Search className="size-5" /> },
    { id: 'watchlist', label: 'My Space', icon: <Bookmark className="size-5" /> },
  ];

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-page text-ink">
      {/* ─── Desktop Left Navigation Rail (.srail) ───────────────────────────
          88px fixed expanding to 216px on hover, pure CSS transitions, 0ms lag */}
      <aside className="group/sidebar fixed inset-y-0 left-0 z-50 hidden md:flex w-[88px] hover:w-[216px] flex-col items-start bg-[#090a0f] border-r border-white/5 py-6 transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] hover:shadow-[12px_0_36px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* Brand Logo Header */}
        <div className="w-[88px] flex justify-center shrink-0 mb-8">
          <button
            type="button"
            onClick={() => setTab('home')}
            aria-label="Pingo TV Home"
            className="group/logo flex items-center justify-center cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand text-on-brand shadow-[0_4px_16px_rgba(67,85,249,0.4)]">
              <Tv className="size-5" />
            </div>
          </button>
        </div>

        {/* Sidebar Navigation Items */}
        <nav aria-label="Primary TV Navigation" className="w-full flex flex-col items-start gap-1 px-3">
          {navItems.map((item) => {
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  'w-full flex items-center gap-4 rounded-xl px-3.5 py-3 text-left transition-all duration-200 group/btn cursor-pointer whitespace-nowrap overflow-hidden',
                  isActive
                    ? 'bg-white/10 text-white font-semibold'
                    : 'text-[#8f98b2] hover:bg-white/5 hover:text-white',
                )}
              >
                <span
                  className={cn(
                    'shrink-0 transition-colors',
                    isActive ? 'text-brand' : 'group-hover/btn:text-white',
                  )}
                >
                  {item.icon}
                </span>
                <span
                  className={cn(
                    'text-sm font-medium tracking-wide transition-all duration-200 opacity-0 group-hover/sidebar:opacity-100 -translate-x-2 group-hover/sidebar:translate-x-0',
                    isActive ? 'text-white font-semibold' : 'text-[#8f98b2] group-hover/btn:text-white',
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ─── Main Content Container ────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-y-auto md:pl-[88px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Mobile Header (Hidden on Desktop) */}
        <header className="sticky top-0 z-40 flex md:hidden items-center justify-between border-b border-line bg-page/90 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 backdrop-blur-md">
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

        {/* Mobile Category Navigation Tabs (Hidden on Desktop) */}
        <div className="sticky top-[calc(2.75rem+max(0.75rem,env(safe-area-inset-top)))] z-30 flex md:hidden border-b border-line/60 bg-page/80 backdrop-blur-sm">
          <TvNavigationTabs
            currentTab={tab}
            onTabChange={setTab}
            watchlistCount={watchlist.length}
          />
        </div>

        {/* Dynamic Content Views */}
        <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
          {loading ? (
            <div className="flex h-96 flex-col items-center justify-center gap-3 text-text-secondary">
              <Loader2 className="size-8 animate-spin text-brand" />
              <span className="text-sm font-medium">Curating Pingo TV titles...</span>
            </div>
          ) : (
            <>
              {/* 1. HOME / FEATURED VIEW (All 9 Rails from e:\pingo tv\server.js) */}
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
                      icon={<Bookmark className="size-5" />}
                      items={watchlistAsMedia}
                      onSelect={(m) => setSelectedMedia(m)}
                    />
                  )}

                  {/* 1. Trending on Pingo */}
                  <TvMediaRail
                    title="Trending on Pingo"
                    icon={<Flame className="size-5" />}
                    items={trending}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 2. Top 10 in India Today - Hindi (JioHotstar Signature Outlined Rank Numeral) */}
                  <TvMediaRail
                    title="Top 10 in India Today - Hindi"
                    sub="The most-watched Hindi movies and series right now"
                    icon={<TrendingUp className="size-5" />}
                    items={top10Hindi}
                    isTop10={true}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 3. Latest Releases Just for You */}
                  <TvMediaRail
                    title="Latest Releases Just for You"
                    icon={<Clapperboard className="size-5" />}
                    items={nowPlaying}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 4. Latest Episodes & Dubs */}
                  <TvMediaRail
                    title="Latest Episodes & Dubs"
                    sub="Fresh drops, Hindi audio & multi-language dubs"
                    icon={<Tv className="size-5" />}
                    items={latestEpisodes}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 5. Action & Thrillers */}
                  <TvMediaRail
                    title="Action & Thrillers"
                    icon={<Flame className="size-5" />}
                    items={actionMovies}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 6. Comedy Carnival */}
                  <TvMediaRail
                    title="Comedy Carnival"
                    icon={<Laugh className="size-5" />}
                    items={comedyMovies}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 7. Blockbuster Cinema */}
                  <TvMediaRail
                    title="Blockbuster Cinema"
                    icon={<Film className="size-5" />}
                    items={blockbusters}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 8. Anime & Asian Dramas */}
                  <TvMediaRail
                    title="Anime & Asian Dramas"
                    sub="Top anime simulcasts, shonen & romance"
                    icon={<Sparkles className="size-5" />}
                    items={animeShows}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 9. Edge-of-the-Seat Horror */}
                  <TvMediaRail
                    title="Edge-of-the-Seat Horror"
                    icon={<Skull className="size-5" />}
                    items={horrorMovies}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  {/* 10. Top Rated on IMDb */}
                  <TvMediaRail
                    title="Top Rated on IMDb"
                    icon={<Star className="size-5" />}
                    items={topRated}
                    onSelect={(m) => setSelectedMedia(m)}
                  />
                </>
              )}

              {/* 2. MOVIES VIEW */}
              {tab === 'movies' && (
                <>
                  <TvHeroBanner
                    items={blockbusters}
                    onPlayStream={(media) => setStreamingTarget({ media, season: 1, episode: 1 })}
                    onPlayTrailer={(media) => setTrailerMedia(media)}
                    onOpenDetails={(media) => setSelectedMedia(media)}
                  />

                  <TvMediaRail
                    title="Top 10 in India Today - Hindi"
                    icon={<TrendingUp className="size-5" />}
                    items={top10Hindi}
                    isTop10={true}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  <TvMediaRail
                    title="Now In Theatres & Streaming"
                    icon={<Clapperboard className="size-5" />}
                    items={nowPlaying}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  <TvMediaRail
                    title="Blockbuster Cinema"
                    icon={<Film className="size-5" />}
                    items={blockbusters}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  <TvMediaRail
                    title="Critically Acclaimed Cinema"
                    icon={<Star className="size-5" />}
                    items={topRated}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  <TvMediaRail
                    title="Action & Thrillers"
                    icon={<Flame className="size-5" />}
                    items={actionMovies}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  <TvMediaRail
                    title="Comedy Carnival"
                    icon={<Laugh className="size-5" />}
                    items={comedyMovies}
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
                    title="Latest Episodes & Dubs"
                    icon={<Tv className="size-5" />}
                    items={latestEpisodes}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  <TvMediaRail
                    title="Trending TV Series"
                    icon={<Flame className="size-5" />}
                    items={popularShows}
                    onSelect={(m) => setSelectedMedia(m)}
                  />

                  <TvMediaRail
                    title="Anime & Asian Series"
                    icon={<Sparkles className="size-5" />}
                    items={animeShows}
                    onSelect={(m) => setSelectedMedia(m)}
                  />
                </>
              )}

              {/* 4. SEARCH & DISCOVER VIEW */}
              {tab === 'search' && (
                <TvSearch onSelect={(media) => setSelectedMedia(media)} />
              )}

              {/* 5. WATCHLIST VIEW (My Space) */}
              {tab === 'watchlist' && (
                <div className="px-4 pt-4 sm:px-8">
                  <div className="mb-6 flex items-center justify-between border-b border-line pb-4">
                    <div>
                      <h2 className="text-xl font-bold text-ink sm:text-2xl">My Watchlist</h2>
                      <p className="mt-1 text-xs text-text-secondary">
                        Saved movies and series on Pingo TV
                      </p>
                    </div>
                    <span className="rounded-full bg-sunken px-3 py-1 text-xs font-semibold text-text-secondary">
                      {watchlist.length} titles
                    </span>
                  </div>

                  {watchlist.length === 0 ? (
                    <div className="flex h-72 flex-col items-center justify-center gap-2 text-center text-text-secondary">
                      <Bookmark className="size-12 text-text-secondary/40" />
                      <p className="text-base font-semibold text-ink">Your watchlist is empty</p>
                      <p className="max-w-xs text-xs">
                        Bookmark movies and TV series you want to watch later and access them anytime.
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab('home')}
                        className="mt-4 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-on-brand shadow-sm transition-transform active:scale-95"
                      >
                        Explore Featured
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
      </div>

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
