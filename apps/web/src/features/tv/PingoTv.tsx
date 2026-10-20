import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bookmark, History, Loader2, Search, Trash2, X } from 'lucide-react';
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
import { closeMini, currentMini, openMini } from './mini-player.js';
import { clearWatched, recordWatched, removeWatched, useWatchHistory, watchedAsMedia, type WatchedItem } from './hooks/useWatchHistory.js';
import { TvLandscapeCard } from './components/TvLandscapeCard.js';
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
  // The server the film is playing from, told to friends so they can open the same one.
  const [sourceNow, setSourceNow] = useState<string | undefined>(undefined);
  const shareWatching = useShareWatching();
  const watchKey = route.kind === 'watch' ? `${route.type}-${route.id}-${route.season}-${route.episode}` : '';
  useEffect(() => setEpisodeNow(null), [watchKey]);
  useEffect(() => {
    if (route.kind !== 'watch' || !overlayMedia) {
      // The mini player may be the one saying it.
      if (!currentMini()) setMyWatching(undefined);
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
      ...(sourceNow ? { p: sourceNow } : {}),
      ...(alongId ? { w: alongId } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, overlayMedia?.id, episodeNow?.s, episodeNow?.e, alongId, sourceNow]);
  useEffect(
    () => () => {
      if (!currentMini()) setMyWatching(undefined);
    },
    [],
  );
  // The full page takes over from the mini player.
  useEffect(() => {
    if (route.kind === 'watch') closeMini();
  }, [route.kind]);

  // ...and when they switch server, so does this (once per change, so a server this phone cannot use does not loop).
  const followedSource = useRef<string | undefined>(undefined);
  const alongNow = useWatching(alongId);
  useEffect(() => {
    if (!alongId || !alongNow?.p || route.kind !== 'watch') return;
    if (followedSource.current === alongNow.p) return;
    followedSource.current = alongNow.p;
    if (alongNow.p !== (sourceNow ?? route.src)) navigate(watchingPath(alongNow, alongId), { replace: true, state: { tab, along: alongName } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alongNow?.p]);

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

  // Anime and Kids load when first opened, so Home does not wait on them.
  const [animeMovies, setAnimeMovies] = useState<TmdbMedia[]>([]);
  const [kidsMovies, setKidsMovies] = useState<TmdbMedia[]>([]);
  const [kidsShows, setKidsShows] = useState<TmdbMedia[]>([]);
  useEffect(() => {
    let live = true;
    if (tab === 'anime' && animeMovies.length === 0) void fetchByGenre('movie', 16).then((r) => live && setAnimeMovies(r));
    if (tab === 'kids' && kidsMovies.length === 0) {
      void fetchByGenre('movie', 10751).then((r) => live && setKidsMovies(r));
      void fetchByGenre('tv', 10762).then((r) => live && setKidsShows(r));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const history = useWatchHistory();
  const [listTab, setListTab] = useState<'watchlist' | 'history'>('watchlist');
  // Remembered as watched while a player page is open (the episode as it changes).
  useEffect(() => {
    if (route.kind !== 'watch' || !overlayMedia) return;
    recordWatched(overlayMedia, route.type, episodeNow?.s ?? route.season, episodeNow?.e ?? route.episode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, overlayMedia?.id, episodeNow?.s, episodeNow?.e]);

  const tabs: Array<{ id: TvTab; label: string }> = [
    { id: 'home', label: 'Home' },
    { id: 'movies', label: 'Movies' },
    { id: 'shows', label: 'Series' },
    { id: 'anime', label: 'Anime' },
    { id: 'kids', label: 'Kids' },
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
  const rail = (title: string, items: TmdbMedia[], extra?: { sub?: string; isTop10?: boolean; landscape?: boolean }) => (
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
                    tab === t.id ? 'border-b-2 border-brand font-bold text-brand' : 'border-b-2 border-transparent font-medium text-white/70 hover:text-white/95',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTab('search')}
                className="hidden h-10 w-[min(32vw,380px)] items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.07] px-4 text-left text-sm text-white/55 transition hover:bg-white/10 lg:flex"
              >
                <Search className="size-[18px] shrink-0" />
                <span className="truncate">Search movies, series, anime...</span>
              </button>
              <button
                type="button"
                aria-label="Search"
                onClick={() => setTab('search')}
                className={cn('grid size-10 place-items-center rounded-full transition-colors hover:bg-white/10 lg:hidden', tab === 'search' ? 'text-white' : 'text-white/85')}
              >
                <Search className="size-[22px]" />
              </button>
              <button
                type="button"
                onClick={() => setTab('watchlist')}
                className={cn('relative hidden h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition hover:bg-white/10 md:flex', tab === 'watchlist' ? 'text-white' : 'text-white/75')}
              >
                <Bookmark className="size-[18px]" /> Watchlist
                {watchlist.length > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold leading-[18px] text-white">{watchlist.length}</span>}
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
                    <div className="min-w-0">
                      {history.length > 0 &&
                        (
                          <TvMediaRail
                            title="Continue Watching"
                            items={history.map(watchedAsMedia)}
                            onSelect={(m) => {
                              const w = history.find((h) => h.id === m.id);
                              play(m, w?.s ?? 1, w?.e ?? 1);
                            }}
                            landscape
                            playMark
                            caption={(m) => {
                              const w = history.find((h) => h.id === m.id);
                              return w?.type === 'tv' ? `S${w.s ?? 1} E${w.e ?? 1}` : 'Movie';
                            }}
                          />
                        )}
                      {rail('Trending Now', trending, { landscape: true })}
                      {rail('Top 10 in India', top10Hindi, { sub: 'Most watched Hindi movies and series right now', isTop10: true })}
                      {rail('Latest Episodes and Dubs', latestEpisodes, { sub: 'Fresh drops with Hindi audio and multi-language dubs', landscape: true })}
                      {rail('Latest Releases', nowPlaying)}
                      {rail('Action and Thrillers', actionMovies)}
                      {rail('Comedy Carnival', comedyMovies)}
                      {rail('Blockbuster Cinema', blockbusters)}
                      {rail('Anime and Asian Dramas', animeShows)}
                      {rail('Edge of the Seat Horror', horrorMovies)}
                      {rail('Top Rated on IMDb', topRated)}
                    </div>
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

              {tab === 'anime' && (
                <>
                  {hero(animeShows)}
                  <div className="relative z-10 -mt-6 md:-mt-10">
                    {rail('Trending Anime', animeShows, { landscape: true })}
                    {rail('Anime Movies', animeMovies)}
                  </div>
                </>
              )}

              {tab === 'kids' && (
                <>
                  {hero(kidsMovies.length ? kidsMovies : animeShows)}
                  <div className="relative z-10 -mt-6 md:-mt-10">
                    {rail('Family Movies', kidsMovies)}
                    {rail('Kids Shows', kidsShows, { landscape: true })}
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
                  <div className="mb-5 flex items-center gap-1 border-b border-white/10">
                    {(['watchlist', 'history'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setListTab(t)}
                        className={cn('-mb-px border-b-2 px-4 py-3 text-[15px] transition-colors', listTab === t ? 'border-brand font-bold text-brand' : 'border-transparent font-medium text-white/65 hover:text-white')}
                      >
                        {t === 'watchlist' ? `Watchlist${watchlist.length ? ` (${watchlist.length})` : ''}` : 'History'}
                      </button>
                    ))}
                  </div>

                  {listTab === 'watchlist' && (
                    <>
                      <div className="mb-5 flex items-center gap-3 rounded-lg bg-white/[0.06] px-4 py-3">
                        <span className="min-w-0 flex-1">
                          <b id="tv-share-watching" className="block text-[15px] font-semibold">Show what I'm watching</b>
                          <small className="block text-[12.5px] text-text-secondary">Friends see it on your photo and can watch along. Off when your activity status is off.</small>
                        </span>
                        <Toggle checked={shareWatching} onChange={setShareWatching} labelledBy="tv-share-watching" size="sm" />
                      </div>

                      {watchlist.length === 0 ? (
                        <TvEmpty icon={<Bookmark className="size-7" />} title="Nothing saved yet" body="Tap the plus on any title and it waits for you here." action="Browse titles" onAction={() => setTab('home')} />
                      ) : (
                        <div className="grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-4 md:grid-cols-5 md:gap-x-3.5 lg:grid-cols-6 xl:grid-cols-7">
                          {watchlistAsMedia.map((m) => (
                            <TvMediaCard key={`${m.media_type || 'm'}-${m.id}`} media={m} onSelect={open} />
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {listTab === 'history' &&
                    (history.length === 0 ? (
                      <TvEmpty icon={<History className="size-7" />} title="No history yet" body="What you watch shows up here, with the episode you were on." action="Browse titles" onAction={() => setTab('home')} />
                    ) : (
                      <>
                        <div className="mb-4 flex justify-end">
                          <button type="button" onClick={clearWatched} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white">
                            <Trash2 className="size-4" /> Clear history
                          </button>
                        </div>
                        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {history.map((w) => (
                            <HistoryCard key={`${w.type}-${w.id}`} item={w} onPlay={() => play(watchedAsMedia(w), w.s ?? 1, w.e ?? 1)} />
                          ))}
                        </div>
                      </>
                    ))}
                </div>
              )}

              <TmdbAttribution />
            </>
          )}
        </main>
      </div>

      {route.kind !== 'tab' && !overlayMedia && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/85">
          <TvLogo className="animate-pulse" />
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
        <Suspense fallback={<div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/90"><TvLogo className="animate-pulse" /></div>}>
          <TvStreamPlayer
            key={watchKey}
            media={overlayMedia}
            initialSeason={route.season}
            initialEpisode={route.episode}
            onOpenMedia={open}
            {...(alongId ? { alongId } : {})}
            initialSource={route.src}
            onSourceChange={setSourceNow}
            onMinimize={(s, e) => {
              openMini({ media: overlayMedia, season: s, episode: e, ...(sourceNow ? { source: sourceNow } : {}), ...(smallPoster(overlayMedia.poster_path) ? { poster: smallPoster(overlayMedia.poster_path) as string } : {}), ...(alongId ? { along: { id: alongId, name: alongName ?? 'a friend' } } : {}) });
              goBack();
            }}
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
        <Suspense fallback={<div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80"><TvLogo className="animate-pulse" /></div>}>
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
      <div className="flex justify-center pt-28 md:hidden">
        <TvLogo className="animate-pulse" />
      </div>
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

function TvEmpty({ icon, title, body, action, onAction }: { icon: React.ReactNode; title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="flex min-h-[44svh] flex-col items-center justify-center gap-3 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-white/8 text-text-secondary">{icon}</span>
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="max-w-xs text-sm text-text-secondary">{body}</p>
      <button type="button" onClick={onAction} className="mt-2 h-11 rounded-md bg-brand px-6 text-sm font-bold text-white transition active:scale-95">
        {action}
      </button>
    </div>
  );
}

/** A title you watched: the scene, where you were, and a way to take it off the list. */
function HistoryCard({ item, onPlay }: { item: WatchedItem; onPlay: () => void }) {
  return (
    <div className="group relative">
      <TvLandscapeCard media={watchedAsMedia(item)} onSelect={onPlay} play caption={item.type === 'tv' ? `S${item.s ?? 1} E${item.e ?? 1}` : 'Movie'} />
      <button
        type="button"
        aria-label={`Remove ${item.title} from history`}
        onClick={() => removeWatched(item.id, item.type)}
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/80 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}


export default PingoTv;
