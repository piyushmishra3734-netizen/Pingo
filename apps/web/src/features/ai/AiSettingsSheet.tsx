import { useProfile } from '@pingo/core';
import { Button, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import type { AiProfileRow } from '../../lib/supabase/types.js';

const LENGTHS: { id: AiProfileRow['response_length']; label: string }[] = [
  { id: 'short', label: 'Short' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'detailed', label: 'Detailed' },
];

const PERSONALITIES = [
  'friendly',
  'genz',
  'coach',
  'study',
  'calm',
  'funny',
  'motivator',
  'creative',
  'custom',
] as const;

/**
 * Change name, vibe, length - still a person, not a model control panel.
 */
export function AiSettingsSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useProfile();
  const [row, setRow] = useState<Partial<AiProfileRow>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!profile) return;
    void getSupabaseClient()
      .from('ai_profiles')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setRow(data);
      });
  }, [profile]);

  const save = async () => {
    if (!profile) return;
    setBusy(true);
    setError(undefined);
    try {
      const { error: writeError } = await getSupabaseClient()
        .from('ai_profiles')
        .upsert({
          user_id: profile.id,
          display_name: (row.display_name ?? 'PINGO').trim() || 'PINGO',
          personality: row.personality ?? 'friendly',
          custom_personality: row.custom_personality ?? null,
          response_length: row.response_length ?? 'short',
          preferred_name: row.preferred_name ?? null,
          memory_enabled: row.memory_enabled ?? false,
          updated_at: new Date().toISOString(),
        });
      if (writeError) throw writeError;
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="About them" description="How this chat feels." onClose={onClose}>
      <div className="mt-3 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-caption font-medium text-text-secondary">
            Name
          </span>
          <input
            value={row.display_name ?? 'PINGO'}
            onChange={(e) => setRow((r) => ({ ...r, display_name: e.target.value.slice(0, 40) }))}
            className="focus-ring w-full rounded-xl border border-line/50 bg-sunken px-3 py-2.5 text-body text-ink"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-caption font-medium text-text-secondary">
            Personality
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PERSONALITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setRow((r) => ({ ...r, personality: p }))}
                className={cn(
                  'rounded-full px-3 py-1.5 text-caption font-medium capitalize',
                  (row.personality ?? 'friendly') === p
                    ? 'bg-selected text-brand'
                    : 'bg-sunken text-text-secondary',
                )}
              >
                {p === 'genz' ? 'Gen Z' : p}
              </button>
            ))}
          </div>
        </div>

        {(row.personality ?? 'friendly') === 'custom' && (
          <textarea
            value={row.custom_personality ?? ''}
            onChange={(e) =>
              setRow((r) => ({ ...r, custom_personality: e.target.value.slice(0, 200) }))
            }
            rows={2}
            placeholder="Describe the vibe"
            className="focus-ring w-full resize-none rounded-xl border border-line/50 bg-sunken px-3 py-2 text-body text-ink"
          />
        )}

        <div>
          <span className="mb-1.5 block text-caption font-medium text-text-secondary">
            Reply length
          </span>
          <div className="flex gap-1.5">
            {LENGTHS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setRow((r) => ({ ...r, response_length: l.id }))}
                className={cn(
                  'flex-1 rounded-full py-2 text-caption font-medium',
                  (row.response_length ?? 'short') === l.id
                    ? 'bg-selected text-brand'
                    : 'bg-sunken text-text-secondary',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-line/50 bg-surface px-3 py-3">
          <span>
            <span className="block text-body text-ink">Remember things I share</span>
            <span className="block text-caption text-text-tertiary">
              Only with your permission. You can clear it later.
            </span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(row.memory_enabled)}
            onChange={(e) => setRow((r) => ({ ...r, memory_enabled: e.target.checked }))}
            className="size-5 accent-brand"
          />
        </label>

        {error && (
          <p className="text-center text-caption text-danger/90" role="alert">
            {error}
          </p>
        )}

        <Button variant="primary" className="w-full" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Sheet>
  );
}
