import type { StoryDraft } from '@pingo/core';
import { useEffect, useState } from 'react';

import { STORE, localDelete, localGet, localKeys, localSet } from '../../lib/local/db.js';

/**
 * Stories that did not post, kept on this phone until they do.
 *
 * A story is made in the editor and handed off in the background, so by the
 * time an upload fails the editor is long gone - and with it the picture, the
 * text, the stickers and the song. "Your story did not post" with a Retry that
 * vanishes after six seconds meant one bad signal cost the whole thing. Now
 * the finished draft is written down the moment it fails, and waits under
 * Drafts in "Add to story" to be posted again or thrown away.
 *
 * ## In the media store, keyed by account
 *
 * The draft is mostly Blobs - the photo or clip, any recorded sound - which is
 * what the media store is for; `localStorage` would need them as strings and
 * could not hold a video anyway. The key carries the account, so a phone shared
 * between two accounts never offers one person's story to the other.
 *
 * ## Only what failed
 *
 * Nothing is saved while an upload is on its way; a story that posts leaves no
 * trace here. And the list is capped, oldest dropped, so a phone that has been
 * offline for a week does not quietly fill up with video.
 */

export interface StoryDraftRecord {
  id: string;
  savedAt: number;
  draft: StoryDraft;
}

const MAX_DRAFTS = 12;

const prefix = (userId: string) => `story-draft|${userId}|`;
const range = (userId: string) => IDBKeyRange.bound(prefix(userId), `${prefix(userId)}￿`);

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export async function listStoryDrafts(userId: string): Promise<StoryDraftRecord[]> {
  const keys = await localKeys(STORE.media, range(userId)).catch(() => []);
  const rows = await Promise.all(keys.map((key) => localGet<StoryDraftRecord>(STORE.media, key).catch(() => undefined)));
  return rows.filter((row): row is StoryDraftRecord => !!row?.draft?.media).sort((a, b) => b.savedAt - a.savedAt);
}

/** Saves a draft that failed to post, or refreshes one that failed again. Resolves to its id. */
export async function saveStoryDraft(userId: string, draft: StoryDraft, id?: string): Promise<string | undefined> {
  const record: StoryDraftRecord = { id: id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, savedAt: Date.now(), draft };
  try {
    await localSet(STORE.media, prefix(userId) + record.id, record);
    const all = await listStoryDrafts(userId);
    if (!all.some((row) => row.id === record.id)) return undefined; // Storage refused it.
    await Promise.all(all.slice(MAX_DRAFTS).map((row) => localDelete(STORE.media, prefix(userId) + row.id)));
    return record.id;
  } catch {
    return undefined;
  } finally {
    changed();
  }
}

export async function deleteStoryDraft(userId: string, id: string): Promise<void> {
  await localDelete(STORE.media, prefix(userId) + id).catch(() => undefined);
  changed();
}

/** This account's drafts, newest first, kept current as they come and go. */
export function useStoryDrafts(userId: string | undefined): StoryDraftRecord[] {
  const [drafts, setDrafts] = useState<StoryDraftRecord[]>([]);
  useEffect(() => {
    if (!userId) return setDrafts([]);
    let live = true;
    const load = () => void listStoryDrafts(userId).then((rows) => { if (live) setDrafts(rows); });
    load();
    listeners.add(load);
    return () => { live = false; listeners.delete(load); };
  }, [userId]);
  return drafts;
}
