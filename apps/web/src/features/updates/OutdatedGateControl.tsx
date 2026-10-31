import { Button, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { CLIENT_GENERATION } from '../../lib/update-required.js';

/**
 * Controlling's switch for the outdated-version gate (`app_gate.min_gen`).
 *
 * On, every build older than this one's generation is refused by the database
 * and told to update; off, everything works. It asks before turning on, because
 * on is the one setting here that stops people using the app.
 */
export function OutdatedGateControl() {
  const confirm = useConfirm();
  const [minGen, setMinGen] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void Promise.resolve(getSupabaseClient().from('app_gate' as never).select('min_gen').maybeSingle()).then(
      ({ data }) => setMinGen((data as { min_gen?: number } | null)?.min_gen ?? 0),
      () => setMinGen(0),
    );
  }, []);

  const on = (minGen ?? 0) >= CLIENT_GENERATION;

  const set = async (next: number) => {
    if (next > 0) {
      const ok = await confirm({
        title: 'Block outdated versions?',
        description:
          'Every app older than this build stops working and shows "update required". Only do this once the new APK is on the download page.',
        confirmLabel: 'Block them',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(undefined);
    const { error: failed } = await getSupabaseClient()
      .from('app_gate' as never)
      .update({ min_gen: next, updated_at: new Date().toISOString() } as never)
      .eq('id' as never, true as never);
    setBusy(false);
    if (failed) setError(failed.message);
    else setMinGen(next);
  };

  return (
    <section className="mb-4 rounded-lg bg-surface p-3 shadow-sm">
      <h2 className="text-body font-semibold text-ink">Outdated versions</h2>
      <p className="mt-1 text-caption text-text-secondary">
        {minGen === undefined
          ? 'Checking…'
          : on
            ? 'Blocked: apps older than this build are told to update and cannot be used.'
            : 'Allowed: every version still works.'}
      </p>
      <p className="mt-1 text-[12px] text-text-tertiary">
        This build is generation {CLIENT_GENERATION}. Old APKs cannot show a new screen; they stop working, and their own Update
        prompt tells them why - so publish the update prompt above first.
      </p>
      {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
      <Button
        variant="secondary"
        size="sm"
        className={cn('mt-3 w-full', !on && 'border-danger/40 text-danger')}
        disabled={busy || minGen === undefined}
        onClick={() => void set(on ? 0 : CLIENT_GENERATION)}
      >
        {busy ? 'Saving…' : on ? 'Allow outdated versions again' : 'Block outdated versions'}
      </Button>
    </section>
  );
}
