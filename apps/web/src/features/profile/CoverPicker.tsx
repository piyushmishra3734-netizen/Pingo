import { cn } from '@pingo/ui';
import { Check, Crown, Upload } from 'lucide-react';
import { useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { COVER_COLLECTIONS, type CoverPreset } from './cover-presets.js';

/**
 * Choosing a cover: the ready-made collections for everybody, and your own
 * picture for PINGO premium.
 *
 * Collections first, because that is what everybody can use; the upload sits
 * on top as one row, locked with a crown for anyone without premium, so it is
 * an invitation rather than a missing feature.
 */
export function CoverPicker({
  current,
  premium,
  onPick,
  onUpload,
  onClose,
}: {
  /** The cover shown now, to tick it in the grid. */
  current: string | null | undefined;
  premium: boolean;
  onPick: (preset: CoverPreset) => void;
  /** Opens the file picker; only offered to premium. */
  onUpload: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(COVER_COLLECTIONS[0]!.id);
  const shown = COVER_COLLECTIONS.find((c) => c.id === tab) ?? COVER_COLLECTIONS[0]!;

  return (
    <Sheet title="Choose a cover" description="Shown at the top of your profile and your chats." onClose={onClose}>
      <button
        type="button"
        onClick={() => (premium ? onUpload() : undefined)}
        aria-disabled={!premium}
        className={cn(
          'focus-ring mb-4 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1 ring-line',
          premium ? 'bg-surface active:scale-[0.99]' : 'bg-sunken',
        )}
      >
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', premium ? 'bg-brand/10 text-brand' : 'bg-surface text-text-tertiary')}>
          <Upload size={19} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold text-ink">Upload your own</span>
          <span className="block text-[13px] text-text-secondary">{premium ? 'Any photo from your phone' : 'Part of PINGO premium'}</span>
        </span>
        {!premium && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#fff3d6] px-2.5 py-1 text-[12px] font-bold text-[#a16207]">
            <Crown size={13} aria-hidden /> Premium
          </span>
        )}
      </button>

      {COVER_COLLECTIONS.length > 1 && (
        <div role="tablist" aria-label="Collections" className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
          {COVER_COLLECTIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === tab}
              onClick={() => setTab(c.id)}
              className={cn(
                'focus-ring h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold',
                c.id === tab ? 'bg-ink text-surface' : 'bg-sunken text-text-secondary',
              )}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}

      <div role="radiogroup" aria-label={shown.title} className="grid grid-cols-2 gap-2.5 pb-2">
        {shown.covers.map((cover) => {
          const on = current?.split('?')[0]?.endsWith(new URL(cover.src).pathname) ?? false;
          return (
            <button
              key={cover.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={cover.label}
              onClick={() => onPick(cover)}
              className={cn(
                'focus-ring relative aspect-[3/1] overflow-hidden rounded-2xl bg-sunken bg-cover bg-center active:scale-[0.98]',
                on && 'ring-[3px] ring-brand ring-offset-2 ring-offset-surface',
              )}
              style={{ backgroundImage: `url(${cover.src})` }}
            >
              {on && (
                <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-brand text-on-brand">
                  <Check size={14} strokeWidth={3} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
