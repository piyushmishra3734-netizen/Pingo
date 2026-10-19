import React, { Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bookmark, Loader2, Search, X } from 'lucide-react';
import { Toggle, cn } from '@pingo/ui';
import type { TmdbMedia, TvTab } from './types.js';
import { TAB_PATH, parseTvPath, titlePath, trailerPath, useRouteMedia, watchPath, type TvNavState } from './routes.js';
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
import { setMyWatching, setShareWatching, smallPoster, useShareWatching, useWatching, watchingPath } from './watching.js';
import { TvLogo } from './components/TvLogo.js';
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
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseTvPath(location.pathname, location.search);
  const carried = (location.state ?? {}) as TvNavState;
  // Title, player and trailer pages sit over the tab they were opened from.
  const tab: TvTab = route.kind === 'tab' ? route.tab : (carried.tab ?? 'home');
  const setTab = (t: TvTab) => {
    if (t !== tab || route.kind !== 'tab') navigate(TAB_PATH[t]);
  };
  const overlayMedia = useRouteMedia(route, carried.media);

  /*
   * Watching, said to friends (see watching.ts): the title and episode while the
   * player is open, nothing otherwise. The episode is the player's own, so it
   * tells us when it changes.
   */
  const alongId = route.kind === 'watch' ? (new URLSearchParams(location.search).get('along') ?? undefined) : undefined;
  const alongName = (location.state as { along?: string } | null)?.along;
  const [episodeNow, setEpisodeNow] = useState<{ s: number; e: number } | null>(null);
  const shareWatching = useShareWatching();
  const watchKey = route.kind === 'watch' ? `${route.type}-${route.id}-${route.season}-${route.episode}` : '';
  useEffect(() => setEpisodeNow(null), [watchKey]);
  useEffect(() => {
    if (route.kind !== 'watch' || !overlayMedia) {
      setMyWatching(undefined);
      return;
    }
    const title = overlayMedia.title || overlayMedia.name || '';
    const poster = smallPoster(overlayMedia.poster_path);
    setMyWatching({
      n: title.slice(0, 120),
      y: route.type,
      id: overlayMedia.id,
      ...(poster ? { i: poster } : {}),
      ...(route.type === 'tv' ? { s: episodeNow?.s ?? route.season, e: episodeNow?.e ?? route.episode } : {}),
      ...(alongId ? { w: alongId } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, overlayMedia?.id, episodeNow?.s, episodeNow?.e, alongId]);
  useEffect(() => () => setMyWatching(undefined), []);

  // Watching along: when the friend moves to another title or episode, this follows.
  const along = useWatching(alongId);
  useEffect(() => {
    if (!alongId || !along || route.kind !== 'watch') return;
    const same = along.id === Number(route.id) && along.y === route.type && (along.y === 'movie' || ((along.s ?? 1) === (episodeNow?.s ?? route.season) && (along.e ?? 1) === (episodeNow?.e ?? route.episode)));
    if (!same) navigate(watchingPath(along, alongId), { replace: true, state: { tab, along: alongName } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [along]);
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

  const tabs: Array<{ id: TvTab; label: string }> = [
    { id: 'home', label: 'Home' },
    { id: 'shows', label: 'Shows' },
    { id: 'movies', label: 'Movies' },
    { id: 'watchlist', label: 'My List' },
  ];

  const state = (m: TmdbMedia): { state: TvNavState } => ({ state: { media: m, tab } });
  const open = (m: TmdbMedia) => navigate(titlePath(m), state(m));
  const play = (m: TmdbMedia, season = 1, episode = 1) => navigate(watchPath(m, season, episode), state(m));
  const trailer = (m: TmdbMedia) => navigate(trailerPath(m), state(m));
  // Back goes to the page before when there is one inside the app; a link opened cold goes to the tab.
  const goBack = () => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate(TAB_PATH[tab], { replace: true });
  };
  const hero = (items: TmdbMedia[]) => (
    <TvHeroBanner items={items} onPlayStream={play} onPlayTrailer={trailer} onOpenDetails={open} paused={route.kind !== 'tab'} />
  );
  const rail = (title: string, items: TmdbMedia[], extra?: { sub?: string; isTop10?: boolean }) => (
    <TvMediaRail title={title} items={items} onSelect={open} {...extra} />
  );

  // The bar floats over the hero, and turns solid once the page has moved under it.
  const [scrolled, setScrolled] = useState(false);

  return (
    <div className="tv-theme relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => {
          const past = e.currentTarget.scrollTop > 24;
          setScrolled((was) => (was === past ? was : past));
        }}
      >
        <header
          className={cn(
            'sticky top-0 z-40 -mb-[var(--tv-bar)] transition-colors duration-300 [--tv-bar:theme(spacing.28)] md:[--tv-bar:68px]',
            scrolled ? 'bg-page/95 backdrop-blur-xl' : 'bg-gradient-to-b from-black/55 to-transparent',
          )}
        >
          <div className="flex items-center gap-4 px-4 pt-[max(0.6rem,env(safe-area-inset-top))] md:h-[68px] md:gap-8 md:px-10 md:pt-0">
            <TvLogo />
            <nav aria-label="Pingo TV" className="hidden items-center gap-1 md:flex">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'px-3 py-2 text-sm transition-colors',
                    tab === t.id ? 'font-bold text-white' : 'font-medium text-white/70 hover:text-white/95',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label="Search"
                onClick={() => setTab('search')}
                className={cn('grid size-10 place-items-center rounded-full transition-colors hover:bg-white/10', tab === 'search' ? 'text-white' : 'text-white/85')}
              >
                <Search className="size-[22px]" />
              </button>
              <button
                type="button"
                aria-label="My List"
                onClick={() => setTab('watchlist')}
                className="relative grid size-10 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/10 md:hidden"
              >
                <Bookmark className="size-[22px]" />
                {watchlist.length > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-black/40" />}
              </button>
            </div>
          </div>
          <nav aria-label="Pingo TV" className="flex items-center gap-2 overflow-x-auto px-4 pb-3 pt-1 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  tab === t.id ? 'border-white bg-white text-black' : 'border-white/40 text-white',
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="pb-10">
          {loading ? (
            <TvSkeleton />
          ) : (
            <>
              {tab === 'home' && (
                <>
                  {hero(trending)}
                  <div className="relative z-10 -mt-6 md:-mt-10">
                    {watchlistAsMedia.length > 0 && rail('My List', watchlistAsMedia)}
                    {rail('Trending on Pingo', trending)}
                    {rail('Top 10 in India Today', top10Hindi, { sub: 'Most watched Hindi movies and series right now', isTop10: true })}
                    {rail('Latest Releases', nowPlaying)}
                    {rail('Latest Episodes and Dubs', latestEpisodes, { sub: 'Fresh drops with Hindi audio and multi-language dubs' })}
                    {rail('Action and Thrillers', actionMovies)}
                    {rail('Comedy Carnival', comedyMovies)}
                    {rail('Blockbuster Cinema', blockbusters)}
                    {rail('Anime and Asian Dramas', animeShows)}
                    {rail('Edge of the Seat Horror', horrorMovies)}
                    {rail('Top Rated on IMDb', topRated)}
                  </div>
                </>
              )}

              {tab === 'movies' && (
                <>
                  {hero(blockbusters)}
                  <div className="relative z-10 -mt-6 md:-mt-10">
                    {rail('Top 10 Movies in India', top10Hindi, { isTop10: true })}
                    {rail('Now in Theatres and Streaming', nowPlaying)}
                    {rail('Blockbuster Cinema', blockbusters)}
                    {rail('Critically Acclaimed', topRated)}
                    {rail('Action and Thrillers', actionMovies)}
                    {rail('Comedy Carnival', comedyMovies)}
                    {rail('Edge of the Seat Horror', horrorMovies)}
                  </div>
                </>
              )}

              {tab === 'shows' && (
                <>
                  {hero(popularShows)}
                  <div className="relative z-10 -mt-6 md:-mt-10">
                    {rail('Latest Episodes and Dubs', latestEpisodes)}
                    {rail('Trending Series', popularShows)}
                    {rail('Anime and Asian Series', animeShows)}
                  </div>
                </>
              )}

              {tab === 'search' && (
                <div className="pt-24 md:pt-20">
                  <TvSearch onSelect={open} />
                </div>
              )}

              {tab === 'watchlist' && (
                <div className="px-4 pt-28 md:px-10 md:pt-24">
                  <div className="mb-5 flex items-end justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-ink">My List</h2>
                      <p className="mt-1 text-sm text-text-secondary">Titles you saved to watch later</p>
                    </div>
                    <span className="text-sm font-semibold text-text-secondary">{watchlist.length} saved</span>
                  </div>

                  <div className="mb-5 flex items-center gap-3 rounded-lg bg-white/[0.06] px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <b id="tv-share-watching" className="block text-[15px] font-semibold">Show what I'm watching</b>
                      <small className="block text-[12.5px] text-text-secondary">Friends see it on your photo and can watch along. Off when your activity status is off.</small>
                    </span>
                    <Toggle checked={shareWatching} onChange={setShareWatching} labelledBy="tv-share-watching" size="sm" />
                  </div>

                  {watchlist.length === 0 ? (
                    <div className="flex min-h-[50svh] flex-col items-center justify-center gap-3 text-center">
                      <span className="grid size-16 place-items-center rounded-full bg-white/8 text-text-secondary">
                        <Bookmark className="size-7" />
                      </span>
                      <p className="text-lg font-semibold text-ink">Nothing saved yet</p>
                      <p className="max-w-xs text-sm text-text-secondary">Tap the plus on any title and it waits for you here.</p>
                      <button type="button" onClick={() => setTab('home')} className="mt-2 h-11 rounded-md bg-white px-6 text-sm font-bold text-black transition active:scale-95">
                        Browse titles
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-4 md:grid-cols-5 md:gap-x-3.5 lg:grid-cols-6 xl:grid-cols-7">
                      {watchlistAsMedia.map((m) => (
                        <TvMediaCard key={`${m.media_type || 'm'}-${m.id}`} media={m} onSelect={open} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <TmdbAttribution />
            </>
          )}
        </main>
      </div>

      {route.kind !== 'tab' && !overlayMedia && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/85">
          <Loader2 className="size-8 animate-spin text-white/80" />
        </div>
      )}

      {route.kind === 'title' && overlayMedia && (
        <TvMediaDetailsModal
          key={overlayMedia.id}
          media={overlayMedia}
          onClose={goBack}
          onPlayStream={(m, season = 1, episode = 1) => play(m, season, episode)}
          onPlayTrailer={trailer}
          onSelectMedia={open}
        />
      )}

      {route.kind === 'watch' && overlayMedia && (
        <Suspense fallback={<div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/90"><Loader2 className="size-8 animate-spin text-white/80" /></div>}>
          <TvStreamPlayer
            key={watchKey}
            media={overlayMedia}
            initialSeason={route.season}
            initialEpisode={route.episode}
            onEpisodeChange={(s, e) => setEpisodeNow((was) => (was && was.s === s && was.e === e ? was : { s, e }))}
            onClose={goBack}
            onOpenTrailer={(m) => navigate(trailerPath(m), { replace: true, ...state(m) })}
          />
        </Suspense>
      )}

      {route.kind === 'watch' && overlayMedia && alongId && (
        <div className="fixed inset-x-0 top-0 z-[240] flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div role="status" className="flex max-w-full items-center gap-2 rounded-full bg-black/80 py-1.5 pl-4 pr-1.5 text-[13px] font-medium text-white backdrop-blur-md">
            <span className="truncate">Watching along with {alongName ?? 'a friend'}. Press play together.</span>
            <button
              type="button"
              aria-label="Stop watching along"
              onClick={() => navigate(watchPath(overlayMedia, route.season, route.episode), { replace: true, state: { media: overlayMedia, tab } })}
              className="grid size-7 shrink-0 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {route.kind === 'trailer' && overlayMedia && (
        <Suspense fallback={<div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80"><Loader2 className="size-8 animate-spin text-white/80" /></div>}>
          <TvTrailerPlayer media={overlayMedia} onClose={goBack} />
        </Suspense>
      )}
    </div>
  );
}


/** What the page looks like while it loads: the shape of the hero and two rails, not a spinner. */
function TvSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Pingo TV">
      <div className="h-[min(78svh,640px)] min-h-[460px] w-full animate-pulse bg-gradient-to-b from-white/[0.06] to-transparent md:h-[min(72svh,720px)]" />
      {[0, 1].map((r) => (
        <div key={r} className="mt-7 px-4 md:px-10">
          <div className="mb-3 h-5 w-44 animate-pulse rounded bg-white/10" />
          <div className="flex gap-2.5 overflow-hidden md:gap-3.5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="aspect-[2/3] w-[108px] shrink-0 animate-pulse rounded-[10px] bg-white/[0.07] md:w-[150px]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default PingoTv;
