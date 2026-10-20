import { X } from 'lucide-react';
import { useState } from 'react';

import '../auth/paper.css';
import { openMini } from './mini-player.js';
import { useWatching, watchingLine } from './watching.js';

/**
 * A note under a chat's header while the other person watches something on
 * Pingo TV: what it is, and "watch along" to open the very same title and
 * episode here. The sibling of the music note (`music/ListenAlongBar`), in the
 * same paper, so one habit works for both.
 *
 * It opens the same episode and follows them to the next one; pressing play
 * is each person's own (see `watching.ts` for why).
 */
export function WatchAlongBar({ userId, name, myId, top }: { userId: string; name: string; myId: string | undefined; top: number }) {
  const tv = useWatching(userId);
  // Put away for this episode; the next one asks again.
  const [hidden, setHidden] = useState<string>();
  const first = name.split(' ')[0] || name;

  if (!tv || tv.w === myId || hidden === watchingLine(tv)) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 z-100 flex justify-center px-4" style={{ top: top + 10 }}>
      <div role="status" className="paper-vars paper-note pointer-events-auto relative flex w-full max-w-[344px] -rotate-[0.6deg] items-center gap-3 py-2.5 pr-2 pl-3">
        <span aria-hidden className="paper-tape -top-2.5 left-7 h-[18px] w-14 -rotate-6" />

        <span className="relative h-14 w-10 shrink-0 rotate-[2.5deg] bg-white p-[3px] shadow-[0_2px_6px_-2px_rgba(60,40,20,0.45)]">
          {tv.i ? (
            <img src={tv.i} alt="" draggable={false} className="size-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          ) : (
            <span className="block size-full bg-[#ece6f8]" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="paper-hand block text-[17px] leading-none">{first + ' is watching,'}</span>
          <span className="mt-1 block truncate text-[14px] leading-tight font-semibold text-ink">{watchingLine(tv)}</span>
        </span>

        <button
          type="button"
          onClick={() =>
            openMini({
              media: {
                id: tv.id,
                ...(tv.y === 'movie' ? { title: tv.n } : { name: tv.n }),
                overview: '',
                poster_path: null,
                backdrop_path: null,
                vote_average: 0,
                media_type: tv.y,
              },
              season: tv.s ?? 1,
              episode: tv.e ?? 1,
              ...(tv.i ? { poster: tv.i } : {}),
              ...(tv.p ? { source: tv.p } : {}),
              along: { id: userId, name },
            })
          }
          className="shrink-0 px-1.5 py-2 text-[14.5px] font-bold text-ink active:opacity-60"
        >
          <span className="paper-marker">watch along</span>
        </button>
        <button type="button" aria-label="Hide" onClick={() => setHidden(watchingLine(tv))} className="grid size-7 shrink-0 place-items-center rounded-full text-text-tertiary active:bg-black/5">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
