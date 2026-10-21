import { useSyncExternalStore } from 'react';

import { available } from './innertube.js';

/**
 * Where PINGO Music gets its songs: JioSaavn, or YouTube Music.
 *
 * Asked once, the first time Music opens. YouTube Music only exists inside the
 * Android app (see `innertube.ts`), so anywhere else the question is not asked
 * and the answer is JioSaavn.
 *
 * ## It must not be the reason music stops
 *
 * YouTube's side is unofficial and can change under us, so a failure there is
 * normal, not exceptional. Calls fall back to JioSaavn one at a time (see
 * `api.ts`), and after a few failures in a row YouTube is left alone for a
 * while so a dead service does not slow every tap. Nothing here changes the
 * person's choice: it is a pause, and the next try after it is fresh.
 */

export type MusicSource = 'saavn' | 'ytm';

const KEY = 'pingo:music-source:v1';

function load(): MusicSource | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'saavn' || v === 'ytm' ? v : undefined;
  } catch {
    return undefined;
  }
}

let chosen: MusicSource | undefined = typeof localStorage === 'undefined' ? undefined : load();
const listeners = new Set<() => void>();

export function setMusicSource(source: MusicSource) {
  chosen = source;
  failures = 0;
  pausedUntil = 0;
  try {
    localStorage.setItem(KEY, source);
  } catch {
    // Storage blocked: the choice holds for this session.
  }
  listeners.forEach((l) => l());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

const snapshot = () => chosen;

/** What was chosen, or undefined if the question has not been answered. */
export function useMusicSource(): MusicSource | undefined {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Whether the first-open question should be asked. */
export const needsChoice = () => chosen === undefined && available();

/* ---------- a line for the person when it falls back ---------- */

const notices = new Set<(text: string) => void>();
/** The music sheet shows these as its toast. */
export function onYtmNotice(fn: (text: string) => void) {
  notices.add(fn);
  return () => {
    notices.delete(fn);
  };
}
export const ytmNotice = (text: string) => notices.forEach((fn) => fn(text));

/* ---------- the pause after YouTube fails ---------- */

const MAX_FAILURES = 3;
const PAUSE_MS = 3 * 60_000;
let failures = 0;
let pausedUntil = 0;

/** True when YouTube Music is the choice, can run here, and is not resting. */
export const ytmActive = (): boolean => chosen === 'ytm' && available() && Date.now() >= pausedUntil;

export function noteYtmFailure() {
  failures += 1;
  if (failures >= MAX_FAILURES) {
    pausedUntil = Date.now() + PAUSE_MS;
    failures = 0;
    listeners.forEach((l) => l());
  }
}

export const noteYtmOk = () => {
  failures = 0;
};

/** For the settings line: YouTube Music is chosen but is resting. */
export const ytmResting = () => chosen === 'ytm' && Date.now() < pausedUntil;
