import { AuthError, assessPassword, useAuth } from '@pingo/core';
import { Button } from '@pingo/ui';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { formatIdentity, useIdentityFlow } from '../../features/auth/IdentityFlow.js';
import { PasswordField } from '../../features/auth/PasswordField.js';
import { PasswordMeter } from '../../features/auth/PasswordMeter.js';
import { writeLastMethod } from '../../features/auth/last-method.js';
import { authErrorMessage } from '../../features/auth/messages.js';
import { useT } from '../../features/i18n/useT.js';
import { SIGNUP_PROGRESS } from './progress.js';

/**
 * Sign-up, step 2  - 
 * [docs/01 § 8](../../../../../docs/01-onboarding-auth.md#8-create-password).
 *
 * **This screen creates the account.** With verification gone it is the last
 * step of sign-up, so Continue is the moment the identifier and the password
 * are sent together - which is also why it can fail in ways § 8 never had to
 * consider, and why it carries a message slot the wireframe does not show.
 *
 * One screen serves both doors. The identifier came from `IdentityFlow` and is
 * only read for the recap line and to pick which service to call; nothing else
 * here branches on email versus phone.
 *
 * **There is no confirm field**, per § 8.1 - the reveal toggle solves the typo
 * problem a confirm field exists for, without doubling the typing or fighting a
 * password manager that fills one box and not the other.
 *
 * ## Missing, deliberately
 *
 * The **Emergency Password** (§ 7) is not built: a recovery code has to be
 * stored and verified server-side, which needs schema this phase does not
 * create.
 */
export function CreatePasswordScreen() {
  const navigate = useNavigate();
  const t = useT();
  const { service } = useAuth();
  const { identity } = useIdentityFlow();

  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const assessment = useMemo(() => assessPassword(password), [password]);

  // `IdentityFlow` redirects before this renders without one; this satisfies the
  // type and would only ever fire if that guard were removed.
  //
  // `username` is refused for a different reason: it is a log-in-only kind and
  // there is no account to attach a password to yet, so no sign-up route can
  // reach here with one.
  if (!identity || identity.kind === 'username') return null;

  // Picked out here rather than as `service[identity.kind]` inside `submit`:
  // narrowing a *property* does not survive into a closure, so the guard above
  // would not convince the compiler that `signUp` exists.
  const door = identity.kind === 'email' ? service.email : service.phone;

  const submit = async () => {
    if (!assessment.valid || saving) return;

    setSaving(true);
    setError(undefined);

    try {
      await door.signUp(identity.value, password);
      writeLastMethod(identity.kind);
      // Phase 2 ends at Home. Profile Setup, Theme, Notifications and Contacts
      // (§ 9-12) slot in between here and `/chats` when they are built.
      navigate('/chats', { replace: true });
    } catch (cause) {
      /*
       * § 17: an identifier that already has an account never creates a second
       * one - that is unrecoverable in a messaging product, because the wrong
       * account holds the conversations. Route to Log In with the identifier
       * carried across, so the user continues rather than starts again.
       */
      if (cause instanceof AuthError && cause.code === 'identity_exists') {
        navigate('/login/password', { replace: true, state: { identity, collision: true } });
        return;
      }

      setError(authErrorMessage(cause, 'signUp'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthScreen
      progress={SIGNUP_PROGRESS.password}
      title={t('auth.passwordCreate')}
      subtitle={t('auth.passwordCreateSub')}
      onBack={() => navigate(identity.kind === 'email' ? '/signup/email' : '/signup/phone')}
      message={error && <AuthMessage>{error}</AuthMessage>}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!assessment.valid}
          loading={saving}
          onClick={submit}
        >
          Create account
        </Button>
      }
    >
      {/* Which account is being made. Same recap pattern as § 13.2. */}
      <p className="mb-6 truncate text-caption text-text-secondary">
        {formatIdentity(identity)}
      </p>

      <PasswordField
        value={password}
        onChange={(next) => {
          setPassword(next);
          setError(undefined);
        }}
        autoComplete="new-password"
        autoFocus
        disabled={saving}
        onSubmit={submit}
      />

      <PasswordMeter assessment={assessment} />
    </AuthScreen>
  );
}
