import {
  STICKER_CATEGORIES,
  searchStickers,
  type Sticker,
  type StickerCategory,
} from '@pingo/core';
import { PingoDot, SearchField, cn } from '@pingo/ui';
import { useMemo, useState } from 'react';

import { useStickers } from './StickerContext.js';

/**
 * The sticker picker.
 *
 * ## Recent first, always
 *
 * People send the same handful of stickers over and over. Putting recents at
 * the top means the common case is zero navigation, and it is why the category
 * row starts on Recent rather than Smileys.
 *
 * ## Search spans every pack
 *
 * Categories are per-pack; search is not. Someone looking for 🔥 does not know
 * or care which pack it came from, so the results are flat and ranked — an
 * exact emoji match first, then name, then keywords.
 */

export interface StickerPickerProps {
  onSelect: (sticker: Sticker) => void;
}

type Tab = 'recent' | StickerCategory;

export function StickerPicker({ onSelect }: StickerPickerProps) {
  const { packs, loading, recent, markUsed } = useStickers();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('recent');

  const all = useMemo(() => packs.flatMap((pack) => pack.stickers), [packs]);
  const byId = useMemo(() => new Map(all.map((sticker) => [sticker.id, sticker])), [all]);

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchStickers(packs, query) : []),
    [searching, packs, query],
  );

  const recentStickers = useMemo(
    () => recent.map((id) => byId.get(id)).filter((s): s is Sticker => Boolean(s)),
    [recent, byId],
  );

  /*
   * Only categories that actually have stickers get a tab. A tab that opens on
   * an empty grid is a promise the packs did not keep.
   */
  const availableCategories = useMemo(
    () => STICKER_CATEGORIES.filter((c) => all.some((s) => s.category === c.id)),
    [all],
  );

  const shown = searching
    ? results
    : tab === 'recent'
      ? recentStickers
      : all.filter((sticker) => sticker.category === tab);

  const choose = (sticker: Sticker) => {
    markUsed(sticker.id);
    onSelect(sticker);
  };

  return (
    <div className="flex h-80 flex-col">
      <div className="px-3 pt-3">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search stickers"
          aria-label="Search stickers"
        />
      </div>

      {!searching && (
        <div
          className="flex gap-1.5 overflow-x-auto scrollbar-none px-3 py-2.5"
          role="tablist"
          aria-label="Sticker categories"
        >
          <CategoryTab
            label="Recent"
            selected={tab === 'recent'}
            onSelect={() => setTab('recent')}
          />
          {availableCategories.map((category) => (
            <CategoryTab
              key={category.id}
              label={category.label}
              selected={tab === category.id}
              onSelect={() => setTab(category.id)}
            />
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="grid h-full place-items-center">
            <PingoDot state="loading" size={6} label="Loading stickers" />
          </div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-10 text-center text-caption text-text-secondary">
            {searching
              ? `Nothing matches “${query.trim()}”.`
              : tab === 'recent'
                ? 'Stickers you use will show up here.'
                : 'Nothing in this category yet.'}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {shown.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                onClick={() => choose(sticker)}
                title={sticker.name}
                className={cn(
                  'aspect-square rounded-md p-1.5',
                  'focus-ring transition-transform duration-instant ease-standard',
                  'hover:bg-hover active:scale-90',
                )}
              >
                <img
                  src={sticker.url}
                  alt={sticker.name}
                  loading="lazy"
                  draggable={false}
                  className="h-full w-full select-none object-contain"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/*
        CC-BY packs require visible credit, and the honest place for it is where
        the assets are — not a legal page nobody opens.
      */}
      {packs.length > 0 && (
        <p className="border-t border-divider px-3 py-2 text-[0.6875rem] text-text-tertiary">
          {packs.map((pack) => pack.attribution.credit).join(' · ')}
        </p>
      )}
    </div>
  );
}

function CategoryTab({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'shrink-0 rounded-full px-3 py-1.5 text-caption',
        'focus-ring transition-colors duration-instant ease-standard',
        selected ? 'bg-brand text-white' : 'bg-sunken text-text-secondary hover:bg-hover',
      )}
    >
      {label}
    </button>
  );
}
