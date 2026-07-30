import { useCallback, useEffect, useMemo, useState } from 'react';

import { ServerBackupTarget } from '../../lib/backup/server-target.js';
import {
  beginEnrolment,
  completeEnrolment,
  disableSecureBackup,
  secureBackupStatus,
  type PendingEnrolment,
  type SecureBackupStatus,
} from '../../lib/backup/secure-backup.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { Group, InfoRow, SettingsPage } from '../../features/settings/controls.js';

/**
 * Secure Backup.
 *
 * ## The warning is not fine print
 *
 * Wrapping is not retroactive and cannot be. A message is wrapped for a
 * recovery key at the moment it is sent, so turning this on protects what
 * happens next and nothing that already happened. Someone who enables it after
 * losing a phone has not recovered anything, and the only honest place to say
 * so is before they enable it — not in a help article they will read once the
 * damage is done. It is therefore stated on the confirm step, in the same size
 * as everything else.
 *
 * ## Nothing leaves the device until the code is acknowledged
 *
 * `beginEnrolment` produces the code and the key material without touching the
 * network. Only after the user has been shown the code and confirmed they have
 * it does `completeEnrolment` publish anything. Backing out at any point before
 * that leaves no package, no local state and nothing to clean up — which is
 * what makes "Cancel" mean cancel.
 */
type Step = 'idle' | 'explain' | 'code' | 'saving' | 'done';

export function SecureBackupScreen() {
  const client = useMemo(() => getSupabaseClient(), []);
  const targets = useMemo(() => [new ServerBackupTarget(client)], [client]);

  const [status, setStatus] = useState<SecureBackupStatus | undefined>();
  const [step, setStep] = useState<Step>('idle');
  const [pending, setPending] = useState<PendingEnrolment | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

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

  const start = async () => {
    setError(undefined);
    try {
      setPending(await beginEnrolment());
      setStep('code');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare Secure Backup.');
    }
  };

  const finish = async () => {
    if (!pending) return;
    setBusy(true);
    setError(undefined);
    try {
      await completeEnrolment(pending, targets);
      setStep('done');
      // The code is not kept. It exists on paper or it does not exist.
      setPending(undefined);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Secure Backup could not be enabled.');
      setStep('explain');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await disableSecureBackup(targets);
      if (!result.removed) setError(`Turned off on this device. ${result.problems.join('; ')}`);
      setStep('idle');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const enabled = status?.enabled ?? false;
  const local = status?.local;

  return (
    <SettingsPage title="Secure Backup">
      <Group title="Status">
        <InfoRow label="Secure Backup" value={enabled ? 'On' : 'Off'} />
        <InfoRow
          label="Recovery key"
          value={local ? `Registered (version ${local.version})` : 'Not set up'}
        />
        <InfoRow
          label="Enabled on this device"
          value={local ? new Date(local.enrolledAt).toLocaleString() : '—'}
        />
        <InfoRow
          label="Last backup"
          value={
            local?.lastBackupAt
              ? new Date(local.lastBackupAt).toLocaleString()
              : enabled
                ? 'Not yet — chat backup arrives in a later update'
                : '—'
          }
        />
        {status?.targets.map((t) => (
          <InfoRow
            key={t.id}
            label={t.label}
            value={t.error ? `Unavailable — ${t.error}` : t.present ? 'Holding a package' : 'Empty'}
          />
        ))}
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

      {!enabled && step === 'idle' ? (
        <Group title="Set up">
          <p className="px-4 pt-3 text-sm text-muted">
            Secure Backup lets you read your history again after losing a phone, reinstalling, or
            signing in on a new device. It is off until you turn it on.
          </p>
          <button type="button" className="w-full px-4 py-3 text-left text-accent" onClick={() => setStep('explain')}>
            Enable Secure Backup
          </button>
        </Group>
      ) : null}

      {step === 'explain' ? (
        <Group title="Before you turn this on">
          {/*
            The one thing that must not be softened. Stated first, in body text,
            not as a footnote under the button.
          */}
          <p className="px-4 pt-3 text-sm font-semibold text-warning">
            Only future messages will be recoverable. Messages sent before Secure Backup was
            enabled cannot be restored.
          </p>
          <p className="px-4 pt-2 text-sm text-muted">
            You will be given a 12-word recovery code. It is the only thing that can unlock your
            backup — we cannot reset it, and nobody at PINGO can read your messages. Write it down
            somewhere safe before continuing.
          </p>
          <button type="button" className="w-full px-4 py-3 text-left text-accent" onClick={start}>
            I understand — show my recovery code
          </button>
          <button type="button" className="w-full px-4 py-3 text-left text-muted" onClick={() => setStep('idle')}>
            Cancel
          </button>
        </Group>
      ) : null}

      {step === 'code' && pending ? (
        <Group title="Your recovery code">
          <p className="px-4 pt-3 font-mono text-base leading-7 tracking-wide">{pending.code}</p>
          <p className="px-4 pt-2 text-sm text-muted">
            Write these 12 words down now. This screen will not show them again, and nothing has
            been saved yet.
          </p>
          <button
            type="button"
            disabled={busy}
            className="w-full px-4 py-3 text-left text-accent disabled:opacity-50"
            onClick={finish}
          >
            {busy ? 'Enabling…' : 'I have written it down — enable Secure Backup'}
          </button>
          <button
            type="button"
            className="w-full px-4 py-3 text-left text-muted"
            onClick={() => {
              // Nothing was published, so cancelling really is cancelling.
              setPending(undefined);
              setStep('idle');
            }}
          >
            Cancel
          </button>
        </Group>
      ) : null}

      {step === 'done' ? (
        <Group title="Secure Backup is on">
          <p className="px-4 py-3 text-sm text-muted">
            Messages from now on can be recovered with your code. Messages sent before now cannot.
          </p>
        </Group>
      ) : null}

      {enabled && step !== 'code' ? (
        <Group title="Turn off">
          <p className="px-4 pt-3 text-sm text-muted">
            New messages will stop being wrapped for your recovery key. Messages already sent stay
            recoverable with the code you have.
          </p>
          <button
            type="button"
            disabled={busy}
            className="w-full px-4 py-3 text-left text-danger disabled:opacity-50"
            onClick={turnOff}
          >
            {busy ? 'Turning off…' : 'Turn off Secure Backup'}
          </button>
        </Group>
      ) : null}
    </SettingsPage>
  );
}
