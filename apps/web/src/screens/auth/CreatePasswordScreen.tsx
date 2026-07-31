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
  const { service } = useAuth();
  const { identity } = useIdentityFlow();

  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const assessment = useMemo(() => assessPassword(password), [password]);

  // `IdentityFlow` redirects before this renders without one; this satisfies the
  // type and would only ever fire if that guard were removed.
  if (!identity) return null;

  const submit = async () => {
    if (!assessment.valid || saving) return;

    setSaving(true);
    setError(undefined);

    try {
      await service[identity.kind].signUp(identity.value, password);
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
      title="Create a password"
      subtitle="This is what you'll use to sign in."
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
