import { AuthError, useAuth } from '@pingo/core';
import { Button } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { CodeBoxes } from '../../features/auth/CodeBoxes.js';
import { CodeResend } from '../../features/auth/CodeResend.js';
import { OtpLimitError, otpStatus, type OtpChannel, type OtpQuota } from '../../features/auth/otp-quota.js';
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

/** What Twilio sends. Anything else is a typo, not a code. */
const CODE_LENGTH = 6;

/**
 * How long a code works: the call reads it out, and it stops working five
 * minutes later. Shown as a countdown so nobody types a dead code and wonders
 * why it is "wrong" - once it runs out, the screen says so and offers a new call.
 */
const CODE_LIFETIME_MS = 5 * 60 * 1000;

export function SignUpPhoneCodeScreen() {
  const navigate = useNavigate();
  const t = useT();
  const { service } = useAuth();
  const { identity } = useIdentityFlow();

  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [waitFor, setWaitFor] = useState(RESEND_SECONDS);
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + CODE_LIFETIME_MS);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  // The first code went by SMS (the phone screen asked for it); what is left is read from the server.
  const location = useLocation();
  const [via, setVia] = useState<OtpChannel>(() => ((location.state as { via?: OtpChannel } | null)?.via === 'call' ? 'call' : 'sms'));
  const [quota, setQuota] = useState<OtpQuota>();
  const [busy, setBusy] = useState<OtpChannel>();
  useEffect(() => {
    if (identity?.kind === 'phone') void otpStatus(identity.value).then((q) => q && setQuota(q));
  }, [identity]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(tick);
  }, []);
  const left = Math.max(0, expiresAt - now);
  const expired = left === 0;

  useEffect(() => {
    if (waitFor <= 0) return undefined;
    const timer = window.setTimeout(() => setWaitFor((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [waitFor]);

  // `IdentityFlow` sends anybody without one back to the start; this is the
  // type guard, and it would only ever fire if that redirect were removed.
  if (!identity || identity.kind !== 'phone') return null;

  const ready = code.length === CODE_LENGTH && !checking && !expired;

  const submit = async (entered = code) => {
    if (entered.length !== CODE_LENGTH || checking || expired) return;

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

  const resend = async (channel: OtpChannel) => {
    setError(undefined);
    setBusy(channel);
    try {
      await service.phoneOtp.start(identity.value, channel);
      setVia(channel);
      setCode('');
      setExpiresAt(Date.now() + CODE_LIFETIME_MS);
      setQuota((q) => (q ? { ...q, left: { ...q.left, [channel]: Math.max(0, q.left[channel] - 1) } } : q));
    } catch (cause) {
      if (cause instanceof OtpLimitError) setQuota(cause.quota);
      setError(
        cause instanceof OtpLimitError
          ? cause.channel === 'call'
            ? 'No calls left for now. Try a text instead.'
            : 'No texts left for now. Try a call instead.'
          : cause instanceof AuthError
            ? authErrorMessage(cause, 'signIn')
            : 'That did not send. Try again in a moment.',
      );
    } finally {
      // The timer runs either way: a failed send is not a reason to spend four more in ten seconds.
      setWaitFor(RESEND_SECONDS);
      setBusy(undefined);
    }
  };

  return (
    <AuthScreen
      progress={SIGNUP_PROGRESS.code}
      title={via === 'call' ? "Pick up, we're calling" : t('auth.codeTitle')}
      subtitle={via === 'call' ? `Pick up: a voice will read your code to ${identity.value}.` : t('auth.codeSubtitle', { number: identity.value })}
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

      <CodeClock left={left} />

      <CodeResend via={via} quota={quota} waitFor={expired ? 0 : waitFor} busy={busy} onSend={(c) => void resend(c)} />
    </AuthScreen>
  );
}

/** The code's remaining life, as a ring and a sentence. */
function CodeClock({ left }: { left: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const seconds = Math.ceil(left / 1000);
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const expired = left === 0;
  return (
    <div className="mt-6 flex items-center gap-3.5" role="timer" aria-live="off">
      <div className="relative size-12 shrink-0">
        <svg viewBox="0 0 48 48" className="size-12 -rotate-90" aria-hidden>
          <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-line" />
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            stroke="#e0559b"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - left / CODE_LIFETIME_MS)}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[12px] font-bold tabular-nums text-ink">{label}</span>
      </div>
      <p className="text-caption leading-snug text-text-secondary">
        {expired ? (
          <>
            <span className="font-semibold text-danger">This code expired.</span> Ask for a new call below.
          </>
        ) : (
          <>
            <span className="font-semibold text-ink">Code works for 5 min.</span> After that, ask for a new call.
          </>
        )}
      </p>
    </div>
  );
}
