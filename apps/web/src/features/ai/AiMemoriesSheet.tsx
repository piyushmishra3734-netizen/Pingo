import { useProfile } from '@pingo/core';
import { Button, cn } from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';

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
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(undefined);
    try {
      const { data, error: err } = await getSupabaseClient()
        .from('ai_memories')
        .select('id, key, value')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setRows((data as Memory[]) ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load memories.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const addMemory = async () => {
    if (!profile || !newValue.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const key = (
        newKey.trim() ||
        newValue
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s]/gi, ' ')
          .trim()
          .split(/\s+/)
          .slice(0, 3)
          .join('_') ||
        'note'
      ).slice(0, 80);
      const { error: err } = await getSupabaseClient().from('ai_memories').insert({
        user_id: profile.id,
        key,
        value: newValue.trim().slice(0, 500),
      });
      if (err) throw err;
      setAdding(false);
      setNewKey('');
      setNewValue('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add.');
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
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? 'Cancel' : 'Add memory'}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => void load()}>
            Refresh
          </Button>
        </div>

        {adding && (
          <div className="space-y-2 rounded-2xl border border-line/50 bg-sunken px-3 py-3">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.slice(0, 40))}
              placeholder="Label (optional)"
              className="focus-ring w-full rounded-xl border border-line/50 bg-surface px-2.5 py-2 text-body text-ink"
            />
            <textarea
              value={newValue}
              onChange={(e) => setNewValue(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="What should they remember?"
              className="focus-ring w-full resize-none rounded-xl border border-line/50 bg-surface px-2.5 py-2 text-body text-ink"
            />
            <Button
              variant="primary"
              className="w-full"
              disabled={busy || !newValue.trim()}
              onClick={() => void addMemory()}
            >
              Save
            </Button>
          </div>
        )}

        {loading && (
          <p className="text-center text-caption text-text-tertiary">Loading…</p>
        )}

        {!loading && rows.length === 0 && (
          <p className="rounded-2xl border border-line/50 bg-sunken px-3 py-4 text-center text-caption text-text-tertiary">
            Empty for now. Chat me “yaad rakh …” bolo ya yahan Add karo — auto-save nahi hota.
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
