import { X } from 'lucide-react';
import { useState } from 'react';

import '../auth/paper.css';
import { listenAlong, stopListeningAlong, useListenAlong } from './listen-along.js';
import { useListening } from './listening.js';

/**
 * A note under a chat's header while the other person plays PINGO Music:
 * what it is, and "listen along" to hear it here too, in step with them.
 *
 * Made of the PINGO paper (`auth/paper.css`), the material of sign-in and the
 * background prompt: a note taped to the page, a hand-written aside, the cover
 * as a little print, and the action as a marked word rather than a button
 * shape. Direct chats only, and not when they are the one following you: two
 * people following each other would just go round.
 */
export function ListenAlongBar({ userId, name, myId, top }: { userId: string; name: string; myId: string | undefined; top: number }) {
  const music = useListening(userId);
  const sync = useListenAlong();
  const synced = sync?.userId === userId;
  // Put away for this song; the next one asks again.
  const [hidden, setHidden] = useState<string>();
  const first = name.split(' ')[0] || name;

  if (!synced && (!music || music.w === myId || hidden === `${music.n}|${music.a}` || (!music.u && !music.d))) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 z-100 flex justify-center px-4" style={{ top: top + 10 }}>
      <div role="status" className="paper-vars paper-note pointer-events-auto relative flex w-full max-w-[344px] -rotate-[0.6deg] items-center gap-3 py-2.5 pr-2 pl-3">
        <span aria-hidden className="paper-tape -top-2.5 left-7 h-[18px] w-14 -rotate-6" />

        {/* The cover as a small print, white edge and all. */}
        <span className="relative size-11 shrink-0 rotate-[2.5deg] bg-white p-[3px] shadow-[0_2px_6px_-2px_rgba(60,40,20,0.45)]">
          {music?.i ? (
            <img
              src={music.i.replace(/-50x50\./, '-150x150.')}
              alt=""
              draggable={false}
              className="size-full object-cover"
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden';
              }}
            />
          ) : (
            <span className="block size-full bg-[#ece6f8]" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="paper-hand flex items-center gap-1.5 text-[17px] leading-none">
            {synced ? (music ? 'in sync with ' + first : first + ' paused,') : first + "'s playing,"}
            {synced && music && <Bars />}
          </span>
          <span className="mt-1 block truncate text-[14px] leading-tight font-semibold text-ink">
            {music ? music.n : 'waiting for the next song'}
            {music?.a && <span className="font-normal text-text-secondary"> · {music.a}</span>}
          </span>
        </span>

        {synced ? (
          <button type="button" onClick={stopListeningAlong} className="shrink-0 px-2 py-2 text-[13.5px] font-medium text-text-secondary underline decoration-dotted underline-offset-4 active:opacity-60">
            stop
          </button>
        ) : (
          <>
            <button type="button" onClick={() => listenAlong(userId, name)} className="shrink-0 px-1.5 py-2 text-[14.5px] font-bold text-ink active:opacity-60">
              <span className="paper-marker">listen along</span>
            </button>
            <button
              type="button"
              aria-label="Hide"
              onClick={() => music && setHidden(`${music.n}|${music.a}`)}
              className="grid size-7 shrink-0 place-items-center rounded-full text-text-tertiary active:bg-black/5"
            >
              <X size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Three small bars in the hand-writing's colour while it plays in step. Still under reduced motion. */
function Bars() {
  return (
    <span aria-hidden className="flex h-3 items-end gap-[1.5px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="listen-bar block h-full w-[2.5px] rounded-full bg-current" style={{ animationDelay: `${i * 0.18}s` }} />
      ))}
      <style>{`.listen-bar { transform-origin: bottom; animation: listen-bar 0.9s var(--ease-standard, ease-in-out) infinite alternate; }
@keyframes listen-bar { from { transform: scaleY(0.3); } to { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .listen-bar { animation: none; transform: scaleY(0.7); } }`}</style>
    </span>
  );
}
