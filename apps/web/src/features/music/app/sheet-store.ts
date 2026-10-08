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

/**
 * A page to open on: a playlist, album or artist sent in a chat. The sheet
 * picks it up as it opens (or at once, if it is open) and pushes the page.
 */
export type MusicTarget = import('../music-share.js').SharedCollection;
let target: { value: MusicTarget; n: number } | undefined;
let targets = 0;

export function openMusicAt(value: MusicTarget) {
  target = { value, n: ++targets };
  everOpened = true;
  open = true;
  emit();
}

/** The page asked for, once: taking it clears it. */
export function takeMusicTarget(): MusicTarget | undefined {
  const t = target?.value;
  target = undefined;
  return t;
}

export function useMusicTargetSignal(): number {
  return useSyncExternalStore(subscribe, () => target?.n ?? 0, () => 0);
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
