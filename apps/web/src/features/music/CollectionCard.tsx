import { cn } from '@pingo/ui';
import { ChevronRight, ListMusic, Music2 } from 'lucide-react';

import { openMusicAt, preloadMusic } from './app/sheet-store.js';
import { KIND_LABEL, type SharedCollection } from './music-share.js';

/**
 * A playlist, album or artist somebody sent, as a card. Tapping it opens
 * PINGO Music on that page, as the song card plays its song: the same blurred
 * cover for its colour, so the two read as one family in a thread.
 */
export function CollectionCard({ item, mine }: { item: SharedCollection; mine: boolean }) {
  const round = item.kind === 'artist';
  return (
    <button
      type="button"
      onPointerDown={preloadMusic}
      onClick={() => openMusicAt(item)}
      aria-label={`Open ${KIND_LABEL[item.kind].toLowerCase()} ${item.name} in PINGO Music`}
      className={cn('relative w-[268px] max-w-full overflow-clip rounded-[22px] text-left text-white shadow-[0_6px_24px_rgba(16,17,20,0.18)] active:scale-[0.99]', mine ? 'self-end' : 'self-start')}
    >
      {item.img ? (
        <img src={item.img} alt="" aria-hidden className="absolute inset-0 size-full scale-150 object-cover blur-2xl" />
      ) : (
        <span aria-hidden className="absolute inset-0 bg-[linear-gradient(135deg,#8b5dff,#e0559b_55%,#ff9a5a)]" />
      )}
      <span aria-hidden className="absolute inset-0 bg-black/35" />

      <span className="relative flex flex-col gap-3 p-3.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/80 uppercase">
          <Music2 size={13} />
          PINGO Music · {KIND_LABEL[item.kind]}
        </span>
        <span className="flex items-center gap-3">
          {item.img ? (
            <img src={item.img} alt="" className={cn('size-16 shrink-0 object-cover shadow-lg', round ? 'rounded-full' : 'rounded-[12px]')} />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-[12px] bg-white/15">
              <ListMusic size={26} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-[15px] leading-snug font-bold">{item.name}</span>
            {item.sub && <span className="mt-0.5 block truncate text-[12.5px] text-white/75">{item.sub}</span>}
          </span>
        </span>
        <span className="flex h-10 items-center justify-center gap-1 rounded-full bg-white text-[14px] font-semibold text-black">
          Open
          <ChevronRight size={17} />
        </span>
      </span>
    </button>
  );
}
