import { useCallback, useEffect, useMemo, useState } from 'react';

import { EnrolmentFlow } from '../../features/backup/EnrolmentFlow.js';
import { ChoiceRow, Group, InfoRow, SettingsPage, ToggleRow } from '../../features/settings/controls.js';
import { useBackupUx } from '../../features/backup/useBackupUx.js';
import { describeInterval } from '../../lib/backup/reminders.js';
import { setTelemetryEnabled, telemetryEnabled } from '../../lib/backup/ux-telemetry.js';
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
import { archiveLines, buildArchive } from '../../lib/backup/archive-builder.js';

/**
 * Secure Backup.
 *
 * The enrolment sequence is not written here - it is `EnrolmentFlow`, shared
 * with onboarding, so the warning and the two-step order cannot drift between
 * the two places that offer the same operation.
 *
 * ## Test Recovery is a rehearsal, not a restore
 *
 * It opens the package with the entered code and throws the key away. Nothing
 * is decrypted, nothing is written, no identity changes. The question it
 * answers - "are the words I wrote down the words that work?" - is only useful
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
  const [confirm, setConfirm] = useState<'restore' | 'disconnect' | undefined>();
  const [restoreCode, setRestoreCode] = useState('');
  const backupUx = useBackupUx();
  const reminderState = backupUx.reminders;
  const [telemetryOn, setTelemetryOn] = useState(false);
  useEffect(() => {
    void telemetryEnabled().then(setTelemetryOn);
  }, []);
  const isNative = useMemo(() => Capacitor.isNativePlatform(), []);
  const policy = useMemo(() => policyFor(isNative), [isNative]);

  /*
   * Built lazily and kept for the life of the screen. Constructing the auth
   * object does not authorise anything - the picker appears only when Connect
   * is pressed - so this is safe to do before the user has asked.
   */
  const driveAuth = useMemo(() => (isNative ? new NativeDriveAuth() : new WebDriveAuth()), [isNative]);
  const driveTarget = useMemo(() => new GoogleDriveBackupTarget(driveAuth), [driveAuth]);
  const driveCtl = useMemo(() => new DriveBackupController(driveTarget), [driveTarget]);

  useEffect(() => {
    const stop = driveCtl.subscribe(setDrive);
    void driveCtl.load(policy, async () => Boolean(await driveAuth.silent()));
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
    // The same auth object the target uses, so the token it stores is the token
    // the uploads will find.
    void driveCtl.connect(() => driveAuth.authorize());
  };

  /*
   * The real conversation store, streamed. Nothing here holds the archive: the
   * builder fills one chunk, the target uploads it, and the bytes are dropped
   * before the next chunk is sealed.
   */
  const driveBackupNow = async () => {
    if (!local?.publicKey) return;

    // Mirror the package so a device that has never seen this account can open
    // what it downloads. The server will not hand it back, by design.
    const storedPackage = local.package
      ? { package: local.package, publicKey: local.publicKey }
      : undefined;

    const userId = (await getSupabaseClient().auth.getUser()).data.user?.id;

    /*
     * Without a signed-in user there is nothing to count and nothing to walk,
     * so the old path is the honest fallback rather than a broken new one: it
     * archives whatever is already stored, which is exactly what it has always
     * done.
     */
    if (!userId) {
      await driveCtl.backupStreaming(local.publicKey, storedPackage);
      return;
    }

    const { liveBackupPorts } = await import('../../lib/backup/live-ports.js');
    const ports = await liveBackupPorts({
      userId,
      target: {
        backupArchiveStreaming: driveTarget.backupArchiveStreaming.bind(driveTarget),
        verificationStore: driveTarget.verificationStore.bind(driveTarget),
        driveClient: driveTarget.client,
      },
      recoveryPublicKey: local.publicKey,
      /*
       * No recovery key here, and that is deliberate: backing up must not ask
       * for the 12-word code. Verification says so — the header check reports
       * itself skipped and the headline reads "completeness not confirmed"
       * rather than claiming a check that did not run.
       */
      mode: 'private',
      keyVersion: 1,
    });

    await driveCtl.backupComplete(ports, storedPackage);
  };

  /*
   * Nothing here is awaited by the render path. Backup and restore run in the
   * controller and report through the subscription, so the rest of PINGO stays
   * usable while a multi-megabyte archive moves - navigating away does not
   * cancel it and does not block a conversation from opening.
   */
  const busyDrive =
    drive?.busy === true || drive?.phase === 'backing-up' || drive?.phase === 'restoring';

  const confirmDisconnect = () => {
    setConfirm(undefined);
    void driveCtl.disconnect();
  };

  /*
   * Restore needs the recovery private key, which only the code can produce, so
   * the code is asked for here and used once. It is never stored - not in state
   * beyond this call, not on disk.
   */
  const confirmRestore = async () => {
    setConfirm(undefined);
    const entered = restoreCode.trim();
    setRestoreCode('');
    if (!entered) {
      setError('Restore needs your 12-word recovery code.');
      return;
    }

    const { restoreRecoveryKey } = await import('../../lib/crypto/recovery.js');
    const stored = local?.package;
    if (!stored) {
      setError('This device has no recovery package to open. Enable Secure Backup first.');
      return;
    }

    let recoveryKey: CryptoKey;
    try {
      recoveryKey = await restoreRecoveryKey(stored, entered, 0);
    } catch {
      setError('That code did not open your recovery package. Nothing was restored.');
      return;
    }

    const { applyArchivePlaintext } = await import('../../lib/backup/archive-builder.js');
    await driveCtl.restore(recoveryKey, async (plaintext) => {
      /*
       * Every chunk has already been downloaded and checked against the
       * manifest by the time this runs, so what arrives is known-good and goes
       * straight into the database. The controller only records the generation
       * once this resolves, so a write that fails is not remembered as a
       * completed restore.
       */
      const applied = await applyArchivePlaintext(plaintext);
      setError(`Restored ${applied.records} records across ${applied.stores} stores.`);
    });
  };

  /**
   * Recovery on a device that has never held this account's keys.
   *
   * The package comes from Drive rather than from here, because here has
   * nothing - that is the situation. The server holds the same bytes and will
   * not return them, deliberately, so Drive is the only path from a lost phone
   * to readable history.
   */
  const recoverFromDrive = async () => {
    const entered = restoreCode.trim();
    setRestoreCode('');
    setError(undefined);
    if (!entered) return;

    try {
      const stored = await driveTarget.get();
      if (!stored) {
        setError('No recovery package was found in Google Drive for this account.');
        return;
      }

      const { restoreRecoveryKey } = await import('../../lib/crypto/recovery.js');
      let key: CryptoKey;
      try {
        key = await restoreRecoveryKey(stored.package, entered, 0);
      } catch {
        setError('That code did not open the recovery package. Nothing was restored.');
        return;
      }

      const { applyArchivePlaintext } = await import('../../lib/backup/archive-builder.js');
      await driveCtl.restore(key, async (plaintext) => {
        const applied = await applyArchivePlaintext(plaintext);
        setError(`Restored ${applied.records} records across ${applied.stores} stores. Reload to see them.`);
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? `Restore failed - ${cause.message}` : 'Restore failed.');
    }
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
  /*
   * The account has a package somewhere, whatever this device remembers. That
   * is what makes recovery possible and what the restore path keys on.
   */
  const accountEnrolled = status?.targets.some((t) => t.present) ?? false;

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
        <InfoRow label="Recovery Version" value={local ? `v${local.version}` : '-'} />
        <InfoRow
          label="Backup Target"
          value={status?.targets.map((t) => t.label).join(', ') || '-'}
        />
        <InfoRow
          label="Last Backup"
          value={local?.lastBackupAt ? new Date(local.lastBackupAt).toLocaleString() : '-'}
        />
        {/*
          Masked, always. The code exists on paper or in the user's head; a
          screen that could redisplay it would make every unlocked phone a copy
          of it.
        */}
        <InfoRow label="Recovery Code" value={enabled ? '••••••••••••' : '-'} />
      </Group>

      {/*
        Reminders and telemetry, in plain words.
        `describeInterval` is what the user sees; the durations stay internal.
      */}
      <Group title="Reminders">
        <ChoiceRow
          label="Remind me to back up"
          value={reminderState.interval}
          options={[
            { value: '24h', label: describeInterval('24h') },
            { value: '7d', label: describeInterval('7d') },
            { value: '1m', label: describeInterval('1m') },
            { value: 'never', label: describeInterval('never') },
          ]}
          onChange={(interval) => void backupUx.setInterval(interval)}
        />
        <ToggleRow
          label="Help improve PINGO"
          description="Shares which backup screens you saw. Never your messages, contacts or files. Off unless you turn it on."
          checked={telemetryOn}
          onChange={(on) => {
            setTelemetryOn(on);
            void setTelemetryEnabled(on);
          }}
        />
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

      {/*
        The device that most needs restore is the one that has nothing.

        Everything below the status block used to be gated on local enrolment
        state, which a reinstalled or replaced device never has - so the screen
        offered "Enable Secure Backup" and no way back to the history sitting in
        Drive. Measured by wiping the database: new device identity, empty
        stores, account still enrolled server-side, and not one control that
        could reach the backup.

        The account's package being present is what proves recovery is possible,
        so that is what this is keyed on rather than anything this device
        remembers.
      */}
      {!local && accountEnrolled ? (
        <Group title="Restore your history">
          <p className="px-4 pt-3 text-sm text-muted">
            This account has Secure Backup, but this device has never been set up. Connect Google
            Drive and enter your 12-word recovery code to bring your chats back.
          </p>

          {!drive?.connected || drive?.needsReconnect ? (
            <button
              type="button"
              disabled={drive?.phase === 'connecting'}
              className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
              onClick={connectDrive}
            >
              {drive?.phase === 'connecting' ? 'Connecting…' : 'Connect Google Drive'}
            </button>
          ) : (
            <>
              <input
                type="password"
                value={restoreCode}
                autoComplete="off"
                placeholder="Your 12-word recovery code"
                onChange={(event) => setRestoreCode(event.target.value)}
                className="mx-4 my-2 rounded-md bg-surface px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busyDrive || restoreCode.trim().length === 0}
                className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
                onClick={() => void recoverFromDrive()}
              >
                {drive?.phase === 'restoring' ? 'Restoring…' : 'Restore from Google Drive'}
              </button>
            </>
          )}

          {drive?.phase === 'error' && drive.message ? (
            <p className="px-4 pb-3 text-sm text-danger">{drive.message}</p>
          ) : null}
        </Group>
      ) : null}

      {!enabled && !accountEnrolled && !enrolling ? (
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
            changes - it only tells you whether the code works.
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
                ? `PASS - your code opens recovery package v${result.version} (${
                    result.source === 'target' ? 'checked against the stored copy' : 'checked on this device'
                  }). Nothing was restored.`
                : result.reason === 'no-package'
                  ? 'No recovery package is available to test on this device.'
                  : 'FAIL: that code did not open your recovery package.'}
            </p>
          ) : null}
        </Group>
      ) : null}

      {enabled ? (
        <Group title="Google Drive">
          <InfoRow label="Status" value={driveLabel} />
          <InfoRow
            label="Last Backup"
            value={drive?.lastBackupAt ? new Date(drive.lastBackupAt).toLocaleString() : '-'}
          />
          <InfoRow label="Backup Size" value={drive?.bytes ? formatBytes(drive.bytes) : '-'} />
          <InfoRow
            label="Current Generation"
            value={drive?.generation ? `g${drive.generation}` : '-'}
          />
          <InfoRow
            label="Last Successful Backup"
            value={drive?.lastSuccessAt ? new Date(drive.lastSuccessAt).toLocaleString() : '-'}
          />
          {/*
            Kept even after a later success. "It works now" and "it failed on
            Tuesday because the token expired" are both worth knowing when
            somebody reports that backup is broken.
          */}
          <InfoRow
            label="Last Failure"
            value={
              drive?.lastFailure
                ? `${new Date(drive.lastFailure.at).toLocaleString()} - ${drive.lastFailure.reason}`
                : 'None'
            }
          />
          {/* Android only. The web schedules nothing, so it shows nothing. */}
          {drive?.nextScheduledAt ? (
            <InfoRow
              label="Next Scheduled Backup"
              value={new Date(drive.nextScheduledAt).toLocaleString()}
            />
          ) : null}

          {/*
            The platform's real behaviour, not an aspiration. The web cannot
            refresh a Drive token without a server-side credential, so it cannot
            promise background backup and does not.
          */}
          <p className="px-4 pt-2 text-sm text-muted">{policy.description}</p>

          {/*
            The stage first, then the bar. The stage names come from the
            pipeline and map one-to-one onto what is actually running, so
            "Downloading older history…" means exactly that and not "we are
            still working". A percentage under the wrong label is worse than no
            percentage.
          */}
          {drive?.stageLabel ? (
            <p className="px-4 pt-1 text-sm text-muted">
              {drive.stageLabel}
              {drive.progress?.total
                ? ` ${Math.round(((drive.progress.sent ?? 0) / drive.progress.total) * 100)}%`
                : ''}
            </p>
          ) : drive?.progress ? (
            <p className="px-4 pt-1 text-sm text-muted">
              {drive.progress.phase === 'uploading' && drive.progress.total
                ? `Uploading ${Math.round(((drive.progress.sent ?? 0) / drive.progress.total) * 100)}%`
                : drive.progress.phase}
            </p>
          ) : null}

          {/*
            An incomplete account is not an error and does not read like one.
            Nothing the user did caused it and reconnecting will not fix it, so
            it gets its own block with the numbers in it and a retry that
            resumes rather than starting again.
          */}
          {drive?.incomplete ? (
            <div className="mx-4 mt-2 rounded-lg bg-surface-2 p-3">
              <p className="text-sm font-medium">{drive.incomplete.headline}</p>
              <p className="pt-1 text-xs text-muted">
                Nothing was uploaded. Your previous backup is untouched.
              </p>
              <button
                type="button"
                disabled={busyDrive}
                className="pt-2 text-sm text-accent disabled:opacity-50"
                onClick={driveBackupNow}
              >
                Try again
              </button>
            </div>
          ) : null}

          {drive?.phase === 'error' && drive.message ? (
            <p className="px-4 pt-1 text-sm text-danger">{drive.message}</p>
          ) : null}

          {/*
            What the last backup actually contained, from the receipt rather
            than from what the app intended to do.
          */}
          {drive?.receipt && !busyDrive ? (
            <p className="px-4 pt-1 text-xs text-muted">
              {drive.receipt.messages.toLocaleString()} messages in{' '}
              {drive.receipt.conversations.toLocaleString()} chats
              {drive.receipt.verification === 'sampled' ? ' · spot-checked' : ' · verified'}
            </p>
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
              {/*
                Every action that conflicts with work in flight is disabled from
                one flag, so a second backup cannot be started from the screen.
                The controller holds the real lock - a disabled button is a
                courtesy, not a guarantee, and a background trigger does not
                look at buttons.
              */}
              <button
                type="button"
                disabled={busyDrive}
                className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
                onClick={driveBackupNow}
              >
                {drive.phase === 'backing-up' ? 'Backing up…' : 'Backup Now'}
              </button>
              <button
                type="button"
                disabled={busyDrive}
                className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
                onClick={() => setConfirm('restore')}
              >
                {drive.phase === 'restoring' ? 'Restoring…' : 'Restore Backup'}
              </button>
              <button
                type="button"
                disabled={busyDrive}
                className="w-full px-4 py-3 text-left text-danger disabled:opacity-50"
                onClick={() => setConfirm('disconnect')}
              >
                Disconnect Google Drive
              </button>
            </>
          )}

          {/*
            Both of these are destructive in ways a tap should not cause: one
            replaces local history, the other removes the backup that would
            have restored it.
          */}
          {confirm === 'restore' ? (
            <div className="px-4 pb-3">
              <p className="text-sm text-warning">
                Restore replaces this device&rsquo;s local history with the backup in Drive, and
                needs your 12-word recovery code. Use Test Recovery above first to check the code
                works.
              </p>
              <input
                type="password"
                value={restoreCode}
                autoComplete="off"
                placeholder="Your 12-word recovery code"
                onChange={(event) => setRestoreCode(event.target.value)}
                className="my-2 w-full rounded-md bg-surface px-3 py-2 text-sm"
              />
              <button type="button" className="py-2 text-left text-accent" onClick={() => void confirmRestore()}>
                Yes, restore from Drive
              </button>
              <button type="button" className="ml-4 py-2 text-left text-muted" onClick={() => setConfirm(undefined)}>
                Cancel
              </button>
            </div>
          ) : null}

          {confirm === 'disconnect' ? (
            <div className="px-4 pb-3">
              <p className="text-sm text-warning">
                Disconnecting deletes the backup from Google Drive. Messages already on this
                device stay, but you will not be able to restore them on a new one.
              </p>
              <button type="button" className="py-2 text-left text-danger" onClick={confirmDisconnect}>
                Yes, disconnect and delete
              </button>
              <button type="button" className="ml-4 py-2 text-left text-muted" onClick={() => setConfirm(undefined)}>
                Cancel
              </button>
            </div>
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
