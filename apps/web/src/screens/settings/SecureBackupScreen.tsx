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
import { Capacitor } from '@capacitor/core';
import { DriveBackupController, type DriveView } from '../../lib/backup/drive/controller.js';
import { GoogleDriveBackupTarget } from '../../lib/backup/drive/drive-target.js';
import { NativeDriveAuth } from '../../lib/backup/drive/native-auth.js';
import { WebDriveAuth } from '../../lib/backup/drive/web-auth.js';
import { policyFor } from '../../lib/backup/drive/policy.js';

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

  const [drive, setDrive] = useState<DriveView | undefined>();
  const [restoring, setRestoring] = useState(false);
  const isNative = useMemo(() => Capacitor.isNativePlatform(), []);
  const policy = useMemo(() => policyFor(isNative), [isNative]);

  /*
   * Built lazily and kept for the life of the screen. Constructing the auth
   * object does not authorise anything — the picker appears only when Connect
   * is pressed — so this is safe to do before the user has asked.
   */
  const driveCtl = useMemo(() => {
    const auth = isNative ? new NativeDriveAuth() : new WebDriveAuth();
    return new DriveBackupController(new GoogleDriveBackupTarget(auth));
  }, [isNative]);

  useEffect(() => {
    const stop = driveCtl.subscribe(setDrive);
    void driveCtl.load();
    return stop;
  }, [driveCtl]);

  const driveLabel =
    drive?.phase === 'error'
      ? 'Problem'
      : drive?.connected
        ? 'Connected'
        : drive?.phase === 'connecting'
          ? 'Connecting…'
          : 'Not connected';

  const connectDrive = () => {
    const auth = isNative ? new NativeDriveAuth() : new WebDriveAuth();
    void driveCtl.connect(() => auth.authorize());
  };

  const driveBackupNow = async () => {
    if (!local?.publicKey) return;
    /*
     * A placeholder payload until the archive builder lands. The transport,
     * sealing and integrity are real; what is being sealed is not yet the
     * conversation store, and the screen does not pretend otherwise.
     */
    const payload = new TextEncoder().encode(JSON.stringify({ note: 'archive pending', at: Date.now() }));
    await driveCtl.backupNow(payload, local.publicKey);
  };

  const disconnectDrive = () => {
    setRestoring(false);
    void driveCtl.disconnect();
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
        <Group title="Google Drive">
          <InfoRow label="Status" value={driveLabel} />
          <InfoRow
            label="Last Backup"
            value={drive?.lastBackupAt ? new Date(drive.lastBackupAt).toLocaleString() : '—'}
          />
          <InfoRow label="Backup Size" value={drive?.bytes ? formatBytes(drive.bytes) : '—'} />
          <InfoRow
            label="Current Generation"
            value={drive?.generation ? `g${drive.generation}` : '—'}
          />

          {/*
            The platform's real behaviour, not an aspiration. The web cannot
            refresh a Drive token without a server-side credential, so it cannot
            promise background backup and does not.
          */}
          <p className="px-4 pt-2 text-sm text-muted">{policy.description}</p>

          {drive?.progress ? (
            <p className="px-4 pt-1 text-sm text-muted">
              {drive.progress.phase === 'uploading' && drive.progress.total
                ? `Uploading ${Math.round(((drive.progress.sent ?? 0) / drive.progress.total) * 100)}%`
                : drive.progress.phase}
            </p>
          ) : null}

          {drive?.phase === 'error' && drive.message ? (
            <p className="px-4 pt-1 text-sm text-danger">{drive.message}</p>
          ) : null}

          {!drive?.connected || drive?.needsReconnect ? (
            <button
              type="button"
              disabled={drive?.phase === 'connecting'}
              className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
              onClick={connectDrive}
            >
              {drive?.phase === 'connecting'
                ? 'Connecting…'
                : drive?.needsReconnect
                  ? 'Reconnect Google Drive'
                  : 'Connect Google Drive'}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={drive.phase === 'backing-up' || drive.phase === 'restoring'}
                className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
                onClick={driveBackupNow}
              >
                {drive.phase === 'backing-up' ? 'Backing up…' : 'Backup Now'}
              </button>
              <button
                type="button"
                disabled={drive.phase === 'backing-up' || drive.phase === 'restoring'}
                className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
                onClick={() => setRestoring(true)}
              >
                {drive.phase === 'restoring' ? 'Restoring…' : 'Restore Backup'}
              </button>
              <button
                type="button"
                className="w-full px-4 py-3 text-left text-danger"
                onClick={disconnectDrive}
              >
                Disconnect Google Drive
              </button>
            </>
          )}

          {restoring ? (
            <p className="px-4 pb-3 text-sm text-muted">
              Restoring needs your 12-word recovery code. Use Test Recovery above first to check
              the code works — restore replaces this device&rsquo;s local history.
            </p>
          ) : null}
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
