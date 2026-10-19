import type { MediaType, TmdbMedia, TmdbMediaDetails, TmdbResponse, TmdbVideo } from '../types.js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const memoryCache = new Map<string, { timestamp: number; data: unknown }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour memory cache

export function getTmdbPosterUrl(path: string | null | undefined, size: 'w185' | 'w342' | 'w500' = 'w342'): string {
  if (!path) return '';
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function getTmdbBackdropUrl(path: string | null | undefined, size: 'w780' | 'w1280' = 'w780'): string {
  if (!path) return '';
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

async function callProxy<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T | null> {
  const query = new URLSearchParams();
  query.set('endpoint', endpoint);
  for (const [key, val] of Object.entries(params)) {
    query.set(key, String(val));
  }

  const cacheKey = `${endpoint}?${query.toString()}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data as T;
  }

  if (!SUPABASE_URL) {
    return null;
  }

  try {
    const proxyUrl = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/tmdb?${query.toString()}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (SUPABASE_ANON_KEY) {
      headers['apikey'] = SUPABASE_ANON_KEY;
      headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
    }

    const res = await fetch(proxyUrl, { headers });
    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as T;
    memoryCache.set(cacheKey, { timestamp: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

// Curated fallbacks for instant development and offline mode before proxy deployment
const FALLBACK_TRENDING: TmdbMedia[] = [
  {
    id: 1022789,
    title: 'Inside Out 2',
    overview: 'Teenager Riley\'s mind headquarters is undergoing a sudden demolition to make room for unexpected new Emotions: Anxiety, Envy, Ennui, and Embarrassment.',
    poster_path: '/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
    backdrop_path: '/xg27NrXi7VXCGUr7MG75UqLl6Vg.jpg',
    vote_average: 7.6,
    release_date: '2024-06-11',
    media_type: 'movie',
    genre_ids: [16, 10751, 18, 12, 35],
  },
  {
    id: 94605,
    name: 'Arcane',
    title: 'Arcane',
    overview: 'Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival sides of a war between magic technologies and incompatible convictions.',
    poster_path: '/fqldf2t8ztc9aiwn397rHg2yaHp.jpg',
    backdrop_path: '/uDgy6hyPd82kOHh6I95FLtLnj6p.jpg',
    vote_average: 8.7,
    first_air_date: '2021-11-06',
    media_type: 'tv',
    genre_ids: [16, 10765, 10759, 18],
  },
  {
    id: 533535,
    title: 'Deadpool & Wolverine',
    overview: 'A listless Wade Wilson toils away in civilian life with his days as the morally flexible mercenary, Deadpool, behind him. But when his homeworld faces an existential threat, he must suit up.',
    poster_path: '/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    backdrop_path: '/yDHYTfA3R0jFYba16jBB1jv8uqC.jpg',
    vote_average: 7.7,
    release_date: '2024-07-24',
    media_type: 'movie',
    genre_ids: [28, 35, 878],
  },
  {
    id: 1399,
    name: 'Game of Thrones',
    title: 'Game of Thrones',
    overview: 'Seven noble families fight for control of the mythical land of Westeros. Friction between the houses leads to full-scale war.',
    poster_path: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
    backdrop_path: '/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg',
    vote_average: 8.4,
    first_air_date: '2011-04-17',
    media_type: 'tv',
    genre_ids: [10765, 18, 10759],
  },
  {
    id: 693134,
    title: 'Dune: Part Two',
    overview: 'Follow the mythic journey of Paul Atreides as he unites with Chani and the Fremen while on a warpath of revenge against the conspirators who destroyed his family.',
    poster_path: '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    backdrop_path: '/xOMo8BRK7PfcJv9JCnx7s520Wio.jpg',
    vote_average: 8.2,
    release_date: '2024-02-27',
    media_type: 'movie',
    genre_ids: [878, 12],
  },
  {
    id: 93405,
    name: 'Squid Game',
    title: 'Squid Game',
    overview: 'Hundreds of cash-strapped players accept a strange invitation to compete in children\'s games. Inside, a tempting prize awaits with deadly high stakes.',
    poster_path: '/dDlGIPvun1iO5ASt0R13w857BwS.jpg',
    backdrop_path: '/2meX1nMdScFOoV4370rqHWFDxZ6.jpg',
    vote_average: 7.8,
    first_air_date: '2021-09-17',
    media_type: 'tv',
    genre_ids: [10759, 9648, 18],
  },
];

const FALLBACK_MOVIES: TmdbMedia[] = [
  {
    id: 157336,
    title: 'Interstellar',
    overview: 'The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel.',
    poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    backdrop_path: '/rAiYTsqJJR0dHVoHG0VfIb2uUQI.jpg',
    vote_average: 8.4,
    release_date: '2014-11-05',
    media_type: 'movie',
    genre_ids: [12, 18, 878],
  },
  {
    id: 27205,
    title: 'Inception',
    overview: 'Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets is offered a chance to regain his old life.',
    poster_path: '/ljsZTbVsrQSqZgWeep2B1QiDKuh.jpg',
    backdrop_path: '/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg',
    vote_average: 8.4,
    release_date: '2010-07-15',
    media_type: 'movie',
    genre_ids: [28, 878, 12],
  },
  {
    id: 155,
    title: 'The Dark Knight',
    overview: 'Batman raises the stakes in his war on crime. With the help of Lt. Jim Gordon and District Attorney Harvey Dent, Batman sets out to dismantle the remaining criminal organizations.',
    poster_path: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
    backdrop_path: '/o07ALFG5TfpD9oqGQ5HQUmPa9DC.jpg',
    vote_average: 8.5,
    release_date: '2008-07-16',
    media_type: 'movie',
    genre_ids: [18, 28, 80, 53],
  },
  {
    id: 19995,
    title: 'Avatar',
    overview: 'In the 22nd century, a paraplegic Marine is dispatched to the moon Pandora on a unique mission, but becomes torn between following orders and protecting an alien civilization.',
    poster_path: '/kyeqWdyUXW608qlYkRqosgbbJyK.jpg',
    backdrop_path: '/vL5LR6WdxWPjC3U146s5u886sC1.jpg',
    vote_average: 7.6,
    release_date: '2009-12-15',
    media_type: 'movie',
    genre_ids: [28, 12, 14, 878],
  },
];

const FALLBACK_SHOWS: TmdbMedia[] = [
  {
    id: 1396,
    name: 'Breaking Bad',
    title: 'Breaking Bad',
    overview: 'Walter White, a New Mexico chemistry teacher, is diagnosed with Stage III cancer and given a prognosis of two years left to live. He turns to a life of crime.',
    poster_path: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
    backdrop_path: '/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
    vote_average: 8.9,
    first_air_date: '2008-01-20',
    media_type: 'tv',
    genre_ids: [18, 80],
  },
  {
    id: 66732,
    name: 'Stranger Things',
    title: 'Stranger Things',
    overview: 'When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl.',
    poster_path: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
    backdrop_path: '/56v2KjBlU4XaOv9rVYEQypROD7P.jpg',
    vote_average: 8.6,
    first_air_date: '2016-07-15',
    media_type: 'tv',
    genre_ids: [10765, 9648, 18],
  },
  {
    id: 100088,
    name: 'The Last of Us',
    title: 'The Last of Us',
    overview: 'Twenty years after modern civilization has been destroyed, Joel, a hardened survivor, is hired to smuggle Ellie, a 14-year-old girl, out of an oppressive quarantine zone.',
    poster_path: '/uKvVjHNqB5VmOrdxqAt2V7JMrRI.jpg',
    backdrop_path: '/uDgy6hyPd82kOHh6I95FLtLnj6p.jpg',
    vote_average: 8.6,
    first_air_date: '2023-01-15',
    media_type: 'tv',
    genre_ids: [18, 10765, 10759],
  },
  {
    id: 85937,
    name: 'Demon Slayer: Kimetsu no Yaiba',
    title: 'Demon Slayer: Kimetsu no Yaiba',
    overview: 'It is the Taisho Period in Japan. Tanjiro, a kindhearted boy who sells charcoal for a living, finds his family slaughtered by a demon.',
    poster_path: '/xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg',
    backdrop_path: '/nTvM4mhqZlHIHG2X2tlSR28F79q.jpg',
    vote_average: 8.7,
    first_air_date: '2019-04-06',
    media_type: 'tv',
    genre_ids: [16, 10759, 10765],
  },
];

export async function fetchTrending(mediaType: 'all' | 'movie' | 'tv' = 'all', timeWindow: 'day' | 'week' = 'day'): Promise<TmdbMedia[]> {
  const resp = await callProxy<TmdbResponse>(`/trending/${mediaType}/${timeWindow}`);
  if (resp && Array.isArray(resp.results) && resp.results.length > 0) {
    return resp.results.map((item) => ({
      ...item,
      media_type: item.media_type || (item.title ? 'movie' : 'tv'),
    }));
  }
  return FALLBACK_TRENDING;
}

export async function fetchPopularMovies(page = 1): Promise<TmdbMedia[]> {
  const resp = await callProxy<TmdbResponse>('/movie/popular', { page });
  if (resp && Array.isArray(resp.results) && resp.results.length > 0) {
    return resp.results.map((m) => ({ ...m, media_type: 'movie' }));
  }
  return FALLBACK_MOVIES;
}

export async function fetchPopularTv(page = 1): Promise<TmdbMedia[]> {
  const resp = await callProxy<TmdbResponse>('/tv/popular', { page });
  if (resp && Array.isArray(resp.results) && resp.results.length > 0) {
    return resp.results.map((m) => ({ ...m, media_type: 'tv' }));
  }
  return FALLBACK_SHOWS;
}

export async function fetchTopRated(mediaType: MediaType = 'movie', page = 1): Promise<TmdbMedia[]> {
  const resp = await callProxy<TmdbResponse>(`/${mediaType}/top_rated`, { page });
  if (resp && Array.isArray(resp.results) && resp.results.length > 0) {
    return resp.results.map((m) => ({ ...m, media_type: mediaType }));
  }
  return mediaType === 'movie' ? FALLBACK_MOVIES : FALLBACK_SHOWS;
}

export async function fetchByGenre(mediaType: MediaType, genreId: number, page = 1): Promise<TmdbMedia[]> {
  const resp = await callProxy<TmdbResponse>(`/discover/${mediaType}`, {
    with_genres: genreId,
    sort_by: 'popularity.desc',
    page,
  });
  if (resp && Array.isArray(resp.results) && resp.results.length > 0) {
    return resp.results.map((m) => ({ ...m, media_type: mediaType }));
  }
  return mediaType === 'movie' ? FALLBACK_MOVIES : FALLBACK_SHOWS;
}

export async function searchMedia(query: string, page = 1): Promise<TmdbMedia[]> {
  if (!query.trim()) return [];
  const resp = await callProxy<TmdbResponse>('/search/multi', {
    query: query.trim(),
    page,
  });
  if (resp && Array.isArray(resp.results)) {
    return resp.results
      .filter((m) => (m.media_type === 'movie' || m.media_type === 'tv') && (m.poster_path || m.backdrop_path))
      .map((m) => ({
        ...m,
        media_type: m.media_type || (m.title ? 'movie' : 'tv'),
      }));
  }
  const q = query.toLowerCase();
  return [...FALLBACK_TRENDING, ...FALLBACK_MOVIES, ...FALLBACK_SHOWS].filter(
    (item) => (item.title || item.name || '').toLowerCase().includes(q),
  );
}

export async function fetchDetails(mediaType: MediaType, id: number | string): Promise<TmdbMediaDetails | null> {
  const details = await callProxy<TmdbMediaDetails>(`/${mediaType}/${id}`, {
    append_to_response: 'videos,credits,similar',
  });
  if (details) return details;

  // Search within fallbacks
  const numId = Number(id);
  const found = [...FALLBACK_TRENDING, ...FALLBACK_MOVIES, ...FALLBACK_SHOWS].find((m) => m.id === numId);
  if (found) {
    return {
      id: found.id,
      title: found.title,
      name: found.name,
      overview: found.overview,
      poster_path: found.poster_path,
      backdrop_path: found.backdrop_path,
      vote_average: found.vote_average,
      release_date: found.release_date,
      first_air_date: found.first_air_date,
      genres: [
        { id: 28, name: 'Action' },
        { id: 18, name: 'Drama' },
        { id: 878, name: 'Sci-Fi' },
      ],
      tagline: 'Experience the official streaming event on Pingo TV.',
      videos: {
        results: [
          {
            id: 'mock-trailer',
            key: 'dQw4w9WgXcQ',
            name: `${found.title || found.name} Official Trailer`,
            site: 'YouTube',
            size: 1080,
            type: 'Trailer',
            official: true,
          },
        ],
      },
      credits: {
        cast: [
          { id: 1, name: 'Lead Performer', character: 'Main Protagonist', profile_path: null },
          { id: 2, name: 'Co-Star', character: 'Supporting Role', profile_path: null },
        ],
      },
      similar: {
        results: FALLBACK_TRENDING.filter((m) => m.id !== numId).slice(0, 4),
      },
    };
  }

  return null;
}

export async function fetchVideos(mediaType: MediaType, id: number | string): Promise<TmdbVideo[]> {
  const resp = await callProxy<{ id: number; results: TmdbVideo[] }>(`/${mediaType}/${id}/videos`);
  if (resp && Array.isArray(resp.results)) {
    return resp.results.filter((v) => v.site === 'YouTube');
  }
  return [];
}
