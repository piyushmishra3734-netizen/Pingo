import { useProfile } from '@pingo/core';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import type { AiProfileRow } from '../../../lib/supabase/types.js';
import { pushRecentLanguage } from '../personalities.js';
import { toAiProfileUpsert } from '../profile/ai-profile-model.js';

/**
 * The person's PINGO AI settings (`ai_profiles`), one copy for the whole app.
 *
 * Every screen that shows or changes them (the profile page, settings, the
 * chat header's face) reads this store, so a change made anywhere shows
 * everywhere at once. Loaded once per account; saved as the whole row, so a
 * save never blanks a column another screen set.
 */
type Prefs = Partial<AiProfileRow>;
const store = {
  userId: undefined as string | undefined,
  prefs: {} as Prefs,
  loaded: false,
  loading: undefined as Promise<void> | undefined,
  memoryCount: 0,
  error: undefined as string | undefined,
  listeners: new Set<() => void>(),
  version: 0,
};
const emit = () => {
  store.version += 1;
  store.listeners.forEach((l) => l());
};

function loadFor(userId: string): Promise<void> {
  if (store.userId === userId && store.loading) return store.loading;
  store.userId = userId;
  store.prefs = {};
  store.loaded = false;
  store.loading = (async () => {
    const client = getSupabaseClient();
    const [{ data, error }, { count }] = await Promise.all([
      client.from('ai_profiles').select('*').eq('user_id', userId).maybeSingle(),
      client.from('ai_memories').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);
    if (store.userId !== userId) return;
    if (error) store.error = error.message;
    if (data) {
      store.prefs = data;
      if (data.voice) setAiVoice(data.voice);
    }
    store.memoryCount = count ?? 0;
    store.loaded = true;
    emit();
  })().catch((cause: unknown) => {
    store.error = cause instanceof Error ? cause.message : 'Could not load PINGO AI settings.';
    store.loaded = true;
    emit();
  });
  return store.loading;
}

/** Save a change. Resolves with the error message, or undefined when it landed. */
export async function saveAiPrefs(patch: Prefs): Promise<string | undefined> {
  const userId = store.userId;
  if (!userId) return 'Sign in first.';
  if (store.loading) await store.loading;
  if (patch.personality && patch.personality !== 'custom') patch = { ...patch, custom_personality: null };
  const before = store.prefs;
  const next = { ...before, ...patch };
  store.prefs = next;
  store.error = undefined;
  emit();
  if (patch.language) pushRecentLanguage(patch.language);
  if (patch.voice) setAiVoice(patch.voice);
  const { error } = await getSupabaseClient().from('ai_profiles').upsert(toAiProfileUpsert(userId, next));
  if (error) {
    // The row did not change, so neither does the screen.
    store.prefs = before;
    store.error = error.message;
    emit();
    return error.message;
  }
  return undefined;
}

export function setAiMemoryCount(n: number): void {
  store.memoryCount = n;
  emit();
}

export function useAiPrefs() {
  const { profile } = useProfile();
  useEffect(() => {
    if (profile && store.userId !== profile.id) void loadFor(profile.id);
  }, [profile]);
  useSyncExternalStore(
    (l) => {
      store.listeners.add(l);
      return () => store.listeners.delete(l);
    },
    () => store.version,
  );

  const refreshMemoryCount = useCallback(() => {
    if (!profile) return;
    void getSupabaseClient()
      .from('ai_memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .then(({ count }) => setAiMemoryCount(count ?? 0));
  }, [profile]);

  const resetMemory = useCallback(async () => {
    if (!profile) return;
    const { error } = await getSupabaseClient().from('ai_memories').delete().eq('user_id', profile.id);
    if (!error) setAiMemoryCount(0);
  }, [profile]);

  const mine = profile && store.userId === profile.id;
  return {
    prefs: mine ? store.prefs : ({} as Prefs),
    loaded: Boolean(mine && store.loaded),
    save: saveAiPrefs,
    memoryCount: mine ? store.memoryCount : 0,
    refreshMemoryCount,
    resetMemory,
    error: store.error,
  };
}

/* ---------- the call voice, per device ---------- */

/** OpenAI's realtime voices, with how each one sounds. */
export const AI_VOICES = [
  { id: 'marin', label: 'Marin', hint: 'Warm and clear' },
  { id: 'cedar', label: 'Cedar', hint: 'Calm and deep' },
  { id: 'coral', label: 'Coral', hint: 'Bright and friendly' },
  { id: 'sage', label: 'Sage', hint: 'Soft and thoughtful' },
  { id: 'verse', label: 'Verse', hint: 'Lively and expressive' },
  { id: 'ash', label: 'Ash', hint: 'Steady and relaxed' },
] as const;

const VOICE_KEY = 'pingo.ai.voice';
const voiceListeners = new Set<() => void>();

function readVoice(): string {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    if (v && AI_VOICES.some((x) => x.id === v)) return v;
  } catch {
    /* private mode */
  }
  return AI_VOICES[0].id;
}

export function setAiVoice(id: string): void {
  try {
    localStorage.setItem(VOICE_KEY, id);
  } catch {
    /* this session only */
  }
  voiceListeners.forEach((l) => l());
}

export function useAiVoice(): string {
  return useSyncExternalStore(
    (l) => {
      voiceListeners.add(l);
      return () => voiceListeners.delete(l);
    },
    readVoice,
  );
}
