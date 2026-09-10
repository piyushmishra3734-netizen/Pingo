import { cn } from '@pingo/ui';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Group, SettingsPage } from '../../features/settings/controls.js';
import {
  backfillAccountWraps,
  type BackfillReport,
} from '../../lib/crypto/account-backfill.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Make this device's history readable on the next one.
 *
 * ## Why anybody needs this
 *
 * Messages are wrapped to devices, and to one key per account so that history
 * survives a lost phone. On 2026-09-09 a first-run mint replaced that account
 * key for the two accounts that had enrolled in the old Secure Backup, and
 * every wrap made to the old key stopped opening. The messages are all still
 * there and every existing device still reads them; what broke is the path a
 * *new* device takes.
 *
 * This screen walks the messages this device can open and adds a wrap for the
 * current account key to each one. Nothing is decrypted, nothing is re-sent,
 * and no existing message is modified - see `account-backfill.ts`.
 *
 * ## It is not linked from anywhere
 *
 * Two accounts are affected and both are known. A permanent entry in Settings
 * would ask everybody else to wonder whether their history is broken, which is
 * a worse outcome than a URL handed to the two people who need it. If this ever
 * stops being a two-account problem, that is the moment to link it.
 *
 * ## The query parameters are how it gets tested
 *
 * `?max=` bounds the number of batches and `?batch=` their size, so the first
 * careful runs - one message, then two hundred and fifty - are a URL rather
 * than a build with test scaffolding in it. `?dry=1` does everything except
 * store the wraps. Absent, it simply runs to completion and can be resumed.
 */
export function RestoreHistoryScreen() {
  const [params] = useSearchParams();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<BackfillReport | undefined>();
  const [live, setLive] = useState<BackfillReport | undefined>();

  const batch = Number(params.get('batch')) || undefined;
  const max = Number(params.get('max')) || undefined;
  const dryRun = params.get('dry') === '1';

  const run = useCallback(async () => {
    setRunning(true);
    setReport(undefined);
    try {
      const result = await backfillAccountWraps(getSupabaseClient(), {
        batch,
        maxBatches: max,
        dryRun,
        onProgress: setLive,
      });
      setReport(result);
    } finally {
      setRunning(false);
    }
  }, [batch, max, dryRun]);

  const shown = report ?? live;

  return (
    <SettingsPage title="Restore older messages">
      <Group>
        <p className="px-4 py-3 text-body text-text-secondary">
          This device can read messages that a newly signed-in browser cannot. Running
          this adds a key for your account to each of them, so your next device opens
          the same history. Your messages are not decrypted, re-sent, or changed.
        </p>
      </Group>

      <Group>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className={cn(
            'focus-ring w-full px-4 py-3 text-left text-body font-medium',
            running ? 'text-text-tertiary' : 'text-brand hover:bg-hover active:bg-pressed',
          )}
        >
          {running ? 'Working…' : dryRun ? 'Start (dry run)' : 'Start'}
        </button>
      </Group>

      {shown && (
        <Group>
          <dl className="divide-y divide-line">
            <Row label="Messages examined" value={shown.scanned} />
            <Row label="Keys added" value={shown.added} />
            <Row label="Already had one" value={shown.skipped} />
            <Row label="Refused" value={shown.denied} />
            <Row label="Could not be read here" value={shown.unreadable} />
            <Row label="Rounds" value={shown.batches} />
            <Row
              label="Finished"
              value={report ? (report.complete ? 'yes' : 'stopped early') : 'running'}
            />
          </dl>
        </Group>
      )}

      {report && !report.complete && report.cursor && (
        <p className="px-4 py-3 text-caption text-text-tertiary">
          Stopped at {report.cursor}. Running this again continues from there, and
          messages that already have a key are skipped.
        </p>
      )}
    </SettingsPage>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-body text-text-secondary">{label}</dt>
      <dd className="text-body tabular-nums text-ink">{value}</dd>
    </div>
  );
}
