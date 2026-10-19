import React, { useEffect, useState } from 'react';
import { Film, Loader2, Search, Tv, X } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { MediaType, TmdbMedia } from '../types.js';
import { fetchByGenre, searchMedia } from '../api/tmdb.js';
import { getTmdbPosterUrl } from '../api/tmdb.js';

interface TvSearchProps {
  onSelect: (media: TmdbMedia) => void;
}

const GENRE_CHIPS = [
  { label: 'All', id: 0, type: 'all' },
  { label: 'Action', id: 28, type: 'movie' },
  { label: 'Animation / Anime', id: 16, type: 'tv' },
  { label: 'Sci-Fi', id: 878, type: 'movie' },
  { label: 'Drama', id: 18, type: 'tv' },
  { label: 'Comedy', id: 35, type: 'movie' },
  { label: 'Thriller', id: 53, type: 'movie' },
  { label: 'Mystery', id: 9648, type: 'tv' },
];

export function TvSearch({ onSelect }: TvSearchProps) {
  const [query, setQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<number>(0);
  const [results, setResults] = useState<TmdbMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<'all' | 'movie' | 'tv' | 'anime'>('all');

  useEffect(() => {
    let active = true;

    if (query.trim()) {
      setLoading(true);
      const timer = setTimeout(() => {
        void searchMedia(query.trim()).then((res) => {
          if (!active) return;
          setResults(res);
          setLoading(false);
        });
      }, 350);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }

    if (selectedGenre !== 0) {
      setLoading(true);
      const chip = GENRE_CHIPS.find((c) => c.id === selectedGenre);
      const mediaType: MediaType = chip?.type === 'tv' ? 'tv' : 'movie';
      void fetchByGenre(mediaType, selectedGenre).then((res) => {
        if (!active) return;
        setResults(res);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    // Default: fetch popular discover results
    setLoading(true);
    void searchMedia('a').then((res) => {
      if (!active) return;
      setResults(res);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [query, selectedGenre]);

  const shown = results.filter((m) => {
    const type = m.media_type || (m.title ? 'movie' : 'tv');
    if (kind === 'all') return true;
    if (kind === 'anime') return Boolean(m.genre_ids?.includes(16));
    return type === kind;
  });

  return (
    <div className="flex flex-col px-4 pt-2 md:px-10">
      {/* Search Input Bar */}
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3.5 size-4 text-text-secondary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies, TV shows, anime, creators..."
          autoFocus
          className="w-full rounded-full border border-white/12 bg-white/[0.07] py-3 pr-10 pl-11 text-[15px] font-medium text-ink placeholder:text-white/45 focus:border-white/35 focus:bg-white/10 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery('')}
            className="absolute right-3 grid size-6 place-items-center rounded-full bg-line text-text-secondary hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* What kind of title */}
      <div role="tablist" aria-label="Kind of title" className="mt-4 flex items-center gap-1 border-b border-white/10">
        {([['all', 'All'], ['movie', 'Movies'], ['tv', 'Series'], ['anime', 'Anime']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={kind === id} onClick={() => setKind(id)} className={cn('-mb-px border-b-2 px-4 py-2.5 text-[14px] transition-colors', kind === id ? 'border-brand font-bold text-brand' : 'border-transparent font-medium text-white/65 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>

      {/* Genre Filter Pills */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {GENRE_CHIPS.map((chip) => {
          const isSelected = selectedGenre === chip.id && !query;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedGenre(chip.id);
              }}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all active:scale-95',
                isSelected
                  ? 'bg-brand text-white'
                  : 'border border-white/15 bg-transparent text-white/80 hover:bg-white/10',
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Results Header */}
      <div className="mt-4 mb-2 flex items-center justify-between text-xs text-text-secondary">
        <span>{query ? `Search results for "${query}"` : 'Browse Catalog'}</span>
        {shown.length > 0 && <span>{shown.length} titles</span>}
      </div>

      {/* Loading Indicator */}
      {loading && (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-text-secondary">
          <Loader2 className="size-6 animate-spin text-brand" />
          <span className="text-xs">Searching titles...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && shown.length === 0 && (
        <div className="flex h-56 flex-col items-center justify-center gap-2 text-center text-text-secondary">
          <Film className="size-10 text-text-secondary/40" />
          <p className="text-sm font-semibold text-ink">No titles found</p>
          <p className="max-w-xs text-xs">Try searching with a different title, actor, or genre keyword.</p>
        </div>
      )}

      {/* Results: a row each, with what it is and a line about it */}
      {!loading && shown.length > 0 && (
        <ul className="divide-y divide-white/[0.07] pb-8">
          {shown.map((m) => {
            const type = m.media_type || (m.title ? 'movie' : 'tv');
            const year = (m.release_date || m.first_air_date || '').slice(0, 4);
            const poster = getTmdbPosterUrl(m.poster_path, 'w185');
            return (
              <li key={`${type}-${m.id}`}>
                <button type="button" onClick={() => onSelect(m)} className="flex w-full items-center gap-4 rounded-lg px-1 py-3 text-left transition hover:bg-white/[0.05]">
                  <span className="h-[84px] w-14 shrink-0 overflow-hidden rounded bg-white/[0.07]">
                    {poster && <img src={poster} alt="" loading="lazy" draggable={false} className="size-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-white">{m.title || m.name}</span>
                    <span className="mt-0.5 block text-[12.5px] text-white/55">
                      {type === 'movie' ? 'Movie' : 'Series'}
                      {year && ` · ${year}`}
                      {m.vote_average > 0 && ` · \u2605 ${m.vote_average.toFixed(1)}`}
                    </span>
                    {m.overview && <span className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-white/65">{m.overview}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
