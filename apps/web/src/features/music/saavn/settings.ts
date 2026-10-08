import { useSyncExternalStore } from 'react';

import { currentTaste } from './library.js';
import { homeLanguages } from './taste.js';

/**
 * PINGO Music's settings, kept on the phone: how good the sound is when
 * streaming and when downloading, and which languages home is in.
 *
 * Local only, on purpose. Quality is about this phone's data plan and storage,
 * not the person: the same account on wifi at home and on a prepaid phone
 * wants different answers.
 */

export type StreamQuality = 'auto' | 'high' | 'normal' | 'saver';
export type DownloadQuality = 'high' | 'normal';

export interface MusicSettings {
  stream: StreamQuality;
  download: DownloadQuality;
  /** Languages home is in. Empty: worked out from what somebody plays. */
  languages: string[];
}

/** The languages JioSaavn has a home for, in the order people in India look for them. */
export const LANGUAGES = [
  'hindi',
  'english',
  'punjabi',
  'tamil',
  'telugu',
  'marathi',
  'gujarati',
  'bengali',
  'kannada',
  'bhojpuri',
  'malayalam',
  'urdu',
  'haryanvi',
  'rajasthani',
  'odia',
  'assamese',
] as const;

const KEY = 'pingo:music-settings:v1';
const defaults = (): MusicSettings => ({ stream: 'auto', download: 'high', languages: [] });

function load(): MusicSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults(), ...(JSON.parse(raw) as Partial<MusicSettings>) } : defaults();
  } catch {
    return defaults();
  }
}

let state: MusicSettings = typeof localStorage === 'undefined' ? defaults() : load();
const listeners = new Set<() => void>();

export function setMusicSettings(change: Partial<MusicSettings>) {
  state = { ...state, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the choice holds for this session.
  }
  listeners.forEach((l) => l());
}

export const musicSettings = () => state;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useMusicSettings(): MusicSettings {
  return useSyncExternalStore(subscribe, musicSettings, musicSettings);
}

/** The languages to ask home in: the ones chosen, else the ones somebody listens to. */
export function currentHomeLanguages(): string[] {
  return state.languages.length ? state.languages : homeLanguages(currentTaste());
}
