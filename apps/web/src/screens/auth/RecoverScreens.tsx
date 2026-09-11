import { Button } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { CodeBoxes } from '../../features/auth/CodeBoxes.js';
import { FunnelTextLink } from '../../features/auth/FunnelCta.js';
import { PasswordField } from '../../features/auth/PasswordField.js';
import {
  recoveryErrorMessage,
  setNewPassword,
  startRecovery,
  verifyRecovery,
  type RecoveryIdentity,
} from '../../features/auth/recovery.js';

/**
 * Forgot password: a call with a code, then a new password.
 *
 * ## Outside the guest guard, on purpose
 *
 * The right code signs this tab in. Every screen under `RequireGuest` is sent
 * on to the app the moment that happens, so a code screen there would race its
 * own success and lose - the new-password step would never be seen. So these
 * two routes sit beside `/auth/google` instead, and the identity comes in
 * navigation state from the password screen rather than from `IdentityFlow`.
 *
 * ## One send per visit
 *
 * The code is sent when the screen opens, once - guarded by a ref, because
 * StrictMode runs the effect twice in development and a second send inside a
 * minute is both a rate limit and a call nobody asked for.
 */

/** What 2Factor reads out. Anything else is a typo, not a code. */
const CODE_LENGTH = 6;

/** Every send is a paid call, so resending waits a minute. */
const RESEND_SECONDS = 60;

/** The shortest password this screen will send. Supabase enforces its own on top. */
const MIN_PASSWORD = 8;

export function RecoverCodeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const identity = (location.state as { identity?: RecoveryIdentity } | null)?.identity;

  const [phase, setPhase] = useState<'sending' | 'sent' | 'no_phone'>('sending');
  const [ending, setEnding] = useState('');
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const [waitFor, setWaitFor] = useState(RESEND_SECONDS);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const send = async () => {
    if (!identity) return;
    setError(undefined);
    setWaitFor(RESEND_SECONDS);
    try {
      const result = await startRecovery(identity);
      if (result.status === 'no_phone') {
        setPhase('no_phone');
        return;
      }
      setEnding(result.ending);
      setPhase('sent');
    } catch (cause) {
      // Still the code screen, so resending is there once the minute is up.
      setPhase('sent');
      setError(recoveryErrorMessage(cause));
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
    // Once per visit - see the note at the top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (waitFor <= 0) return undefined;
    const timer = window.setTimeout(() => setWaitFor((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [waitFor]);

  if (!identity) return <Navigate to="/login" replace />;

  if (phase === 'no_phone') {
    return (
      <AuthScreen
        title="No number on this account"
        subtitle="There is no phone number on this account to call with a code. If you made it with Google, sign in with Google - PINGO will offer to add your number once you are in."
        onBack={() => navigate('/login', { replace: true })}
        footer={
          <Button variant="primary" size="lg" block onClick={() => navigate('/login', { replace: true })}>
            Back to sign in
          </Button>
        }
      >
        <span />
      </AuthScreen>
    );
  }

  const ready = code.length === CODE_LENGTH && !checking;

  const submit = async (entered = code) => {
    if (entered.length !== CODE_LENGTH || checking) return;
    setChecking(true);
    setError(undefined);
    try {
      await verifyRecovery(identity, entered);
      navigate('/recover/password', { replace: true });
    } catch (cause) {
      setError(recoveryErrorMessage(cause));
      inputRef.current?.focus();
      inputRef.current?.select();
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthScreen
      title="Reset your password"
      subtitle={
        phase === 'sending'
          ? 'Getting a call ready with your code…'
          : `We're calling the number ending in ${ending} with a 6-digit code. Pick up and type it here.`
      }
      onBack={() => navigate('/login', { replace: true })}
      message={error && <AuthMessage>{error}</AuthMessage>}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready}
          loading={checking}
          onClick={() => void submit()}
        >
          Continue
        </Button>
      }
    >
      <CodeBoxes
        inputRef={inputRef}
        value={code}
        onChange={(next) => {
          setCode(next);
          setError(undefined);
        }}
        onComplete={(full) => void submit(full)}
        length={CODE_LENGTH}
        autoFocus
        disabled={phase === 'sending'}
        invalid={Boolean(error)}
      />

      <div className="mt-4 text-center">
        {waitFor > 0 ? (
          <span className="text-caption text-text-tertiary">Call again in {waitFor}s</span>
        ) : (
          <FunnelTextLink onClick={() => void send()}>Call me again</FunnelTextLink>
        )}
      </div>

      {/*
        Shown every time, whether or not a call is on its way - which is the only
        way it can be said at all. A number with no account gets no call and the
        same screen, so that nobody can learn which numbers have PINGO; the
        person it most often happens to is somebody who signed up with Google
        and never added their number, and they deserve to know where to go.
      */}
      {identity.kind === 'phone' && phase === 'sent' && (
        <p className="mt-6 text-center text-caption text-text-tertiary">
          No call after a minute? This number may not be on a PINGO account. If you
          signed up with Google, go back and continue with Google.
        </p>
      )}
    </AuthScreen>
  );
}

/**
 * The new password, on the session the code just produced.
 *
 * No back button: they are signed in now, and "back" would be to a code screen
 * whose code is spent. Leaving without saving leaves them signed in with the
 * old password still in force, which is safe - they can come back here.
 */
export function ResetPasswordScreen() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const ready = password.length >= MIN_PASSWORD && !saving;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(undefined);
    try {
      await setNewPassword(password);
      navigate('/invite', { replace: true });
    } catch (cause) {
      setError(recoveryErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthScreen
      title="Choose a new password"
      subtitle="You're back in. This is the password you'll use next time."
      showBack={false}
      message={error && <AuthMessage>{error}</AuthMessage>}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready}
          loading={saving}
          onClick={() => void save()}
        >
          Save password
        </Button>
      }
    >
      <PasswordField
        label="New password"
        value={password}
        onChange={(next) => {
          setPassword(next);
          setError(undefined);
        }}
        autoComplete="new-password"
        invalid={Boolean(error)}
        disabled={saving}
        autoFocus
        onSubmit={() => void save()}
      />
      <p className="mt-2 text-caption text-text-tertiary">At least {MIN_PASSWORD} characters.</p>
    </AuthScreen>
  );
}
