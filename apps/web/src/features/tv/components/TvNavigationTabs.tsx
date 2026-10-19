import React from 'react';
import { Bookmark, Film, Search, Sparkles, Tv } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TvTab } from '../types.js';

interface TvNavigationTabsProps {
  currentTab: TvTab;
  onTabChange: (tab: TvTab) => void;
  watchlistCount?: number;
}

export function TvNavigationTabs({
  currentTab,
  onTabChange,
  watchlistCount = 0,
}: TvNavigationTabsProps) {
  const tabs: { id: TvTab; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'Featured', icon: <Sparkles className="size-3.5" /> },
    { id: 'movies', label: 'Movies', icon: <Film className="size-3.5" /> },
    { id: 'shows', label: 'TV Shows', icon: <Tv className="size-3.5" /> },
    { id: 'search', label: 'Search', icon: <Search className="size-3.5" /> },
    { id: 'watchlist', label: 'Watchlist', icon: <Bookmark className="size-3.5" /> },
  ];

  return (
    <nav className="flex items-center gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95',
              active
                ? 'bg-brand text-on-brand shadow-sm'
                : 'bg-sunken text-text-secondary hover:bg-line hover:text-ink',
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.id === 'watchlist' && watchlistCount > 0 && (
              <span
                className={cn(
                  'ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-bold',
                  active ? 'bg-white/20 text-white' : 'bg-brand/15 text-brand',
                )}
              >
                {watchlistCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
