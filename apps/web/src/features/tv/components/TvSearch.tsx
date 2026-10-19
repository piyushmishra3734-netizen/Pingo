import React, { useEffect, useState } from 'react';
import { Film, Loader2, Search, Tv, X } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { MediaType, TmdbMedia } from '../types.js';
import { fetchByGenre, searchMedia } from '../api/tmdb.js';
import { TvMediaCard } from './TvMediaCard.js';

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

  return (
    <div className="flex flex-col px-4 pt-2">
      {/* Search Input Bar */}
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3.5 size-4 text-text-secondary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies, TV shows, anime, creators..."
          className="w-full rounded-xl bg-sunken py-3 pr-10 pl-10 text-sm font-medium text-ink placeholder:text-text-secondary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/40"
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
                  ? 'bg-brand text-on-brand shadow-sm'
                  : 'bg-sunken text-text-secondary hover:bg-line hover:text-ink',
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
        {results.length > 0 && <span>{results.length} titles</span>}
      </div>

      {/* Loading Indicator */}
      {loading && (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-text-secondary">
          <Loader2 className="size-6 animate-spin text-brand" />
          <span className="text-xs">Searching titles...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && results.length === 0 && (
        <div className="flex h-56 flex-col items-center justify-center gap-2 text-center text-text-secondary">
          <Film className="size-10 text-text-secondary/40" />
          <p className="text-sm font-semibold text-ink">No titles found</p>
          <p className="max-w-xs text-xs">Try searching with a different title, actor, or genre keyword.</p>
        </div>
      )}

      {/* Results Grid */}
      {!loading && results.length > 0 && (
        <div className="grid grid-cols-2 gap-3 pb-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {results.map((media) => (
            <TvMediaCard key={`${media.media_type || 'm'}-${media.id}`} media={media} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
