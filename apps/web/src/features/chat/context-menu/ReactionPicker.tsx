import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Overlay } from '../../../components/Overlay.js';
import { reactionUses } from './ReactionBar.js';

/**
 * Every emoji, for a reaction - Instagram's sheet.
 *
 * A handle, a search pill, and big emoji in a plain grid: yours first, then
 * each category under a quiet heading. The general picker (emoji-mart's own
 * UI) is a keyboard's tool, with tabs and a tone button and small targets;
 * reacting is one tap, so this keeps only what that needs. The names and
 * keywords still come from emoji-mart's data, fetched when the sheet opens.
 */

interface EmojiData {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<string, { name: string; keywords: string[]; skins: { native: string }[] }>;
}

const TITLES: Record<string, string> = {
  people: 'Smileys & people',
  nature: 'Animals & nature',
  foods: 'Food & drink',
  activity: 'Activity',
  places: 'Travel & places',
  objects: 'Objects',
  symbols: 'Symbols',
  flags: 'Flags',
};

export function ReactionPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [data, setData] = useState<EmojiData>();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void import('@emoji-mart/data').then((module) => {
      if (live) setData(module.default as EmojiData);
    });
    return () => {
      live = false;
    };
  }, []);

  const recent = useMemo(
    () =>
      Object.entries(reactionUses())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16)
        .map(([emoji]) => emoji),
    [],
  );

  const sections = useMemo(() => {
    if (!data) return [];
    const native = (id: string) => data.emojis[id]?.skins[0]?.native;
    const q = query.trim().toLowerCase();
    if (q) {
      const hits = Object.entries(data.emojis)
        .filter(([id, e]) => id.includes(q) || e.name.toLowerCase().includes(q) || e.keywords.some((k) => k.includes(q)))
        .map(([, e]) => e.skins[0]!.native);
      return [{ title: hits.length ? 'Results' : 'No emoji found', list: hits }];
    }
    return [
      ...(recent.length ? [{ title: 'Your reactions', list: recent }] : []),
      ...data.categories
        .filter((c) => c.id !== 'frequent')
        .map((c) => ({ title: TITLES[c.id] ?? c.id, list: c.emojis.map(native).filter((e): e is string => Boolean(e)) })),
    ];
  }, [data, query, recent]);

  return (
    <Overlay onDismiss={onClose}>
      <div className="fixed inset-0 z-1100 flex flex-col justify-end">
        <div className="lq-dim animate-fade-in absolute inset-0" onPointerDown={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose a reaction"
          className="animate-panel-in relative mx-auto flex h-[62dvh] w-full max-w-lg flex-col rounded-t-[22px] bg-page shadow-2xl"
        >
          <span className="mx-auto mt-2 h-[5px] w-10 shrink-0 rounded-full bg-line-strong" />
          <label className="mx-4 mt-3 mb-1 flex h-10 shrink-0 items-center gap-2 rounded-xl bg-sunken px-3 text-text-secondary">
            <Search size={17} aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search emoji"
              aria-label="Search emoji"
              className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-text-tertiary"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>
                <X size={16} />
              </button>
            )}
          </label>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {!data && <p className="p-6 text-center text-caption text-text-tertiary">Loading emoji…</p>}
            {sections.map((section) => (
              <section
                key={section.title}
                /*
                 * Some 1,800 emoji. Laid out all at once they froze the page
                 * for seconds; off-screen sections are skipped until scrolled to.
                 */
                style={{
                  contentVisibility: 'auto',
                  containIntrinsicSize: `auto ${Math.ceil(section.list.length / 8) * 48 + 40}px`,
                }}
              >
                <h3 className="px-2 pt-3 pb-1.5 text-[13px] font-semibold text-text-secondary">
                  {section.title}
                </h3>
                <div className="grid grid-cols-8">
                  {section.list.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`React with ${emoji}`}
                      onClick={() => onPick(emoji)}
                      className="grid aspect-square place-items-center rounded-xl text-[30px] leading-none transition-transform active:scale-125 hover:bg-hover"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
