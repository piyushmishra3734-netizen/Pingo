import type { ProfileSong } from '@pingo/core';
import { useEffect, useSyncExternalStore } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';
import { demoOn } from '../../screens/dev/demo-services.js';

/**
 * Notes, from the app's side: a short line (and a song) on your circle in the
 * story tray for 24 hours. Who may see one is decided in the database
 * (20261112000000_notes); these are thin calls.
 */

export const NOTE_MAX = 60;
export type NoteAudience = 'friends' | 'close';

export interface Note {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | undefined;
  body: string;
  song: ProfileSong | undefined;
  audience: NoteAudience;
  createdAt: number;
  expiresAt: number;
}

interface Row {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  body: string;
  song: ProfileSong | null;
  audience: NoteAudience;
  created_at: string;
  expires_at: string;
}

type Reply<T> = Promise<{ data: T | null; error: { message: string } | null }>;
interface Loose {
  rpc: (fn: string, args?: Record<string, unknown>) => Reply<unknown>;
  from: (table: string) => {
    select: (cols: string) => { maybeSingle: () => Reply<Row | null> };
  };
}
const db = () => getSupabaseClient() as unknown as Loose;

const toNote = (row: Row): Note => ({
  userId: row.user_id,
  username: row.username,
  name: row.display_name,
  avatarUrl: row.avatar_url ?? undefined,
  body: row.body,
  song: row.song ?? undefined,
  audience: row.audience,
  createdAt: Date.parse(row.created_at),
  expiresAt: Date.parse(row.expires_at),
});

interface State {
  mine: Note | undefined;
  feed: Note[];
}
let state: State = { mine: undefined, feed: [] };
const listeners = new Set<() => void>();
const publish = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};

/** The demo has no server: a couple of notes, and yours kept in memory. */
const DEMO_FEED: Note[] = [
  { userId: 'u-baani', username: 'baani', name: 'Baani', avatarUrl: undefined, body: 'chai > coffee, fight me', song: undefined, audience: 'friends', createdAt: Date.now() - 3_600_000, expiresAt: Date.now() + 20 * 3_600_000 },
  { userId: 'u-rohit', username: 'rohit', name: 'Rohit', avatarUrl: undefined, body: 'Sunday reset', song: { name: 'Raataan Lambiyan', artist: 'Jubin Nautiyal', img: '', url: '', secs: 230 }, audience: 'friends', createdAt: Date.now() - 7_200_000, expiresAt: Date.now() + 18 * 3_600_000 },
];

export async function refreshNotes(): Promise<void> {
  if (demoOn()) {
    if (state.feed.length === 0) publish({ ...state, feed: DEMO_FEED });
    return;
  }
  try {
    const [feed, mine] = await Promise.all([db().rpc('notes_feed'), db().from('notes').select('*').maybeSingle()]);
    const row = mine.data;
    publish({
      feed: ((feed.data as Row[] | null) ?? []).map(toNote),
      mine: row && Date.parse(row.expires_at) > Date.now() ? toNote(row) : undefined,
    });
  } catch {
    /* offline: keep what is on screen */
  }
}

export async function saveNote(input: { body: string; song: ProfileSong | undefined; audience: NoteAudience }): Promise<string | undefined> {
  const body = input.body.trim().slice(0, NOTE_MAX);
  if (demoOn()) {
    publish({
      ...state,
      mine: { userId: 'u-me', username: 'me', name: 'You', avatarUrl: undefined, body, song: input.song, audience: input.audience, createdAt: Date.now(), expiresAt: Date.now() + 24 * 3_600_000 },
    });
    return undefined;
  }
  const { error } = await db().rpc('note_set', { p_body: body, p_song: input.song ?? null, p_audience: input.audience });
  if (error) return error.message;
  await refreshNotes();
  return undefined;
}

export async function clearNote(): Promise<void> {
  publish({ ...state, mine: undefined });
  if (!demoOn()) await db().rpc('note_clear');
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Notes for the tray; refreshed on mount and whenever the app comes back to the front. */
export function useNotes(): State {
  useEffect(() => {
    void refreshNotes();
    const back = () => {
      if (document.visibilityState === 'visible') void refreshNotes();
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

/** Signing out must not leave the last person's notes on screen. */
export function resetNotes(): void {
  publish({ mine: undefined, feed: [] });
}
