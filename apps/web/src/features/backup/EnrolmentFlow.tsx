import { useState } from 'react';

import { BackupLockPicker, type SecretChoice } from './BackupLock.js';
import { beginEnrolment, completeEnrolment } from '../../lib/backup/secure-backup.js';
import type { BackupTarget } from '../../lib/backup/target.js';

/**
 * Enrolling in Secure Backup, once, for everywhere that offers it.
 *
 * Onboarding and Settings present this differently - one is a step in a flow
 * the user is being walked through, the other is a page they went looking for  - 
 * but the *operation* is identical, and the parts that must not drift are the
 * warning, the two-step order, and what happens when somebody backs out. Two
 * copies of that would eventually disagree, and the copy that quietly stopped
 * saying "only future messages" would be the one nobody noticed.
 *
 * So the sequence lives here and the surroundings are passed in.
 */
export type EnrolmentStep = 'explain' | 'choose' | 'done';

/** PRF bytes as a string, so both methods reach the same KDF. */
const asSecret = (choice: SecretChoice): string =>
  typeof choice.secret === 'string'
    ? choice.secret
    : btoa(String.fromCharCode(...choice.secret));

export function EnrolmentFlow({
  targets,
  account,
  existingSecret,
  onDone,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  targets: BackupTarget[];
  /** Needed only to name the passkey in the platform prompt. */
  account?: { userId: string; userName: string; displayName: string };
  /**
   * A secret the user has already chosen this session.
   *
   * When the Drive lock was set first, asking again would be asking for a
   * second secret to protect the same history — and two secrets is how people
   * end up with one they cannot remember. Given one, this enrols with it and
   * never shows the picker.
   */
  existingSecret?: SecretChoice;
  /** Receives what was chosen, so the caller can use the *same* secret. */
  onDone: (choice: SecretChoice) => void;
  onCancel: () => void;
  /** Onboarding calls this "Not now"; Settings calls it "Cancel". */
  cancelLabel?: string;
}) {
  const [step, setStep] = useState<EnrolmentStep>('explain');
  const [error, setError] = useState<string | undefined>();

  /**
   * One step, not two.
   *
   * The old sequence showed twelve words and then asked the user to confirm
   * they had written them down — a confirmation of an act almost nobody
   * performed. Choosing a passkey or a passcode *is* the confirmation: the
   * secret exists because they made it, and there is nothing to transcribe.
   */
  const enable = async (choice: SecretChoice) => {
    setError(undefined);
    try {
      const pending = await beginEnrolment(asSecret(choice));
      await completeEnrolment(pending, targets);
      setStep('done');
      onDone(choice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Secure Backup could not be enabled.');
      setStep('explain');
    }
  };

  const abandon = () => {
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
            {existingSecret
              ? 'This uses the same passkey or passcode you already set for your backup — one secret, not two.'
              : 'You choose what unlocks it — Face ID, a fingerprint, your screen lock, or a password, PIN or pattern you set. Nobody at PINGO can reset it or read your messages.'}
          </p>
          <button
            type="button"
            className="px-4 py-3 text-left text-brand"
            onClick={() => (existingSecret ? void enable(existingSecret) : setStep('choose'))}
          >
            {existingSecret ? 'Enable with the lock you already set' : 'Choose how to unlock it'}
          </button>
          <button type="button" className="px-4 py-3 text-left text-muted" onClick={onCancel}>
            {cancelLabel}
          </button>
        </>
      ) : null}

      {step === 'choose' ? (
        <BackupLockPicker
          purpose="set"
          {...(account ? { account } : {})}
          onChosen={(choice) => void enable(choice)}
          onCancel={abandon}
        />
      ) : null}

      {step === 'done' ? (
        <p className="px-4 text-sm text-muted">
          Secure Backup is on. Messages from now on can be recovered with what you just set.
        </p>
      ) : null}
    </div>
  );
}
