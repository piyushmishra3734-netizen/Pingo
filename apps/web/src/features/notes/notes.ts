import type { ProfileSong } from '@pingo/core';
import { useEffect, useSyncExternalStore } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';
import { demoOn } from '../../screens/dev/demo-services.js';

/**
 * Notes, from the app's side: a short line (and a song) on your circle in the
 * story tray for 24 hours. Who may see one is decided in the database
 * (20261112000000_notes); these are thin calls.
 */

export const NOTE_MAX = 100;
export type NoteAudience = 'friends' | 'close';

/**
 * The few looks a note's bubble can have. The database stores only the id (and
 * refuses any other); what each one looks like is decided here. Quiet on
 * purpose: a tint of one colour over the app's dark surface, never a gradient.
 * `default` is no tint at all: the bubble as the theme draws it.
 */
export type NoteBg = 'default' | 'rose' | 'ocean' | 'forest' | 'amber' | 'violet';
export const NOTE_BGS: { id: NoteBg; label: string; bg: string; ink: string }[] = [
  { id: 'default', label: 'Plain', bg: '', ink: '' },
  { id: 'rose', label: 'Rose', bg: '#3a1b2c', ink: '#ffd9ea' },
  { id: 'ocean', label: 'Ocean', bg: '#16293a', ink: '#d6ecff' },
  { id: 'forest', label: 'Forest', bg: '#16301f', ink: '#d9f5df' },
  { id: 'amber', label: 'Amber', bg: '#3a2d14', ink: '#ffeccb' },
  { id: 'violet', label: 'Violet', bg: '#271f3d', ink: '#e6dcff' },
];
export const noteBg = (id: string | undefined) => NOTE_BGS.find((b) => b.id === id) ?? NOTE_BGS[0]!;

/** "21h left", "40m left", "ending now": what is left of a note's 24 hours. */
export function timeLeft(expiresAt: number, now = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 60_000) return 'ending now';
  const minutes = Math.round(ms / 60_000);
  return minutes >= 90 ? `${Math.round(minutes / 60)}h left` : `${minutes}m left`;
}

/** Characters as a person counts them: an emoji is one, not the two units a string says. */
export const noteLength = (text: string): number => Array.from(text).length;
/** At most NOTE_MAX characters, never cutting an emoji in half. */
export const clampNote = (text: string): string => Array.from(text).slice(0, NOTE_MAX).join('');

export interface Note {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | undefined;
  body: string;
  song: ProfileSong | undefined;
  audience: NoteAudience;
  bg: NoteBg;
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
  bg?: string | null;
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
  bg: noteBg(row.bg ?? undefined).id,
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
  { userId: 'u-baani', username: 'baani', name: 'Baani', avatarUrl: undefined, body: 'chai > coffee, fight me', song: undefined, audience: 'friends', bg: 'default', createdAt: Date.now() - 3_600_000, expiresAt: Date.now() + 20 * 3_600_000 },
  { userId: 'u-rohit', username: 'rohit', name: 'Rohit', avatarUrl: undefined, body: 'Sunday reset, long walk, no phone, only chai', song: { name: 'Raataan Lambiyan', artist: 'Jubin Nautiyal', img: '', url: '', secs: 230 }, audience: 'friends', bg: 'default', createdAt: Date.now() - 7_200_000, expiresAt: Date.now() + 18 * 3_600_000 },
];

/** Notes change slowly; going back to Chats must not ask for them again every time. */
const FRESH_MS = 30_000;
let refreshedAt = 0;

export async function refreshNotes(force = false): Promise<void> {
  if (!force && Date.now() - refreshedAt < FRESH_MS) return;
  refreshedAt = Date.now();
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

export async function saveNote(input: { body: string; song: ProfileSong | undefined; audience: NoteAudience; bg: NoteBg }): Promise<string | undefined> {
  const body = clampNote(input.body.trim());
  if (demoOn()) {
    publish({
      ...state,
      mine: { userId: 'u-me', username: 'me', name: 'You', avatarUrl: undefined, body, song: input.song, audience: input.audience, bg: input.bg, createdAt: Date.now(), expiresAt: Date.now() + 24 * 3_600_000 },
    });
    return undefined;
  }
  const { error } = await db().rpc('note_set', { p_body: body, p_song: input.song ?? null, p_audience: input.audience, p_bg: input.bg });
  if (error) return error.message;
  await refreshNotes(true);
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
    // A note ends at 24 hours whether or not anybody reopens the app: drop it from the screen when it does.
    const sweep = setInterval(dropExpired, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', back);
      clearInterval(sweep);
    };
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

/** Takes notes whose 24 hours are up off the screen without asking the server. */
export function dropExpired(): void {
  const now = Date.now();
  const mine = state.mine && state.mine.expiresAt > now ? state.mine : undefined;
  const feed = state.feed.filter((n) => n.expiresAt > now);
  if (mine !== state.mine || feed.length !== state.feed.length) publish({ mine, feed });
}

/** Signing out must not leave the last person's notes on screen. */
export function resetNotes(): void {
  refreshedAt = 0;
  publish({ mine: undefined, feed: [] });
}
