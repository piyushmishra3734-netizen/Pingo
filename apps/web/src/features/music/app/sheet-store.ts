import { useSyncExternalStore } from 'react';

/**
 * Whether PINGO Music is open, for the few places that need to know: the
 * header button that opens it, the sheet itself, and the island, which steps
 * aside while the sheet is up (the sheet has its own player).
 */

let open = false;
/** Set once the sheet has been opened, so its code is loaded on first use and kept after. */
let everOpened = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openMusic() {
  if (open) return;
  open = true;
  everOpened = true;
  emit();
}

export function closeMusic() {
  if (!open) return;
  open = false;
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useMusicOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

export function useMusicEverOpened(): boolean {
  return useSyncExternalStore(subscribe, () => everOpened, () => false);
}

/**
 * Warm the sheet before it is needed, on a press rather than the release: its
 * code, and the home page's catalogue, which is the slow part of a first open.
 */
export function preloadMusic() {
  void import('./MusicSheet.js');
  void Promise.all([import('../saavn/api.js'), import('../saavn/settings.js')]).then(([api, settings]) => {
    void api.home(settings.currentHomeLanguages()).catch(() => undefined);
  });
}
