import { useAuth } from '@pingo/core';
import { Button } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { formatIdentity, useIdentityFlow } from '../../features/auth/IdentityFlow.js';
import { PasswordField } from '../../features/auth/PasswordField.js';
import { writeLastMethod } from '../../features/auth/last-method.js';
import { ALREADY_REGISTERED_MESSAGE, authErrorMessage } from '../../features/auth/messages.js';

/**
 * Log In — [docs/01 § 13.2](../../../../../docs/01-onboarding-auth.md#132-password).
 *
 * The details in that section are the whole design, and each is a decision:
 *
 * | | |
 * | --- | --- |
 * | Identity recap with `Change` | The user can see which account they are entering, and correct it without starting over |
 * | Generic failure | *"That password doesn't match"* covers a wrong password **and** an identifier with no account. Anything more specific is an enumeration oracle |
 * | Focus returns, content selected | The next keystroke replaces the attempt. No clearing the field for them |
 * | **No shake** | § 13.2: a shake is a scold, and the user already knows |
 * | Rate limiting surfaced | With a countdown and a reason. A user who does not know they are throttled assumes the app is broken |
 * | Loading keeps the width | `Button`'s `loading` swaps the label for the brand dots without reflowing |
 *
 * One screen serves both doors, exactly as `CreatePasswordScreen` does.
 *
 * It is also where sign-up lands when § 17 fires: an identifier that already has
 * an account arrives here with `collision` set, and the screen opens with
 * *"Looks like you're already with us."* rather than an empty field and no
 * explanation of why the sign-up did not go through.
 *
 * ## Missing, and why
 *
 * § 13.2 puts **Forgot password?** above the primary action. It is not here: the
 * triage it opens (§ 14) offers an email reset link, the Emergency Password
 * (§ 15) and Contact Support (§ 16), and none of those exist yet. A link to a
 * screen that cannot help is worse than its absence — it spends the user's trust
 * at the exact moment they are already stuck.
 */

const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 300;

export function LoginPasswordScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { service } = useAuth();
  const { identity } = useIdentityFlow();

  const collision = (location.state as { collision?: boolean } | null)?.collision === true;

  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  const lockedOut = cooldown > 0;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => {
        if (value <= 1) {
          setAttempts(0);
          setError(undefined);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  if (!identity) return null;

  const changePath = identity.kind === 'email' ? '/login/email' : '/login/phone';

  const submit = async () => {
    if (password === '' || signingIn || lockedOut) return;

    setSigningIn(true);
    setError(undefined);

    try {
      await service[identity.kind].signIn(identity.value, password);
      writeLastMethod(identity.kind);
      navigate('/chats', { replace: true });
    } catch (cause) {
      const next = attempts + 1;
      setAttempts(next);

      if (next >= MAX_ATTEMPTS) {
        setCooldown(COOLDOWN_SECONDS);
      } else {
        setError(authErrorMessage(cause, 'signIn'));
        // Focus returns with the attempt selected, so retyping replaces it.
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    } finally {
      setSigningIn(false);
    }
  };

  const clock = `${Math.floor(cooldown / 60)}:${(cooldown % 60).toString().padStart(2, '0')}`;

  return (
    <AuthScreen
      title={collision ? 'Welcome back' : 'Enter your password'}
      subtitle={collision ? ALREADY_REGISTERED_MESSAGE : undefined}
      onBack={() => navigate(changePath)}
      message={
        lockedOut ? (
          <AuthMessage>
            Too many attempts. Try again in {clock} — this protects your account.
          </AuthMessage>
        ) : (
          error && <AuthMessage>{error}</AuthMessage>
        )
      }
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          disabled={password === '' || lockedOut}
          loading={signingIn}
          onClick={submit}
        >
          Log In
        </Button>
      }
    >
      {/* The identity recap — caption, with Change back to the identifier step. */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-caption text-text-secondary">
          {formatIdentity(identity)}
        </span>
        <Button variant="text" size="sm" onClick={() => navigate(changePath)}>
          Change
        </Button>
      </div>

      <PasswordField
        value={password}
        onChange={(next) => {
          setPassword(next);
          setError(undefined);
        }}
        autoComplete="current-password"
        invalid={Boolean(error)}
        disabled={signingIn || lockedOut}
        autoFocus
        onSubmit={submit}
        inputRef={inputRef}
      />
    </AuthScreen>
  );
}
