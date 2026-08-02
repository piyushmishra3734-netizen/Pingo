import { useProfile } from '@pingo/core';
import { Button, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { useConfirm } from '../../components/ConfirmProvider.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

type Memory = { id: string; key: string; value: string };

export function AiMemoriesSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useProfile();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Memory[]>([]);
  const [editing, setEditing] = useState<Memory>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => {
    if (!profile) return;
    const { data } = await getSupabaseClient()
      .from('ai_memories')
      .select('id, key, value')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
    setRows((data as Memory[]) ?? []);
  };

  useEffect(() => {
    void load();
  }, [profile?.id]);

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setError(undefined);
    try {
      const { error: err } = await getSupabaseClient()
        .from('ai_memories')
        .update({ value: draft.trim().slice(0, 500) })
        .eq('id', editing.id);
      if (err) throw err;
      setEditing(undefined);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const go = await confirm({
      title: 'Delete this memory?',
      description: 'They won’t use this fact in future chats.',
      confirmLabel: 'Delete',
    });
    if (!go) return;
    await getSupabaseClient().from('ai_memories').delete().eq('id', id);
    await load();
  };

  const forgetAll = async () => {
    if (!profile) return;
    const go = await confirm({
      title: 'Forget everything?',
      description: 'All saved notes about you for this chat are removed.',
      confirmLabel: 'Forget everything',
    });
    if (!go) return;
    await getSupabaseClient().from('ai_memories').delete().eq('user_id', profile.id);
    await load();
  };

  return (
    <Sheet
      title="Memories"
      description="Things they’ve kept, with your permission."
      onClose={onClose}
      elevated
    >
      <div className="mt-3 space-y-3">
        {rows.length === 0 && (
          <p className="rounded-2xl border border-line/50 bg-sunken px-3 py-4 text-center text-caption text-text-tertiary">
            Nothing saved yet. Chat with memory on, and notes show up here.
          </p>
        )}

        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-line/50 bg-surface px-3 py-2.5"
            >
              {editing?.id === row.id ? (
                <div className="space-y-2">
                  <p className="text-caption font-medium text-text-tertiary">{row.key}</p>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, 500))}
                    rows={2}
                    className="focus-ring w-full resize-none rounded-xl border border-line/50 bg-sunken px-2.5 py-2 text-body text-ink"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setEditing(undefined)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      disabled={busy || !draft.trim()}
                      onClick={() => void saveEdit()}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-caption font-medium text-text-tertiary">{row.key}</p>
                    <p className="mt-0.5 text-body text-ink">{row.value}</p>
                  </div>
                  <button
                    type="button"
                    className="focus-ring shrink-0 text-caption text-brand"
                    onClick={() => {
                      setEditing(row);
                      setDraft(row.value);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="focus-ring shrink-0 text-caption text-danger"
                    onClick={() => void remove(row.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {error && (
          <p className="text-center text-caption text-danger/90" role="alert">
            {error}
          </p>
        )}

        {rows.length > 0 && (
          <Button
            variant="secondary"
            className={cn('w-full text-danger')}
            onClick={() => void forgetAll()}
          >
            Forget everything
          </Button>
        )}
      </div>
    </Sheet>
  );
}
