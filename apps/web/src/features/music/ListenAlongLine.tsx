import { cn } from '@pingo/ui';
import { Headphones } from 'lucide-react';
import type { MouseEvent } from 'react';

import { listenAlong, stopListeningAlong, useListenAlong } from './listen-along.js';
import { useListening } from './listening.js';

/**
 * The chat header's second line while the other person plays PINGO Music:
 * "listening to Kesariya · Sync", and once in step, "in sync · Kesariya · Stop".
 * Words in the line that is already there, not a card over the thread.
 *
 * It sits inside the header's capsule, which is itself a button (it opens the
 * chat's info), so the word is not a button of its own: `listenAlongClick`
 * reads which word was tapped. A real button for keyboards and screen readers
 * sits beside the capsule (`ListenAlongButton`).
 */

export interface ListenAlongState {
  line: string;
  action?: 'sync' | 'stop';
  synced: boolean;
}

/** What the line says for this person, or nothing when they are not playing and not being followed. */
export function useListenAlongLine(userId: string | undefined, name: string, myId: string | undefined): ListenAlongState | undefined {
  const music = useListening(userId);
  const sync = useListenAlong();
  if (!userId) return undefined;
  const first = name.split(' ')[0] || name;
  if (sync?.userId === userId) {
    return { line: music ? `in sync · ${music.n}` : `in sync · waiting for ${first}`, action: 'stop', synced: true };
  }
  if (!music) return undefined;
  // Not when they are following you: two people following each other would only go round.
  const canSync = (!!music.u || !!music.d) && music.w !== myId;
  return { line: `listening to ${music.n}`, ...(canSync ? { action: 'sync' as const } : {}), synced: false };
}

export function ListenAlongLine({ state }: { state: ListenAlongState }) {
  return (
    <span className="flex max-w-full items-center gap-1 text-[12.5px] text-brand">
      {state.synced ? <Bars /> : <Headphones size={12} strokeWidth={2.4} className="shrink-0" aria-hidden />}
      <span className="truncate">{state.line}</span>
      {state.action && (
        <>
          <span aria-hidden className="text-text-tertiary">·</span>
          <span
            data-listen-action={state.action}
            aria-hidden
            className={cn(
              'relative shrink-0 font-semibold text-ink underline decoration-brand/60 decoration-[1.5px] underline-offset-[3px]',
              // A word is small to hit with a thumb: the target reaches past it.
              "after:absolute after:-inset-x-2.5 after:-inset-y-3 after:content-['']",
            )}
          >
            {state.action === 'sync' ? 'Sync' : 'Stop'}
          </span>
        </>
      )}
    </span>
  );
}

/** Handles a tap on the capsule: true when it was "Sync" or "Stop", so the capsule does not also open the info page. */
export function listenAlongClick(event: MouseEvent, userId: string, name: string): boolean {
  const action = (event.target as HTMLElement).closest('[data-listen-action]')?.getAttribute('data-listen-action');
  if (!action) return false;
  event.preventDefault();
  event.stopPropagation();
  if (action === 'sync') listenAlong(userId, name);
  else stopListeningAlong();
  return true;
}

/** The same action for a keyboard or a screen reader, which cannot pick a word out of a button. */
export function ListenAlongButton({ state, userId, name }: { state: ListenAlongState; userId: string; name: string }) {
  if (!state.action) return null;
  return (
    <button
      type="button"
      className="sr-only focus:not-sr-only"
      onClick={() => (state.action === 'sync' ? listenAlong(userId, name) : stopListeningAlong())}
    >
      {state.action === 'sync' ? `Listen along with ${name}` : `Stop listening along with ${name}`}
    </button>
  );
}

/** Three small bars, moving while it plays in step. Still under reduced motion. */
function Bars() {
  return (
    <span aria-hidden className="flex h-3 shrink-0 items-end gap-[1.5px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="listen-bar block h-full w-[2.5px] rounded-full bg-current" style={{ animationDelay: `${i * 0.18}s` }} />
      ))}
      <style>{`.listen-bar { transform-origin: bottom; animation: listen-bar 0.9s var(--ease-standard, ease-in-out) infinite alternate; }
@keyframes listen-bar { from { transform: scaleY(0.3); } to { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .listen-bar { animation: none; transform: scaleY(0.7); } }`}</style>
    </span>
  );
}
