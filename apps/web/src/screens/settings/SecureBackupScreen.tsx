import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BackupLockPicker, type SecretChoice } from '../../features/backup/BackupLock.js';
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
  type SecureBackupStatus,
} from '../../lib/backup/secure-backup.js';
import { useProfile } from '@pingo/core';
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
 * ## Nothing here asks for a recovery code
 *
 * Restoring opens the archive with a key that lives in the same Drive folder,
 * so the twelve words are not part of any path the user takes. Every surface
 * that still mentioned them — the status row, the code test, the restore
 * instructions — has been removed: a screen that asks for something the product
 * does not use sends people hunting for a code they were never given.
 */
export function SecureBackupScreen() {
  const client = useMemo(() => getSupabaseClient(), []);
  const targets = useMemo(() => [new ServerBackupTarget(client)], [client]);

  const [status, setStatus] = useState<SecureBackupStatus | undefined>();
  const [enrolling, setEnrolling] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'disable' | undefined>();
  const [error, setError] = useState<string | undefined>();


  const [drive, setDrive] = useState<DriveView | undefined>();

  /**
   * The lock on the backup key, as Drive holds it.
   *
   * `undefined` while it is being read, `null` when this account has none —
   * two different things, and a screen that conflates them offers "set a
   * passkey" to somebody who already has one.
   */
  const [lock, setLock] = useState<import('../../lib/backup/passkey-lock.js').Lock | null>();
  const [lockStep, setLockStep] = useState<'set' | 'change' | 'unlock' | undefined>();

  /**
   * The gap between the tap and the first sign of life.
   *
   * Backup and restore both do a surprising amount before the controller
   * publishes a phase: dynamic imports, a token check, a Drive lookup. On a
   * phone that is a second or two of a button that looks like it was not
   * pressed, and the second tap is somebody's instinct. This is set
   * synchronously in the handler so the label changes on the same frame as the
   * touch, and the controller's own phases take over once they arrive.
   */
  const [starting, setStarting] = useState<'backup' | 'restore' | undefined>();

  /**
   * What the user chose this session, so the two halves stay one secret.
   *
   * State rather than a ref because the enrolment flow reads it while
   * rendering. It is the same material as `unlockedWith` and is dropped with
   * the screen.
   */
  const [lockSecret, setLockSecret] = useState<SecretChoice | undefined>();

  const runDrive = (kind: 'backup' | 'restore', work: () => Promise<void>) => {
    setStarting(kind);
    void work().finally(() => setStarting(undefined));
  };

  /**
   * The secret, for as long as this screen is open and no longer.
   *
   * A ref rather than state: it must not survive a re-render into a snapshot,
   * it is never written to disk, and leaving the screen drops it. Changing the
   * lock needs the current secret, and asking for it twice in ten seconds is
   * how people end up choosing something they can type quickly.
   */
  const unlockedWith = useRef<string | Uint8Array | undefined>(undefined);
  /** The opened key, for the restore that comes straight after unlocking. */
  const unlockedKey = useRef<CryptoKey | undefined>(undefined);

  /** A passkey needs a name to show in the platform prompt. */
  const { profile } = useProfile();
  const profileForPasskey = profile
    ? { userId: profile.id, userName: profile.username, displayName: profile.displayName }
    : undefined;
  const [confirm, setConfirm] = useState<'restore' | 'disconnect' | undefined>();
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

  /*
   * Read once Drive is connected, and again after every change, so the screen
   * always describes the file rather than what it last did.
   */
  useEffect(() => {
    if (!drive?.connected) {
      setLock(undefined);
      return;
    }
    let active = true;
    void import('../../lib/backup/archive-key.js')
      .then(({ readArchiveLock }) => readArchiveLock(driveTarget.client))
      .then((found) => {
        if (active) setLock(found ?? null);
      })
      .catch(() => {
        if (active) setLock(null);
      });
    return () => {
      active = false;
    };
  }, [drive?.connected, driveTarget, lockStep]);

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

    /*
     * The local session first, the network second.
     *
     * `getUser()` validates against the auth server, and measured against
     * production it returned no user here while the very same call succeeded
     * elsewhere in the app — so the complete-history path never ran and the
     * fallback below quietly archived the cache instead. `getSession()` reads
     * the persisted session without a round trip, which is both faster and has
     * one fewer way to fail before a backup that has not started yet.
     */
    const auth = getSupabaseClient().auth;
    const userId =
      (await auth.getSession()).data.session?.user?.id ??
      (await auth.getUser()).data.user?.id;

    /*
     * No silent fallback.
     *
     * This used to drop to `backupStreaming`, which archives whatever the local
     * database happens to hold. On an account that has never been scrolled back
     * that is the newest few hundred messages — and it reported "Backup
     * complete" for it. A backup that quietly contains less than it claims is
     * the exact failure this whole pipeline exists to prevent, so if the user
     * cannot be identified the backup stops and says so.
     */
    if (!userId) {
      await driveCtl.reportBlocked(
        'Backup stopped: PINGO could not confirm who is signed in.',
        'Nothing was uploaded. Your previous backup is untouched. Signing out and back in should fix this.',
      );
      return;
    }

    /*
     * Simple Backup: the archive is sealed to a keypair whose private half sits
     * in the user's own Drive, so a restore needs the Google account and
     * nothing else. Google can therefore read this backup, which is the trade
     * the mode exists to make and which the interface states plainly.
     */
    /*
     * Backing up needs the public half and nothing else.
     *
     * That is worth saying plainly: a locked account can take a backup without
     * ever being asked for the passkey, because sealing to a public key needs
     * no secret. The secret is only ever required to *open* one — which is the
     * shape you want, and the opposite of a system that asks for a password to
     * save a file.
     */
    /*
     * Whose backup this is, written down before anything is uploaded.
     *
     * A Google account holding somebody else's PINGO backup is refused here
     * rather than at restore, because the moment to find out is before two
     * accounts' archives share a folder.
     */
    const { claimOwner, OwnerMismatchError } = await import('../../lib/backup/drive-owner.js');
    try {
      await claimOwner(driveTarget.client, userId);
    } catch (cause) {
      await driveCtl.reportBlocked(
        cause instanceof OwnerMismatchError
          ? 'This Google account already holds a backup for a different PINGO account.'
          : 'Backup stopped: PINGO could not confirm this Google account.',
        'Nothing was uploaded. Use a different Google account, or remove the connection and connect the right one.',
      );
      return;
    }

    const { ensureArchiveKey, readArchiveLock } = await import('../../lib/backup/archive-key.js');
    const locked = await readArchiveLock(driveTarget.client).catch(() => undefined);
    const archiveKey = locked
      ? { publicKey: locked.publicKey, privateKey: unlockedKey.current }
      : await ensureArchiveKey(driveTarget.client);

    const { liveBackupPorts } = await import('../../lib/backup/live-ports.js');
    const ports = await liveBackupPorts({
      userId,
      target: {
        backupArchiveStreaming: driveTarget.backupArchiveStreaming.bind(driveTarget),
        verificationStore: driveTarget.verificationStore.bind(driveTarget),
        driveClient: driveTarget.client,
      },
      recoveryPublicKey: archiveKey.publicKey,
      /*
       * Only when it is already in hand. With the private half the header check
       * runs and the headline can say "fully verified"; without it the backup
       * still completes and says "completeness not confirmed", which is the
       * honest report for a locked account that has not been unlocked this
       * session. Prompting for a passkey in order to *write* a backup would be
       * asking for a key to lock a door.
       */
      ...(archiveKey.privateKey ? { recoveryPrivateKey: archiveKey.privateKey } : {}),
      mode: 'simple',
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

  /* Restore, which asks for nothing. The note inside says why. */
  const confirmRestore = async () => {
    setConfirm(undefined);
    /*
     * Nothing is asked for.
     *
     * The archive key lives in the same Drive folder as the archive it opens,
     * so a signed-in device already holds the whole credential. Twelve words
     * nobody wrote down was never a recovery mechanism — a backup that cannot
     * be opened by the person who made it is not a backup.
     */
    const { loadArchiveKey, ArchiveKeyError } = await import('../../lib/backup/archive-key.js');

    let recoveryKey: CryptoKey;
    try {
      recoveryKey = (await loadArchiveKey(driveTarget.client)).privateKey;
    } catch (cause) {
      /*
       * Named separately because they need different answers. No key at all
       * means the backup predates Simple mode and one more backup fixes it; an
       * unreadable key is a problem with a key existing archives depend on, and
       * generating a replacement would orphan every one of them.
       */
      setError(
        cause instanceof ArchiveKeyError && cause.code === 'missing'
          ? 'This backup was made before PINGO stored a key in Drive. Run Backup Now once, then restore.'
          : 'The backup key in Drive could not be read. Nothing was restored.',
      );
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

      /*
       * What arrived, checked against what was promised.
       *
       * "Restored 5,465 records" is a statement about this function finishing,
       * not about the backup being whole — and those are different claims. The
       * receipt written when the backup was made is the only thing that can
       * tell them apart, so it is read back and compared here rather than the
       * restore reporting its own success.
       *
       * A mismatch never blocks the restore: the data that arrived is the
       * user's data. It simply stops being described as complete.
       */
      const [{ verifyRestore, openReceipt, computeManifestHash, computeArchiveHash }, { liveReceiptStore }] =
        await Promise.all([
          import('../../lib/backup/receipt.js'),
          import('../../lib/backup/live-ports.js'),
        ]);

      let headline = `Restored ${applied.records} records across ${applied.stores} stores.`;
      try {
        const store = driveTarget.verificationStore();
        const head = await store.head();
        const raw = head ? await store.readManifest(head.generation) : undefined;
        const sealed = await liveReceiptStore(driveTarget.client).newest();

        if (raw && sealed) {
          const manifest = JSON.parse(raw) as Parameters<typeof computeManifestHash>[0];
          const receipt = await openReceipt(sealed as never, recoveryKey);

          // Counted from the archive itself, not from what we hoped it held.
          const conversations = new Set<string>();
          let messages = 0;
          for (const line of new TextDecoder().decode(plaintext).split('\n')) {
            if (!line) continue;
            const record = JSON.parse(line) as { kind?: string; store?: string; key?: string };
            if (record.kind === 'record' && record.store === 'message-rows' && record.key) {
              messages += 1;
              conversations.add(record.key.split('|')[0]!);
            }
          }

          const checked = verifyRestore(receipt, {
            conversations: conversations.size,
            messages,
            manifestHash: await computeManifestHash(manifest),
            archiveHash: await computeArchiveHash(manifest.chunks),
          });
          headline = checked.headline;
          if (checked.warnings.length > 0) {
            headline += ` (${checked.warnings.map((warning) => warning.message).join(' ')})`;
          }
        } else {
          /*
           * Nothing to check against, so say so.
           *
           * This branch used to fall through silently and leave the count of
           * records on screen, which reads exactly like a verified restore and
           * is the same silent-success failure this whole pipeline was built to
           * remove. Measured on a real restore: it reported "Restored 5499
           * records across 4 stores" having verified nothing at all.
           */
          headline += raw
            ? ' No backup record was found, so it could not be verified.'
            : ' The backup index could not be read, so it could not be verified.';
        }
      } catch {
        // An unreadable receipt leaves the restore standing and unverified,
        // which is what `verifyRestore` calls it when handed nothing.
        headline += ' Could not verify it against the original backup record.';
      }

      setError(headline);
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
    setError(undefined);

    try {
      /*
       * The lost-phone path.
       *
       * A locked backup asks for the passkey or passcode and cannot proceed
       * without it — the key in Drive is sealed, so there is nothing to fall
       * back to. A backup made before locks existed still opens with the Google
       * account alone, which is what those archives were sealed under; setting
       * a lock afterwards is offered above rather than forced here.
       */
      /*
       * The dangerous direction, and the reason this check exists.
       *
       * Signing in to PINGO as one person and connecting a Google account
       * belonging to another would otherwise apply *their* history to *this*
       * device. Each Google account has its own folder, so nobody can read
       * across — but nothing stopped a restore in the wrong direction.
       */
      const me = (await getSupabaseClient().auth.getSession()).data.session?.user?.id;
      if (me) {
        const { assertOwner, OwnerMismatchError } = await import('../../lib/backup/drive-owner.js');
        try {
          await assertOwner(driveTarget.client, me);
        } catch (cause) {
          setError(
            cause instanceof OwnerMismatchError
              ? 'This Google account holds a backup for a different PINGO account. Nothing was restored.'
              : 'PINGO could not confirm this Google account. Nothing was restored.',
          );
          return;
        }
      }

      const { loadArchiveKey, readArchiveLock, ArchiveKeyError } = await import(
        '../../lib/backup/archive-key.js'
      );

      const stored = await readArchiveLock(driveTarget.client).catch(() => undefined);
      let key: CryptoKey | undefined;

      if (stored) {
        key = unlockedKey.current;
        if (!key) {
          // Ask, and stop. The prompt calls this again once it has opened.
          setLockStep('unlock');
          setError('This backup is locked. Unlock it to restore.');
          return;
        }
      } else {
        try {
          key = (await loadArchiveKey(driveTarget.client)).privateKey;
        } catch (cause) {
          setError(
            cause instanceof ArchiveKeyError && cause.code === 'missing'
              ? 'No backup key was found in this Google account. Nothing was restored.'
              : 'The backup key in Drive could not be read. Nothing was restored.',
          );
          return;
        }
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

  /**
   * Set the lock, or change it.
   *
   * Setting takes whatever key the account already has — the plaintext one from
   * before this existed, or none at all — and seals *that same pair*, so every
   * archive already written keeps opening. Changing re-wraps without touching
   * the key, so nothing is re-uploaded either.
   */
  const applyLock = async (choice: SecretChoice) => {
    setError(undefined);
    const drivePkg = driveTarget.client;
    const [{ createLock, changeLock, lockExistingKey }, keyMod] = await Promise.all([
      import('../../lib/backup/passkey-lock.js'),
      import('../../lib/backup/archive-key.js'),
    ]);

    try {
      if (lockStep === 'change') {
        if (!lock || !unlockedWith.current) {
          setError('Unlock the current backup first.');
          return;
        }
        const next = await changeLock({
          lock,
          current: unlockedWith.current,
          next: {
            method: choice.method,
            secret: choice.secret,
            ...(choice.passcodeKind ? { passcodeKind: choice.passcodeKind } : {}),
            ...(choice.credentialId ? { credentialId: choice.credentialId } : {}),
          },
        });
        await keyMod.writeArchiveLock(drivePkg, next);
        unlockedWith.current = choice.secret;
        setLockStep(undefined);
        setError('Backup lock changed. Nothing was re-uploaded.');
        return;
      }

      /*
       * An account that has already backed up keeps its key.
       *
       * This is the whole correctness of adding a lock later: the archives on
       * Drive are sealed to the existing pair, so the lock has to protect *that*
       * pair. Minting a new one here orphaned every archive — reported as
       * "backup part 0 could not be opened", which is exactly what a chunk
       * looks like when the key is wrong.
       */
      const existing = await keyMod.loadArchiveKey(drivePkg).catch(() => undefined);

      const lockToWrite = existing
        ? await lockExistingKey({
            privateKeyPkcs8: new Uint8Array(
              await crypto.subtle.exportKey('pkcs8', existing.privateKey),
            ),
            publicKey: existing.publicKey,
            method: choice.method,
            secret: choice.secret,
            ...(choice.passcodeKind ? { passcodeKind: choice.passcodeKind } : {}),
            ...(choice.credentialId ? { credentialId: choice.credentialId } : {}),
          })
        : (
            await createLock({
              method: choice.method,
              secret: choice.secret,
              ...(choice.passcodeKind ? { passcodeKind: choice.passcodeKind } : {}),
              ...(choice.credentialId ? { credentialId: choice.credentialId } : {}),
            })
          ).lock;

      await keyMod.writeArchiveLock(drivePkg, lockToWrite);
      unlockedWith.current = choice.secret;
      setLockSecret(choice);
      setLockStep(undefined);
      setError(
        existing
          ? 'Backup lock set. The backups you already have still open — the same key, now protected.'
          : 'Backup lock set. Your next backup will be sealed to it.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    }
  };

  /** Open the lock, and keep the secret only for as long as this screen lives. */
  const unlock = async (choice: SecretChoice) => {
    setError(undefined);
    try {
      const { openArchiveLock } = await import('../../lib/backup/archive-key.js');
      const opened = await openArchiveLock(driveTarget.client, choice.secret, lock?.version ?? 0);
      unlockedWith.current = choice.secret;
      unlockedKey.current = opened.privateKey;
      setLockStep(undefined);
      setError('Unlocked. Restore is ready.');
      return opened.privateKey;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not unlock your backup.');
      return undefined;
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
      {/*
        Three facts, and none of them is a recovery code.

        Restoring stopped asking for one — nobody keeps a twelve-word code, and
        this is a messaging app rather than a bank. A row of dots for something
        the product no longer uses is worse than clutter: it tells somebody they
        are relying on a code they were never given, and they go looking for it.
        The internal recovery version went with it; a "v2" nobody can act on is
        a number for the developer, on a screen for the user.
      */}
      <Group title="Status">
        <InfoRow label="Status" value={enabled ? '✅ Enabled' : 'Not enabled'} />
        <InfoRow
          label="Backup Target"
          value={status?.targets.map((t) => t.label).join(', ') || '-'}
        />
        <InfoRow
          label="Last Backup"
          value={local?.lastBackupAt ? new Date(local.lastBackupAt).toLocaleString() : '-'}
        />
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
            This account has Secure Backup, but this device has never been set up. Connect the
            same Google account and your chats come back — there is nothing to type.
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
            <button
              type="button"
              disabled={busyDrive || starting !== undefined}
              className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
              onClick={() => runDrive('restore', recoverFromDrive)}
            >
              {drive?.phase === 'restoring'
                ? 'Restoring…'
                : starting === 'restore'
                  ? 'Starting…'
                  : 'Restore from Google Drive'}
            </button>
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
            {...(profileForPasskey ? { account: profileForPasskey } : {})}
            {...(lockSecret ? { existingSecret: lockSecret } : {})}
            onDone={(choice) => {
              setEnrolling(false);
              void refresh();
              /*
                One secret, not two.

                The server package and the Drive lock protect the same history,
                and asking twice is how somebody ends up with a password they
                set once and a passkey they set later and no idea which opens
                what. Enrolling therefore locks Drive with the same choice, if
                Drive is connected; if it is not, the lock is set with this
                secret the moment it is.
              */
              setLockSecret(choice);
              if (drive?.connected && !lock) void applyLock(choice);
            }}
            onCancel={() => setEnrolling(false)}
          />
        </Group>
      ) : null}

      {/*
        "Test Recovery" was here, and it tested a code.

        Restoring asks for nothing now — the key that opens the archive sits
        in the same Drive folder as the archive — so a passing code test
        proved something no restore depends on, and a failing one would have
        frightened somebody whose backup was fine. The rehearsal that means
        something is a restore, and that is one row further down.
      */}

      {/*
        The lock, and the only place it is set or changed.

        Shown whenever Drive is connected rather than only when Secure Backup is
        "enabled": the thing being protected is the archive key in Drive, and
        that exists independently of the server-side enrolment above.
      */}
      {drive?.connected ? (
        <Group title="Backup lock">
          <InfoRow
            label="Protected by"
            value={
              lock === undefined
                ? 'Checking…'
                : lock === null
                  ? 'Nothing yet'
                  : lock.method === 'passkey'
                    ? 'Face ID, fingerprint or screen lock'
                    : lock.passcodeKind === 'pin'
                      ? 'A PIN you chose'
                      : lock.passcodeKind === 'pattern'
                        ? 'A pattern you chose'
                        : 'A password you chose'
            }
          />

          {lock === null ? (
            <p className="px-4 pb-2 text-sm text-muted">
              Right now anyone with your Google account can open this backup — Google included.
              Set a lock and only you can.
            </p>
          ) : null}

          {lockStep ? (
            <BackupLockPicker
              purpose={lockStep}
              {...(profileForPasskey ? { account: profileForPasskey } : {})}
              // The passkey this lock was actually sealed to - see the prop.
              {...(lock?.credentialId ? { credentialId: lock.credentialId } : {})}
              onChosen={(choice) =>
                lockStep === 'unlock' ? void unlock(choice) : void applyLock(choice)
              }
              onCancel={() => setLockStep(undefined)}
            />
          ) : (
            <>
              <button
                type="button"
                className="w-full px-4 py-3 text-left text-accent"
                onClick={() => setLockStep(lock ? (unlockedWith.current ? 'change' : 'unlock') : 'set')}
              >
                {lock
                  ? unlockedWith.current
                    ? 'Change the lock'
                    : 'Unlock to change it'
                  : 'Set a passkey or passcode'}
              </button>
              {lock && unlockedWith.current ? (
                <p className="px-4 pb-3 text-caption text-text-tertiary">
                  Unlocked on this screen. Leaving forgets it.
                </p>
              ) : null}
            </>
          )}
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
            Stated without euphemism, because it is the trade the mode makes.
            Plan §10: not "secured by Google", not "encrypted in Drive". If the
            sentence is uncomfortable the honest answer is Private mode, which
            is the next thing to build — not softer wording here.
          */}
          <p className="px-4 pt-1 text-xs text-muted">
            Your backup is encrypted, and its key is stored in your Google Drive so restoring
            needs nothing but this Google account. Anyone who can sign in to it can read these
            chats. PINGO cannot.
          </p>

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
                disabled={busyDrive || starting !== undefined}
                className="pt-2 text-sm text-accent disabled:opacity-50"
                onClick={() => runDrive('backup', driveBackupNow)}
              >
                {starting === 'backup' ? 'Starting…' : 'Try again'}
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
                disabled={busyDrive || starting !== undefined}
                className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
                onClick={() => runDrive('backup', driveBackupNow)}
              >
                {drive.phase === 'backing-up'
                  ? 'Backing up…'
                  : starting === 'backup'
                    ? 'Starting…'
                    : 'Backup Now'}
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
                Restore replaces this device&rsquo;s local history with the backup in Drive.
              </p>
              {/*
                Nothing is asked for, and the screen says so rather than
                leaving an empty box. A field labelled "recovery code" teaches
                people that restore needs something they do not have, and most
                stop there rather than press a button that looks like it will
                fail.
              */}
              <p className="my-2 text-xs text-muted">
                {lock
                  ? 'Your backup is locked. You will be asked for your passkey or passcode.'
                  : 'Your backup opens with this Google account. Nothing to type.'}
              </p>
              <button
                type="button"
                disabled={starting !== undefined}
                className="py-2 text-left text-accent disabled:opacity-50"
                onClick={() => runDrive('restore', confirmRestore)}
              >
                {starting === 'restore' ? 'Starting…' : 'Yes, restore from Drive'}
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
