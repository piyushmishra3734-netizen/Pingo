import { AuthError, assessPassword, useAuth } from '@pingo/core';
import { Button, cn } from '@pingo/ui';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PasswordField } from '../../features/auth/PasswordField.js';
import { PasswordMeter } from '../../features/auth/PasswordMeter.js';
import { Group, SettingsPage } from '../../features/settings/controls.js';

/**
 * Settings → Password.
 *
 * The row on Account used to read `••••••••` and do nothing, with a note
 * explaining that changing a sign-in method needs re-authentication first. That
 * was honest, but it left the product with no way to change a password at all -
 * which matters more now that a username can be used to sign in: a handle is
 * public by design, so the password behind it is the only secret, and a secret
 * you cannot rotate is one you are stuck with after every scare.
 *
 * ## The current password is asked for, and it is not a formality
 *
 * A signed-in tab is not proof of who is sitting at the keyboard. Without this
 * field, a borrowed laptop left open is an account takeover in three taps -
 * set a new password, and the owner is locked out of their own conversations
 * with no way back in. `changePassword` verifies by signing in with the old
 * one, so a wrong answer fails before anything is written.
 *
 * ## Other devices are left alone
 *
 * Changing a password here does not sign anybody out of their phone. That is
 * the same decision as `signOut` being local: this is routine maintenance, and
 * a change that silently ends every session is what teaches people not to
 * bother. Kicking out other devices belongs to a "someone else has my account"
 * flow, which is a different button that should say so.
 *
 * ## No confirm field
 *
 * Same reasoning as sign-up (docs/01 § 8.1) - the reveal control solves the
 * typo problem a confirm field exists for, without doubling the typing.
 */
export function ChangePasswordScreen() {
  const navigate = useNavigate();
  const { service, session } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  const assessment = useMemo(() => assessPassword(next), [next]);

  /*
   * A Google-only account has no password, so there is nothing to change. Said
   * plainly rather than shown as a form that always fails - the useful next
   * step is adding an email, not guessing at a password that was never set.
   */
  const googleOnly = session?.user.methods.every((method) => method === 'google') ?? false;

  const ready = current.length > 0 && assessment.valid && current !== next && !saving;

  const submit = async () => {
    if (!ready) return;

    setSaving(true);
    setError(undefined);

    try {
      await service.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  if (googleOnly) {
    return (
      <SettingsPage title="Password">
        <Group note="Adding an email address to this account is not built yet, so there is no way to set a password on it today.">
          <div className="px-3 py-4">
            <p className="text-body text-ink">This account signs in with Google.</p>
            <p className="mt-1 text-caption text-text-secondary">
              Google holds the password, and you change it there.
            </p>
          </div>
        </Group>
      </SettingsPage>
    );
  }

  if (done) {
    return (
      <SettingsPage title="Password">
        <Group>
          <div className="px-3 py-4">
            <p className="text-body text-ink">Password changed.</p>
            <p className="mt-1 text-caption text-text-secondary">
              Use the new one next time you sign in. Your other devices are still signed in.
            </p>
          </div>
        </Group>

        <Button variant="primary" size="lg" block onClick={() => navigate(-1)}>
          Done
        </Button>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title="Password">
      {/*
        No group headings. "CURRENT PASSWORD" above a field labelled "Current
        password" says the same word twice and makes two fields look like two
        sections of a form.
      */}
      <Group>
        <div className="px-3 py-3">
          <PasswordField
            label="Current password"
            value={current}
            onChange={(value) => {
              setCurrent(value);
              setError(undefined);
            }}
            autoComplete="current-password"
            invalid={Boolean(error)}
            disabled={saving}
            autoFocus
          />
        </div>
      </Group>

      <Group>
        <div className="px-3 py-3">
          <PasswordField
            label="New password"
            value={next}
            onChange={(value) => {
              setNext(value);
              setError(undefined);
            }}
            autoComplete="new-password"
            disabled={saving}
            onSubmit={submit}
          />
          <div className="mt-3">
            <PasswordMeter assessment={assessment} />
          </div>
        </div>
      </Group>

      {(error || (next.length > 0 && current === next)) && (
        <p role="alert" className={cn('mb-4 px-1 text-caption text-danger')}>
          {error ?? 'That is the password you already have.'}
        </p>
      )}

      <Button
        variant="primary"
        size="lg"
        block
        disabled={!ready}
        loading={saving}
        onClick={submit}
      >
        Change password
      </Button>
    </SettingsPage>
  );
}

/**
 * Which of the two fields was wrong.
 *
 * Unlike the login screen, being specific here is safe and necessary: whoever
 * is reading this is already signed in, so nothing is revealed that they could
 * not see anyway - and "that didn't work" would leave them retyping a new
 * password when the problem was the old one.
 */
function messageFor(cause: unknown): string {
  if (!(cause instanceof AuthError)) return "That didn't save. Try again.";

  if (cause.code === 'invalid_credentials') return "That's not your current password.";
  if (cause.code === 'weak_password') return 'Pick a stronger password.';
  if (cause.code === 'rate_limited') return 'Too many attempts. Try again in a few minutes.';
  if (cause.code === 'offline') return "You're offline. Try again when you're back.";
  if (cause.code === 'provider_disabled') {
    return 'This account signs in with Google and has no password.';
  }

  return "That didn't save. Try again.";
}
