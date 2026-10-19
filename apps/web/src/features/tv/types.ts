export type MediaType = 'movie' | 'tv';

export interface TmdbMedia {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  media_type?: MediaType;
  popularity?: number;
  origin_country?: string[];
  original_language?: string;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCast {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order?: number;
}

export interface TmdbVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  size: number;
  type: string;
  official: boolean;
  published_at?: string;
}

export interface TmdbMediaDetails {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  genres: TmdbGenre[];
  runtime?: number;
  number_of_seasons?: number;
  seasons?: { season_number: number; name: string; episode_count: number }[];
  number_of_episodes?: number;
  tagline?: string;
  status?: string;
  videos?: {
    results: TmdbVideo[];
  };
  credits?: {
    cast: TmdbCast[];
  };
  similar?: {
    results: TmdbMedia[];
  };
}

export interface TmdbResponse<T = TmdbMedia> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface WatchlistItem {
  id?: string;
  user_id?: string;
  media_id: string;
  media_type: MediaType;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview?: string;
  rating?: number;
  release_year?: string;
  created_at?: string;
}

export type TvTab = 'home' | 'movies' | 'shows' | 'anime' | 'kids' | 'search' | 'watchlist';

export interface TmdbEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  runtime?: number | null;
  air_date?: string | null;
}
