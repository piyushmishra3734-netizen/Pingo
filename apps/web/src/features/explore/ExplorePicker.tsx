import { SearchField, cn } from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { explore, ExploreError, type ExploreItem, type ExploreSource } from './explore-api.js';

/**
 * The Explore tab beside Emoji, Stickers and Music: Pinterest's way of looking
 * (a masonry of pictures, a search on top) over photos from Pexels and GIFs and
 * stickers from GIPHY. Tap one to send it.
 *
 * Two columns of different heights, filled shortest-first, so the grid keeps its
 * ragged edge without a layout library. More loads when the bottom comes into
 * view. Pexels and GIPHY both ask to be credited, so the source is named under
 * the grid, and a photo carries its photographer in the message.
 */

const SOURCES: { id: ExploreSource; label: string }[] = [
  { id: 'gifs', label: 'GIFs' },
  { id: 'stickers', label: 'Stickers' },
  { id: 'photos', label: 'Photos' },
  { id: 'sounds', label: 'Sounds' },
];

/** Where the next tile goes: the column that is shorter so far, by the tile's own shape. */
function split(items: ExploreItem[], columns = 2): ExploreItem[][] {
  const out: ExploreItem[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  for (const item of items) {
    const shortest = heights.indexOf(Math.min(...heights));
    out[shortest]!.push(item);
    heights[shortest]! += item.h / item.w;
  }
  return out;
}

export function ExplorePicker({ onSelect }: { onSelect: (item: ExploreItem) => void }) {
  // GIFs first: they need only the GIPHY key, and Photos stays one tap away.
  const [source, setSource] = useState<ExploreSource>('gifs');
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [items, setItems] = useState<ExploreItem[]>([]);
  const [next, setNext] = useState<number | null>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  // A sound is tried before it is sent: one at a time, played from where it lives.
  const preview = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string>();

  const stopPreview = useCallback(() => {
    preview.current?.pause();
    preview.current = null;
    setPlaying(undefined);
  }, []);
  useEffect(() => stopPreview, [stopPreview]);
  useEffect(() => stopPreview(), [source, query, stopPreview]);

  const tryOut = (item: ExploreItem) => {
    if (playing === item.id) return stopPreview();
    stopPreview();
    const audio = new Audio(item.url);
    preview.current = audio;
    setPlaying(item.id);
    audio.onended = () => preview.current === audio && stopPreview();
    audio.onerror = () => preview.current === audio && stopPreview();
    void audio.play().catch(() => preview.current === audio && stopPreview());
  };

  // One request per pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed), 320);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const load = useCallback(
    async (page: number, replace: boolean) => {
      const mine = ++request.current;
      setLoading(true);
      setError(undefined);
      try {
        const result = await explore(source, query, page);
        if (mine !== request.current) return;
        setItems((current) => {
          const have = new Set((replace ? [] : current).map((i) => i.id));
          return [...(replace ? [] : current), ...result.items.filter((i) => !have.has(i.id))];
        });
        setNext(result.next);
      } catch (e) {
        if (mine !== request.current) return;
        setError(e instanceof ExploreError ? e.message : 'Could not load. Try again.');
        setNext(null);
      } finally {
        if (mine === request.current) setLoading(false);
      }
    },
    [source, query],
  );

  // A new source or search starts again from the top.
  useEffect(() => {
    setItems([]);
    setNext(1);
    scroller.current?.scrollTo({ top: 0 });
    void load(1, true);
  }, [load]);

  // The bottom coming into view asks for the next page.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || next === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && next !== null && items.length > 0) void load(next, false);
      },
      { root: scroller.current, rootMargin: '240px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [next, loading, items.length, load]);

  const columns = split(items);
  const credit =
    source === 'photos'
      ? { text: 'Photos provided by Pexels', url: 'https://www.pexels.com' }
      : source === 'sounds'
        ? { text: 'Sounds from Freesound (CC0)', url: 'https://freesound.org' }
        : { text: 'Powered by GIPHY', url: 'https://giphy.com' };

  return (
    <div className="flex h-full flex-col">
      <div className="px-2.5 pt-2.5">
        <SearchField value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={source === 'photos' ? 'Search photos' : source === 'gifs' ? 'Search GIFs' : source === 'sounds' ? 'Search sounds: bruh, airhorn…' : 'Search stickers'} aria-label="Search Explore" />
      </div>
      <div role="tablist" aria-label="Explore" className="flex shrink-0 gap-1.5 px-2.5 py-2">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={source === s.id}
            onClick={() => setSource(s.id)}
            className={cn('focus-ring h-8 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-instant', source === s.id ? 'bg-ink text-page' : 'bg-hover text-text-secondary')}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-2">
        {items.length > 0 && source === 'sounds' && (
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-[14px] bg-hover p-1.5">
                <button
                  type="button"
                  onClick={() => tryOut(item)}
                  aria-label={playing === item.id ? `Stop ${item.title}` : `Play ${item.title}`}
                  className="focus-ring grid size-10 shrink-0 place-items-center rounded-full bg-ink text-[15px] text-page active:scale-95"
                >
                  {playing === item.id ? '❚❚' : '▶'}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{item.title}</span>
                  <span className="block truncate text-[12px] text-text-tertiary">
                    {item.secs ? `${item.secs}s` : ''}
                    {item.by ? ` · ${item.by.name}` : ''}
                  </span>
                </span>
                <button type="button" onClick={() => onSelect(item)} aria-label={`Send ${item.title}`} className="focus-ring h-9 shrink-0 rounded-full bg-brand px-3.5 text-[13px] font-semibold text-white active:scale-95">
                  Send
                </button>
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 && source !== 'sounds' && (
          <div className="flex items-start gap-2">
            {columns.map((column, c) => (
              <div key={c} className="flex min-w-0 flex-1 flex-col gap-2">
                {column.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item)}
                    aria-label={`Send ${item.title || item.kind}`}
                    className={cn('focus-ring group relative block w-full overflow-hidden rounded-[14px] active:scale-[0.98]', item.kind === 'sticker' ? 'bg-hover' : 'bg-sunken')}
                    style={{ aspectRatio: `${item.w} / ${item.h}` }}
                  >
                    <img src={item.thumb} alt={item.title} loading="lazy" draggable={false} className={cn('size-full', item.kind === 'sticker' ? 'object-contain' : 'object-cover')} />
                    {item.by && item.kind === 'photo' && (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-2 pb-1 pt-4 text-left text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {item.by.name}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {loading && items.length === 0 && (
          <div className="flex items-start gap-2" aria-hidden>
            {[0, 1].map((c) => (
              <div key={c} className="flex flex-1 flex-col gap-2">
                {[1.3, 0.9, 1.5].map((r, i) => (
                  <span key={i} className="block w-full animate-pulse rounded-[14px] bg-hover" style={{ aspectRatio: `1 / ${r + (c ? 0.25 : 0)}` }} />
                ))}
              </div>
            ))}
          </div>
        )}

        {error && (
          <p role="status" className="py-6 text-center text-[13.5px] text-text-secondary">
            {error}{' '}
            <button type="button" onClick={() => void load(1, true)} className="font-semibold text-brand">
              Retry
            </button>
          </p>
        )}
        {!loading && !error && items.length === 0 && <p className="py-6 text-center text-[13.5px] text-text-secondary">Nothing found. Try another word.</p>}

        <div ref={sentinel} className="h-px" aria-hidden />
        {loading && items.length > 0 && <p className="py-2 text-center text-[12px] text-text-tertiary">Loading…</p>}
      </div>

      <a href={credit.url} target="_blank" rel="noopener noreferrer" className="shrink-0 border-t border-line py-1.5 text-center text-[11px] font-medium text-text-tertiary">
        {credit.text}
      </a>
    </div>
  );
}
