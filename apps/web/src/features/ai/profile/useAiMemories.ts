import { useProfile } from '@pingo/core';
import { useCallback, useEffect, useState } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import { setAiMemoryCount } from '../room/ai-prefs.js';
import { MEMORY_CAP, memoryKey, parseMemoryImport } from './ai-profile-model.js';

export interface AiMemory {
  id: string;
  value: string;
  created_at: string;
}

/**
 * What PINGO AI remembers about this person: `ai_memories`, their rows only
 * (RLS). The same table the chat reads with recall_memory and writes with
 * save_memory, so a delete here is a thing it no longer knows.
 */
export function useAiMemories() {
  const { profile } = useProfile();
  const [rows, setRows] = useState<AiMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(undefined);
    const { data, error: err } = await getSupabaseClient()
      .from('ai_memories')
      .select('id, value, created_at')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else {
      const list = (data ?? []) as AiMemory[];
      setRows(list);
      setAiMemoryCount(list.length);
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(
    async (value: string): Promise<string | undefined> => {
      if (!profile) return 'Sign in first.';
      const v = value.replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!v) return 'Write something to remember.';
      if (rows.length >= MEMORY_CAP) return `PINGO AI keeps up to ${MEMORY_CAP} memories. Delete one first.`;
      const { error: err } = await getSupabaseClient().from('ai_memories').insert({ user_id: profile.id, key: memoryKey(v), value: v });
      if (err) return err.message;
      await load();
      return undefined;
    },
    [profile, rows.length, load],
  );

  const remove = useCallback(
    async (id: string): Promise<string | undefined> => {
      const before = rows;
      setRows((r) => r.filter((m) => m.id !== id));
      const { error: err } = await getSupabaseClient().from('ai_memories').delete().eq('id', id);
      if (err) {
        setRows(before);
        return err.message;
      }
      setAiMemoryCount(before.length - 1);
      return undefined;
    },
    [rows],
  );

  const clear = useCallback(async (): Promise<string | undefined> => {
    if (!profile) return 'Sign in first.';
    const { error: err } = await getSupabaseClient().from('ai_memories').delete().eq('user_id', profile.id);
    if (err) return err.message;
    setRows([]);
    setAiMemoryCount(0);
    return undefined;
  }, [profile]);

  /** Text or a file's contents; answers how many were added, or why none. */
  const importText = useCallback(
    async (raw: string): Promise<{ added: number; error?: string }> => {
      if (!profile) return { added: 0, error: 'Sign in first.' };
      const room = MEMORY_CAP - rows.length;
      if (room <= 0) return { added: 0, error: `PINGO AI keeps up to ${MEMORY_CAP} memories. Delete some first.` };
      const items = parseMemoryImport(raw, rows.map((r) => r.value), room);
      if (!items.length) return { added: 0, error: 'Nothing new to import.' };
      const { error: err } = await getSupabaseClient()
        .from('ai_memories')
        .insert(items.map((m) => ({ user_id: profile.id, key: m.key, value: m.value })));
      if (err) return { added: 0, error: err.message };
      await load();
      return { added: items.length };
    },
    [profile, rows, load],
  );

  return { rows, loading, error, reload: load, add, remove, clear, importText };
}
