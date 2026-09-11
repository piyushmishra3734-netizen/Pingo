import { AuthError, useAuth } from '@pingo/core';
import { Button } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { CodeBoxes } from '../../features/auth/CodeBoxes.js';
import { FunnelTextLink } from '../../features/auth/FunnelCta.js';
import { useIdentityFlow } from '../../features/auth/IdentityFlow.js';
import { authErrorMessage } from '../../features/auth/messages.js';
import { useT } from '../../features/i18n/useT.js';
import { SIGNUP_PROGRESS } from './progress.js';

/**
 * Sign-up, step 2 (phone): the code.
 *
 * This is the step § 6.2 always specified and the product shipped without.
 * `SignUpPhoneScreen` said what that cost in as many words - "a number on an
 * account is a claim, not a fact", and contact discovery cannot be built on
 * claims, because matching people by an unverified number lets anyone be found
 * as anyone. This closes that.
 *
 * ## Six boxes, one field
 *
 * The boxes are drawn over a single input (`CodeBoxes`), because
 * `autoComplete="one-time-code"`, paste and a screen reader all need one field
 * and six separate inputs break every one of them. A full code sends itself.
 *
 * ## Resending costs money, so it is on a timer
 *
 * Every send is an SMS somebody pays for, and a button with no cooldown gets
 * pressed four times while the first message is still in flight. Thirty seconds
 * is long enough that the first one has arrived or failed.
 */

/** Long enough for the first message to arrive or not. */
const RESEND_SECONDS = 30;

/** What 2Factor sends. Anything else is a typo, not a code. */
const CODE_LENGTH = 6;

export function SignUpPhoneCodeScreen() {
  const navigate = useNavigate();
  const t = useT();
  const { service } = useAuth();
  const { identity } = useIdentityFlow();

  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [waitFor, setWaitFor] = useState(RESEND_SECONDS);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (waitFor <= 0) return undefined;
    const timer = window.setTimeout(() => setWaitFor((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [waitFor]);

  // `IdentityFlow` sends anybody without one back to the start; this is the
  // type guard, and it would only ever fire if that redirect were removed.
  if (!identity || identity.kind !== 'phone') return null;

  const ready = code.length === CODE_LENGTH && !checking;

  const submit = async (entered = code) => {
    if (entered.length !== CODE_LENGTH || checking) return;

    setChecking(true);
    setError(undefined);

    try {
      await service.phoneOtp.verify(identity.value, entered);
      /*
       * The account exists and this tab is signed in to it. The password screen
       * next sets the password that returning visits will use - it does not
       * create anything, which is why it must not call `signUp` from here.
       */
      navigate('/signup/password');
    } catch (cause) {
      setError(authErrorMessage(cause, 'signIn'));
      /*
       * Focus back with the code selected, so the next keystroke replaces it -
       * the same treatment a rejected password gets. Retyping six digits around
       * a wrong one is the kind of small friction people give up on.
       */
      inputRef.current?.focus();
      inputRef.current?.select();
    } finally {
      setChecking(false);
    }
  };

  const resend = async () => {
    setError(undefined);
    setWaitFor(RESEND_SECONDS);
    try {
      await service.phoneOtp.start(identity.value);
    } catch (cause) {
      // The timer still runs: a failed send is not a reason to let somebody
      // spend four more in the next ten seconds.
      setError(
        cause instanceof AuthError
          ? authErrorMessage(cause, 'signIn')
          : 'That did not send. Try again in a moment.',
      );
    }
  };

  return (
    <AuthScreen
      progress={SIGNUP_PROGRESS.code}
      title={t('auth.codeTitle')}
      subtitle={t('auth.codeSubtitle', { number: identity.value })}
      onBack={() => navigate('/signup/phone')}
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
          {t('common.continue')}
        </Button>
      }
    >
      <CodeBoxes
        inputRef={inputRef}
        label={t('auth.codeLabel')}
        value={code}
        onChange={(next) => {
          setCode(next);
          setError(undefined);
        }}
        onComplete={(full) => void submit(full)}
        length={CODE_LENGTH}
        autoFocus
        invalid={Boolean(error)}
      />

      <div className="mt-4 text-center">
        {waitFor > 0 ? (
          <span className="text-caption text-text-tertiary">
            {t('auth.codeResendIn', { seconds: String(waitFor) })}
          </span>
        ) : (
          <FunnelTextLink onClick={() => void resend()}>{t('auth.codeResend')}</FunnelTextLink>
        )}
      </div>
    </AuthScreen>
  );
}
