import { useCallback, useEffect, useMemo, useState } from 'react';

import { EnrolmentFlow } from '../../features/backup/EnrolmentFlow.js';
import { Group, InfoRow, SettingsPage } from '../../features/settings/controls.js';
import { ServerBackupTarget } from '../../lib/backup/server-target.js';
import {
  disableSecureBackup,
  markBackedUp,
  secureBackupStatus,
  testRecovery,
  type RecoveryTestResult,
  type SecureBackupStatus,
} from '../../lib/backup/secure-backup.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Secure Backup.
 *
 * The enrolment sequence is not written here — it is `EnrolmentFlow`, shared
 * with onboarding, so the warning and the two-step order cannot drift between
 * the two places that offer the same operation.
 *
 * ## Test Recovery is a rehearsal, not a restore
 *
 * It opens the package with the entered code and throws the key away. Nothing
 * is decrypted, nothing is written, no identity changes. The question it
 * answers — "are the words I wrote down the words that work?" — is only useful
 * before the phone is lost, and almost nothing offers it.
 */
export function SecureBackupScreen() {
  const client = useMemo(() => getSupabaseClient(), []);
  const targets = useMemo(() => [new ServerBackupTarget(client)], [client]);

  const [status, setStatus] = useState<SecureBackupStatus | undefined>();
  const [enrolling, setEnrolling] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'disable' | 'test' | undefined>();
  const [error, setError] = useState<string | undefined>();

  const [testing, setTesting] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<RecoveryTestResult | undefined>();

  const refresh = useCallback(async () => {
    try {
      setStatus(await secureBackupStatus(targets));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read backup status.');
    }
  }, [targets]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enabled = status?.enabled ?? false;
  const local = status?.local;

  const runTest = async () => {
    setBusy('test');
    setResult(undefined);
    try {
      setResult(await testRecovery(code.trim(), targets));
    } finally {
      setBusy(undefined);
      // The code is never kept, not even in component state.
      setCode('');
    }
  };

  const backupNow = async () => {
    setBusy('backup');
    setError(undefined);
    try {
      await markBackedUp();
      await refresh();
    } finally {
      setBusy(undefined);
    }
  };

  const turnOff = async () => {
    setBusy('disable');
    setError(undefined);
    try {
      const outcome = await disableSecureBackup(targets);
      if (!outcome.removed) {
        setError(`Turned off on this device. ${outcome.problems.join('; ')}`);
      }
      await refresh();
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <SettingsPage title="Secure Backup">
      <Group title="Status">
        <InfoRow label="Status" value={enabled ? '✅ Enabled' : 'Not enabled'} />
        <InfoRow label="Recovery Version" value={local ? `v${local.version}` : '—'} />
        <InfoRow
          label="Backup Target"
          value={status?.targets.map((t) => t.label).join(', ') || '—'}
        />
        <InfoRow
          label="Last Backup"
          value={local?.lastBackupAt ? new Date(local.lastBackupAt).toLocaleString() : '—'}
        />
        {/*
          Masked, always. The code exists on paper or in the user's head; a
          screen that could redisplay it would make every unlocked phone a copy
          of it.
        */}
        <InfoRow label="Recovery Code" value={enabled ? '••••••••••••' : '—'} />
      </Group>

      {status?.mismatch ? (
        <Group title="Attention">
          <p className="px-4 py-3 text-sm text-warning">{status.mismatch}</p>
        </Group>
      ) : null}

      {error ? (
        <Group title="Problem">
          <p className="px-4 py-3 text-sm text-danger">{error}</p>
        </Group>
      ) : null}

      {!enabled && !enrolling ? (
        <Group title="Set up">
          <p className="px-4 pt-3 text-sm text-muted">
            Read your history again after losing a phone, reinstalling, or signing in on a new
            device. Off until you turn it on.
          </p>
          <button
            type="button"
            className="w-full px-4 py-3 text-left text-accent"
            onClick={() => setEnrolling(true)}
          >
            Enable Secure Backup
          </button>
        </Group>
      ) : null}

      {enrolling ? (
        <Group title="Enable Secure Backup">
          <EnrolmentFlow
            targets={targets}
            onDone={() => {
              setEnrolling(false);
              void refresh();
            }}
            onCancel={() => setEnrolling(false)}
          />
        </Group>
      ) : null}

      {enabled ? (
        <Group title="Test Recovery">
          <p className="px-4 pt-3 text-sm text-muted">
            Checks that your recovery code opens your backup. Nothing is restored and nothing
            changes — it only tells you whether the code works.
          </p>

          {testing ? (
            <>
              <input
                type="password"
                value={code}
                autoComplete="off"
                placeholder="Enter your 12-word recovery code"
                onChange={(event) => setCode(event.target.value)}
                className="mx-4 my-2 rounded-md bg-surface px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy === 'test' || code.trim().length === 0}
                className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
                onClick={runTest}
              >
                {busy === 'test' ? 'Checking…' : 'Check my code'}
              </button>
              <button
                type="button"
                className="w-full px-4 py-3 text-left text-muted"
                onClick={() => {
                  setTesting(false);
                  setCode('');
                  setResult(undefined);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="w-full px-4 py-3 text-left text-accent"
              onClick={() => setTesting(true)}
            >
              Test Recovery
            </button>
          )}

          {result ? (
            <p className={`px-4 pb-3 text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>
              {result.ok
                ? `PASS — your code opens recovery package v${result.version} (${
                    result.source === 'target' ? 'checked against the stored copy' : 'checked on this device'
                  }). Nothing was restored.`
                : result.reason === 'no-package'
                  ? 'No recovery package is available to test on this device.'
                  : 'FAIL — that code did not open your recovery package.'}
            </p>
          ) : null}
        </Group>
      ) : null}

      {enabled ? (
        <Group title="Backup">
          <p className="px-4 pt-3 text-sm text-muted">
            Your recovery key is registered. Backing up your chat archive arrives with Google
            Drive support — this records that everything is in place.
          </p>
          <button
            type="button"
            disabled={busy === 'backup'}
            className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
            onClick={backupNow}
          >
            {busy === 'backup' ? 'Working…' : 'Backup Now'}
          </button>
        </Group>
      ) : null}

      {enabled ? (
        <Group title="Turn off">
          <p className="px-4 pt-3 text-sm text-muted">
            New messages stop being wrapped for your recovery key. Messages already sent stay
            recoverable with the code you have.
          </p>
          <button
            type="button"
            disabled={busy === 'disable'}
            className="w-full px-4 py-3 text-left text-danger disabled:opacity-50"
            onClick={turnOff}
          >
            {busy === 'disable' ? 'Turning off…' : 'Disable'}
          </button>
        </Group>
      ) : null}
    </SettingsPage>
  );
}
