import { useSyncExternalStore } from 'react';

/**
 * Whether stories are heard, for the whole viewer.
 *
 * Two different reasons for silence, kept apart because they end differently:
 *
 * - `muted` is the person's own choice (the speaker button, top right). It stays
 *   across stories until they undo it, as Instagram's does.
 * - `blocked` is the browser refusing sound it was not invited to play, which
 *   Chrome does until the page has been touched. It is not a choice, so the
 *   button shows it as muted and one tap on the button (or anywhere) clears it.
 *
 * Everything that plays a story's sound (the clip, the song laid over it) reads
 * `silent()`, so they go quiet and come back together.
 */
let muted = false;
let blocked = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const silent = (): boolean => muted || blocked;

/** The browser would not start sound: stay quiet, and say so on the button. */
export function markStoryBlocked() {
  if (blocked) return;
  blocked = true;
  emit();
}

/** A touch is the permission a browser was waiting for. */
export function clearStoryBlocked() {
  if (!blocked) return;
  blocked = false;
  emit();
}

/** The speaker button: sound on if it is off for any reason, off if it is on. */
export function toggleStorySound() {
  if (silent()) {
    muted = false;
    blocked = false;
  } else {
    muted = true;
  }
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useStorySilent(): boolean {
  return useSyncExternalStore(subscribe, silent, silent);
}
