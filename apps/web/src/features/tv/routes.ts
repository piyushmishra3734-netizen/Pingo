import { useEffect, useState } from 'react';
import { fetchDetails } from './api/tmdb.js';
import type { MediaType, TmdbMedia, TmdbMediaDetails, TvTab } from './types.js';

/**
 * Every Pingo TV screen is a real page with its own history entry, so Back
 * steps out one screen at a time (player, then title, then the list you came
 * from) instead of leaving Pingo TV in one go.
 *
 *   /tv                      Home
 *   /tv/movies  /tv/shows    the same, filtered
 *   /tv/search  /tv/list     Search and My List
 *   /tv/title/:type/:id      a title's page
 *   /tv/watch/:type/:id      the player (?s=season&e=episode)
 *   /tv/trailer/:type/:id    its trailer
 */

export const TAB_PATH: Record<TvTab, string> = {
  home: '/tv',
  movies: '/tv/movies',
  shows: '/tv/shows',
  search: '/tv/search',
  watchlist: '/tv/list',
};

export type TvRoute =
  | { kind: 'tab'; tab: TvTab }
  | { kind: 'title' | 'trailer'; type: MediaType; id: string }
  | { kind: 'watch'; type: MediaType; id: string; season: number; episode: number };

/** What a navigation carries along, so a title opens instantly and Back lands on the tab it came from. */
export interface TvNavState {
  media?: TmdbMedia;
  tab?: TvTab;
}

const typeOf = (m: TmdbMedia): MediaType => m.media_type || (m.title ? 'movie' : 'tv');

export const titlePath = (m: TmdbMedia) => `/tv/title/${typeOf(m)}/${m.id}`;
export const trailerPath = (m: TmdbMedia) => `/tv/trailer/${typeOf(m)}/${m.id}`;
export const watchPath = (m: TmdbMedia, season = 1, episode = 1) => `/tv/watch/${typeOf(m)}/${m.id}?s=${season}&e=${episode}`;

export function parseTvPath(pathname: string, search: string): TvRoute {
  const parts = pathname.replace(/^\/tv\/?/, '').split('/').filter(Boolean);
  const [head, type, id] = parts;
  if ((head === 'title' || head === 'watch' || head === 'trailer') && (type === 'movie' || type === 'tv') && id) {
    if (head === 'watch') {
      const q = new URLSearchParams(search);
      return { kind: 'watch', type, id, season: Math.max(1, Number(q.get('s')) || 1), episode: Math.max(1, Number(q.get('e')) || 1) };
    }
    return { kind: head, type, id };
  }
  const tab = (Object.keys(TAB_PATH) as TvTab[]).find((t) => TAB_PATH[t] === `/tv${head ? `/${head}` : ''}`);
  return { kind: 'tab', tab: tab ?? 'home' };
}

function fromDetails(type: MediaType, d: TmdbMediaDetails): TmdbMedia {
  return {
    id: d.id,
    ...(d.title ? { title: d.title } : {}),
    ...(d.name ? { name: d.name } : {}),
    overview: d.overview,
    poster_path: d.poster_path,
    backdrop_path: d.backdrop_path,
    vote_average: d.vote_average,
    ...(d.release_date ? { release_date: d.release_date } : {}),
    ...(d.first_air_date ? { first_air_date: d.first_air_date } : {}),
    genre_ids: d.genres.map((g) => g.id),
    media_type: type,
  };
}

/**
 * The title a title, player or trailer page is about. It arrives with the
 * navigation when the person tapped a poster; on a reload or a shared link
 * only the id is known, so it is fetched.
 */
export function useRouteMedia(route: TvRoute, carried: TmdbMedia | undefined): TmdbMedia | null {
  const id = route.kind === 'tab' ? null : route.id;
  const type = route.kind === 'tab' ? null : route.type;
  const known = carried && id !== null && String(carried.id) === id ? carried : null;
  const [fetched, setFetched] = useState<TmdbMedia | null>(null);

  useEffect(() => {
    setFetched(null);
    if (id === null || type === null || known) return;
    let live = true;
    void fetchDetails(type, id).then((d) => {
      if (live && d) setFetched(fromDetails(type, d));
    });
    return () => {
      live = false;
    };
  }, [id, type, known]);

  return known ?? fetched;
}
