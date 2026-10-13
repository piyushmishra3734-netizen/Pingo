import { useProfile } from '@pingo/core';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import type { AiProfileRow } from '../../../lib/supabase/types.js';
import { pushRecentLanguage } from '../personalities.js';

/**
 * The person's PINGO AI settings (`ai_profiles`), loaded once and saved a
 * field at a time. The same row and the same write as the profile sheet, so
 * either screen can change a setting and the other sees it next time.
 */
export function useAiPrefs() {
  const { profile } = useProfile();
  const [prefs, setPrefs] = useState<Partial<AiProfileRow>>({});
  const [memoryCount, setMemoryCount] = useState(0);
  const [error, setError] = useState<string>();

  const refreshMemoryCount = useCallback(() => {
    if (!profile) return;
    void getSupabaseClient()
      .from('ai_memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .then(({ count }) => setMemoryCount(count ?? 0));
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    void getSupabaseClient()
      .from('ai_profiles')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs(data);
      });
    refreshMemoryCount();
  }, [profile, refreshMemoryCount]);

  const save = useCallback(
    async (patch: Partial<AiProfileRow>) => {
      if (!profile) return;
      if (patch.personality && patch.personality !== 'custom') patch = { ...patch, custom_personality: null };
      const next = { ...prefs, ...patch };
      setPrefs(next);
      setError(undefined);
      if (next.language) pushRecentLanguage(next.language);
      const { error: writeError } = await getSupabaseClient()
        .from('ai_profiles')
        .upsert({
          user_id: profile.id,
          display_name: next.display_name?.trim() || null,
          bio: next.bio?.trim() ? next.bio.trim().slice(0, 160) : null,
          personality: next.personality ?? 'friendly',
          custom_personality: (next.personality ?? 'friendly') === 'custom' ? (next.custom_personality ?? null) : null,
          response_length: next.response_length ?? 'short',
          preferred_name: next.preferred_name ?? null,
          language: next.language ?? null,
          memory_enabled: next.memory_enabled ?? true,
          avatar_url: next.avatar_url ?? null,
          banner_url: next.banner_url ?? null,
          updated_at: new Date().toISOString(),
        });
      if (writeError) setError(writeError.message);
    },
    [profile, prefs],
  );

  const resetMemory = useCallback(async () => {
    if (!profile) return;
    await getSupabaseClient().from('ai_memories').delete().eq('user_id', profile.id);
    setMemoryCount(0);
  }, [profile]);

  return { prefs, save, memoryCount, refreshMemoryCount, resetMemory, error };
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
