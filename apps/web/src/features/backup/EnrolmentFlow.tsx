import { useState } from 'react';

import {
  beginEnrolment,
  completeEnrolment,
  type PendingEnrolment,
} from '../../lib/backup/secure-backup.js';
import type { BackupTarget } from '../../lib/backup/target.js';

/**
 * Enrolling in Secure Backup, once, for everywhere that offers it.
 *
 * Onboarding and Settings present this differently — one is a step in a flow
 * the user is being walked through, the other is a page they went looking for —
 * but the *operation* is identical, and the parts that must not drift are the
 * warning, the two-step order, and what happens when somebody backs out. Two
 * copies of that would eventually disagree, and the copy that quietly stopped
 * saying "only future messages" would be the one nobody noticed.
 *
 * So the sequence lives here and the surroundings are passed in.
 */
export type EnrolmentStep = 'explain' | 'code' | 'done';

export function EnrolmentFlow({
  targets,
  onDone,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  targets: BackupTarget[];
  onDone: () => void;
  onCancel: () => void;
  /** Onboarding calls this "Not now"; Settings calls it "Cancel". */
  cancelLabel?: string;
}) {
  const [step, setStep] = useState<EnrolmentStep>('explain');
  const [pending, setPending] = useState<PendingEnrolment | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const showCode = async () => {
    setError(undefined);
    try {
      // Nothing has left the device at this point, and nothing will until the
      // user confirms they have written the code down.
      setPending(await beginEnrolment());
      setStep('code');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare Secure Backup.');
    }
  };

  const enable = async () => {
    if (!pending) return;
    setBusy(true);
    setError(undefined);
    try {
      await completeEnrolment(pending, targets);
      // The code is not retained anywhere. It is on paper or it is gone.
      setPending(undefined);
      setStep('done');
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Secure Backup could not be enabled.');
      setStep('explain');
    } finally {
      setBusy(false);
    }
  };

  const abandon = () => {
    setPending(undefined);
    setStep('explain');
    onCancel();
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="px-4 text-sm text-danger">{error}</p> : null}

      {step === 'explain' ? (
        <>
          {/*
            The sentence that must never be softened or moved below a button.
            Wrapping happens when a message is sent, so this cannot be made
            retroactive, and before enabling is the only useful moment to say
            so.
          */}
          <p className="px-4 text-sm font-semibold text-warning">
            Only future messages will be recoverable. Messages sent before Secure Backup was
            enabled cannot be restored.
          </p>
          <p className="px-4 text-sm text-muted">
            You will get a 12-word recovery code. It is the only thing that can unlock your
            backup — nobody at PINGO can reset it or read your messages. Write it down somewhere
            safe.
          </p>
          <button type="button" className="px-4 py-3 text-left text-accent" onClick={showCode}>
            I understand — show my recovery code
          </button>
          <button type="button" className="px-4 py-3 text-left text-muted" onClick={onCancel}>
            {cancelLabel}
          </button>
        </>
      ) : null}

      {step === 'code' && pending ? (
        <>
          <p className="px-4 font-mono text-base leading-7 tracking-wide">{pending.code}</p>
          <p className="px-4 text-sm text-muted">
            Write these 12 words down now. They will not be shown again, and nothing has been
            saved yet.
          </p>
          <button
            type="button"
            disabled={busy}
            className="px-4 py-3 text-left text-accent disabled:opacity-50"
            onClick={enable}
          >
            {busy ? 'Enabling…' : 'I have written it down — enable Secure Backup'}
          </button>
          <button type="button" className="px-4 py-3 text-left text-muted" onClick={abandon}>
            {cancelLabel}
          </button>
        </>
      ) : null}

      {step === 'done' ? (
        <p className="px-4 text-sm text-muted">
          Secure Backup is on. Messages from now on can be recovered with your code.
        </p>
      ) : null}
    </div>
  );
}
