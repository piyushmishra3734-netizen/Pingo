import { useSyncExternalStore } from 'react';
import type { TmdbMedia } from './types.js';

/**
 * The floating Pingo TV window: a film or episode playing in a small player
 * over whatever screen the person is on, so they can keep chatting while it
 * runs. It starts from "watch along" on a friend's note in a chat, or from the
 * player's mini button.
 *
 * One at a time, held here rather than in a screen, so it survives navigation
 * the way the music island does.
 */

export interface MiniTarget {
  media: TmdbMedia;
  season: number;
  episode: number;
  /** A small poster URL, for telling friends what this person is watching. */
  poster?: string;
  /** The friend this is following, if any: it moves to whatever they move to. */
  along?: { id: string; name: string };
}

let target: MiniTarget | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openMini(next: MiniTarget) {
  target = next;
  emit();
}

export function updateMini(patch: Partial<MiniTarget>) {
  if (!target) return;
  target = { ...target, ...patch };
  emit();
}

export function closeMini() {
  if (!target) return;
  target = undefined;
  emit();
}

export const currentMini = () => target;

export function useMini(): MiniTarget | undefined {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => target,
    () => target,
  );
}
