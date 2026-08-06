/**
 * Setting the backup lock, and opening it.
 *
 * One component for both, because they are the same three questions asked in a
 * different order: which method, what secret, and does it work. Splitting them
 * into two screens is how the wording drifts until "passcode" on one and
 * "password" on the other are the same field.
 *
 * ## What this is not
 *
 * It is not a login, and nothing here is checked against a server. The secret
 * opens a sealed file or it does not; "wrong" means the archive key did not
 * come out. There is no attempt counter for the same reason there is no
 * password reset: nobody, including PINGO, holds anything to compare against.
 *
 * ## Why the passkey is offered first, and only when it works
 *
 * A face or a fingerprint is the one credential people never lose and never
 * write on a sticky note. But PRF support is uneven, so the option only appears
 * where the platform has said it can — measured without creating anything — and
 * a device that turns out to be unable to produce PRF says so *before* anything
 * is sealed to it.
 */
import { cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import {
  passcodeStrength,
  type LockMethod,
  type PasscodeKind,
} from '../../lib/backup/passkey-lock.js';
import { canCarryEffortlessBackup, measurePasskeySupport } from '../../lib/backup/passkey-support.js';
import { isNative } from '../native/shell.js';
import { createBackupPasskey, passkeyPrf, PasskeyError } from '../../lib/backup/webauthn-prf.js';

export interface SecretChoice {
  method: LockMethod;
  secret: string | Uint8Array;
  passcodeKind?: PasscodeKind;
  credentialId?: string;
}

const KIND_LABEL: Record<PasscodeKind, string> = {
  password: 'Password',
  pin: 'PIN',
  pattern: 'Pattern',
};

const KIND_HINT: Record<PasscodeKind, string> = {
  password: 'Twelve characters or more, with a mix. Nothing you use elsewhere.',
  pin: 'Six digits or more. A four-digit PIN is one of ten thousand.',
  pattern: 'Six dots or more, entered as the numbers you connect.',
};

/**
 * Choose a method and produce a secret.
 *
 * `onChosen` receives raw secret material and nothing else — no storage, no
 * network, no key. What to do with it is the caller's business, which is what
 * keeps this component usable for setting a lock, changing one, and opening one.
 */
export function BackupLockPicker({
  purpose,
  account,
  onChosen,
  onCancel,
}: {
  /** Changes the words only. The mechanism is identical. */
  purpose: 'set' | 'change' | 'unlock';
  account?: { userId: string; userName: string; displayName: string };
  onChosen: (choice: SecretChoice) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [passkeyReady, setPasskeyReady] = useState<boolean>();
  const [kind, setKind] = useState<PasscodeKind>('password');
  const [value, setValue] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void measurePasskeySupport()
      .then((caps) => {
        if (active) setPasskeyReady(canCarryEffortlessBackup(caps));
      })
      .catch(() => {
        if (active) setPasskeyReady(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const confirming = purpose !== 'unlock';
  const verdict = passcodeStrength(value, kind);
  const mismatch = confirming && again.length > 0 && again !== value;
  const blocked =
    value.length === 0 || busy || (confirming && (verdict === 'too-short' || mismatch || again !== value));

  const usePasskey = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (purpose === 'unlock') {
        onChosen({ method: 'passkey', secret: await passkeyPrf() });
        return;
      }
      if (!account) throw new PasskeyError('No account to attach a passkey to.', 'failed');
      const made = await createBackupPasskey(account);
      await onChosen({ method: 'passkey', secret: made.prf, credentialId: made.credentialId });
    } catch (cause) {
      setError(
        cause instanceof PasskeyError
          ? cause.code === 'cancelled'
            ? 'The prompt was dismissed. Nothing changed.'
            : cause.message
          : 'That did not work.',
      );
    } finally {
      setBusy(false);
    }
  };

  const usePasscode = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onChosen({ method: 'passcode', secret: value, passcodeKind: kind });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
      setValue('');
      setAgain('');
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {/*
        The passkey path, when the platform can carry it. `undefined` means the
        measurement has not come back yet, and showing a button that might
        vanish is worse than a moment with one option.
      */}
      {passkeyReady && (purpose === 'unlock' || account) ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void usePasskey()}
          className={cn(
            'rounded-xl bg-brand-gradient px-4 py-3 text-left text-body font-medium text-on-brand',
            'shadow-brand disabled:opacity-60',
          )}
        >
          {purpose === 'unlock'
            ? 'Unlock with Face ID, fingerprint or screen lock'
            : 'Use Face ID, fingerprint or screen lock'}
        </button>
      ) : null}

      {passkeyReady && (purpose === 'unlock' || account) ? (
        <p className="text-caption text-text-tertiary">
          {purpose === 'unlock' ? 'Or enter what you set:' : 'Or set something you type:'}
        </p>
      ) : null}

      {/*
        Say why the passkey button is missing, rather than just not drawing it.

        Inside the Android app this runs in a WebView, and a WebView has no
        WebAuthn - so `passkeyReady` is false and the button vanished with no
        explanation. Somebody who locked their backup with a passkey saw only a
        passcode box that could never open it, and no reason for it. An absent
        option is indistinguishable from a broken screen.
      */}
      {passkeyReady === false && purpose === 'unlock' && isNative() ? (
        <p className="rounded-lg bg-sunken px-3 py-2.5 text-caption text-text-secondary">
          Face ID, fingerprint and screen lock cannot be used inside the app yet - Android
          does not offer them to it. If that is what you locked your backup with, restore it
          in a browser at <span className="text-ink">pingochat.pages.dev</span>, or add a passcode
          there and it will work in both places.
        </p>
      ) : null}

      {purpose !== 'unlock' ? (
        <div className="flex gap-2">
          {(['password', 'pin', 'pattern'] as PasscodeKind[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setKind(option);
                setValue('');
                setAgain('');
              }}
              className={cn(
                'flex-1 rounded-full px-3 py-1.5 text-caption',
                kind === option ? 'bg-brand text-on-brand' : 'bg-sunken text-text-secondary',
              )}
            >
              {KIND_LABEL[option]}
            </button>
          ))}
        </div>
      ) : null}

      <input
        type="password"
        inputMode={kind === 'pin' || kind === 'pattern' ? 'numeric' : 'text'}
        autoComplete={purpose === 'unlock' ? 'current-password' : 'new-password'}
        value={value}
        placeholder={purpose === 'unlock' ? 'Your password, PIN or pattern' : KIND_LABEL[kind]}
        onChange={(event) => setValue(event.target.value)}
        className="rounded-lg bg-surface px-3 py-2.5 text-body"
      />

      {confirming ? (
        <input
          type="password"
          autoComplete="new-password"
          value={again}
          placeholder={`Repeat ${KIND_LABEL[kind].toLowerCase()}`}
          onChange={(event) => setAgain(event.target.value)}
          className="rounded-lg bg-surface px-3 py-2.5 text-body"
        />
      ) : null}

      {confirming ? (
        <p
          className={cn(
            'text-caption',
            mismatch
              ? 'text-danger'
              : verdict === 'too-short'
                ? 'text-text-tertiary'
                : verdict === 'weak'
                  ? 'text-warning'
                  : 'text-text-secondary',
          )}
        >
          {mismatch
            ? 'Those two do not match.'
            : verdict === 'weak'
              ? `Weak — anyone holding the file can guess it. ${KIND_HINT[kind]}`
              : KIND_HINT[kind]}
        </p>
      ) : null}

      {/*
        Said before anything is sealed, not after. There is no reset, because a
        reset would mean somebody at PINGO could open the backup.
      */}
      {purpose !== 'unlock' ? (
        <p className="text-caption text-warning">
          If you forget this, your backup cannot be opened — not by you, and not by us.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={blocked}
          onClick={() => void usePasscode()}
          className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-body font-medium text-on-brand disabled:opacity-50"
        >
          {busy
            ? 'Working…'
            : purpose === 'unlock'
              ? 'Unlock'
              : purpose === 'change'
                ? 'Change it'
                : 'Set it'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-4 py-2.5 text-body text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
