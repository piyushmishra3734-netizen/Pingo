import { useSyncExternalStore } from 'react';
import type { MediaType, TmdbMedia } from '../types.js';

/**
 * What this person watched last, on this device: the "Continue Watching" rail
 * and the History tab. Kept in the browser, not the database, and honest about
 * what it knows: the embedded players give a page no clock, so it records the
 * title and the episode, never a minute.
 */

export interface WatchedItem {
  id: number;
  type: MediaType;
  title: string;
  poster: string | null;
  backdrop: string | null;
  overview: string;
  rating: number;
  year: string;
  /** Series only. */
  s?: number;
  e?: number;
  at: number;
}

const KEY = 'pingo:tv-history:v1';
const MAX = 40;

function read(): WatchedItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as WatchedItem[]).filter((w) => w && typeof w.id === 'number' && typeof w.title === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

let items: WatchedItem[] = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function recordWatched(media: TmdbMedia, type: MediaType, s?: number, e?: number) {
  const entry: WatchedItem = {
    id: media.id,
    type,
    title: media.title || media.name || 'Untitled',
    poster: media.poster_path,
    backdrop: media.backdrop_path,
    overview: media.overview ?? '',
    rating: media.vote_average ?? 0,
    year: (media.release_date || media.first_air_date || '').slice(0, 4),
    ...(type === 'tv' ? { s: s ?? 1, e: e ?? 1 } : {}),
    at: Date.now(),
  };
  items = [entry, ...items.filter((w) => !(w.id === entry.id && w.type === entry.type))].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Private mode: it holds for this visit.
  }
  emit();
}

export function clearWatched() {
  items = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  emit();
}

export function removeWatched(id: number, type: MediaType) {
  items = items.filter((w) => !(w.id === id && w.type === type));
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
  emit();
}

export function useWatchHistory(): WatchedItem[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => items,
    () => items,
  );
}

/** A history entry as the media the rest of the screen speaks. */
export const watchedAsMedia = (w: WatchedItem): TmdbMedia => ({
  id: w.id,
  ...(w.type === 'movie' ? { title: w.title } : { name: w.title }),
  overview: w.overview,
  poster_path: w.poster,
  backdrop_path: w.backdrop,
  vote_average: w.rating,
  media_type: w.type,
  ...(w.type === 'movie' ? { release_date: w.year ? `${w.year}-01-01` : '' } : { first_air_date: w.year ? `${w.year}-01-01` : '' }),
});
