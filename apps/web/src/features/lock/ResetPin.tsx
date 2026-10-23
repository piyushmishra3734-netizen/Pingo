import { AuthError, useAuth } from '@pingo/core';
import { Loader2, MessageSquareText, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { CodeBoxes } from '../auth/CodeBoxes.js';
import { CodeResend } from '../auth/CodeResend.js';
import { OtpLimitError, type OtpChannel, type OtpQuota } from '../auth/otp-quota.js';
import { recoveryErrorMessage, startRecovery, verifyRecovery } from '../auth/recovery.js';
import { markResetStarted } from './lock-store.js';

/**
 * Forgot the PIN: prove it is you, then make a new one.
 *
 * Nothing here signs anybody out, and nothing here opens a locked chat. It asks
 * for something a person who only found the phone does not have: a code sent to
 * the account's own number, or the account's Google sign-in. Passing either
 * hands back the pad to make a new PIN; the chats stay locked, and open with it.
 */

const RESEND_SECONDS = 30;

export function ResetPin({ onVerified, onBack }: { onVerified: () => void; onBack: () => void }) {
  const { session, service } = useAuth();
  const user = session?.user;
  const phone = user?.phone;
  const google = user?.methods.includes('google') ?? false;

  const [step, setStep] = useState<'choose' | 'code'>('choose');
  const [via, setVia] = useState<OtpChannel>('sms');
  const [busy, setBusy] = useState<OtpChannel | 'google' | 'check'>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [wait, setWait] = useState(0);
  const [quota, setQuota] = useState<OtpQuota>();
  const [ending, setEnding] = useState('');
  const checked = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(id);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (channel: OtpChannel) => {
    if (!phone) return;
    setBusy(channel);
    setError(undefined);
    try {
      const started = await startRecovery({ kind: 'phone', value: phone }, channel);
      if (started.status !== 'sent') throw new AuthError('unknown', 'No phone on this account.');
      setVia(channel);
      setEnding(started.ending);
      setQuota(started.quota);
      setWait(RESEND_SECONDS);
      setCode('');
      setStep('code');
    } catch (cause) {
      setError(cause instanceof OtpLimitError ? 'No more codes for now. Try again later.' : recoveryErrorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const verify = async (value: string) => {
    if (!phone || checked.current) return;
    checked.current = true;
    setBusy('check');
    setError(undefined);
    try {
      await verifyRecovery({ kind: 'phone', value: phone }, value);
      onVerified();
    } catch (cause) {
      setError(recoveryErrorMessage(cause));
      setCode('');
    } finally {
      checked.current = false;
      setBusy(undefined);
    }
  };

  const withGoogle = async () => {
    setBusy('google');
    setError(undefined);
    try {
      await markResetStarted();
      // Back to the locked chats, where the pad notices it was verified and asks for a new PIN.
      await service.google.start(`${window.location.origin}/chats/locked`);
    } catch (cause) {
      setBusy(undefined);
      setError(recoveryErrorMessage(cause));
    }
  };

  const masked = phone ? `+${phone.replace(/\D/g, '').slice(0, -2).replace(/\d/g, '•')}${phone.replace(/\D/g, '').slice(-2)}` : '';

  return (
    <div className="mx-auto flex w-full max-w-[22rem] flex-1 flex-col items-center justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <span className="grid size-16 place-items-center rounded-full bg-hover text-ink">
        <ShieldCheck size={26} strokeWidth={1.7} aria-hidden />
      </span>
      <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.01em] text-ink">{step === 'code' ? 'Enter the code' : 'Reset your PIN'}</h2>
      <p className="mt-1 text-center text-[14px] leading-snug text-text-secondary">
        {step === 'code'
          ? `We ${via === 'call' ? 'called' : 'texted'} a 6 digit code to ${ending ? `the number ending ${ending}` : masked}.`
          : 'First, let us check it is you. Your locked chats stay locked and open with the new PIN.'}
      </p>

      {step === 'choose' ? (
        <div className="mt-7 flex w-full flex-col gap-2.5">
          {phone && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void send('sms')}
              className="flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left transition-colors duration-instant ease-standard hover:bg-hover focus-ring disabled:opacity-60"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-hover text-ink">
                {busy === 'sms' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <MessageSquareText size={18} aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-ink">Get a code</span>
                <span className="block truncate text-[13px] text-text-secondary">On {masked}</span>
              </span>
            </button>
          )}
          {phone && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void send('call')}
              className="-mt-1 self-start rounded-full px-3 py-1 text-[13px] font-medium text-brand hover:bg-hover focus-ring disabled:opacity-60"
            >
              {busy === 'call' ? 'Calling…' : 'Call me with the code instead'}
            </button>
          )}
          {google && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void withGoogle()}
              className="flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left transition-colors duration-instant ease-standard hover:bg-hover focus-ring disabled:opacity-60"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-hover text-[15px] font-semibold text-ink">
                {busy === 'google' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : 'G'}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-ink">Continue with Google</span>
                <span className="block truncate text-[13px] text-text-secondary">{user?.email ?? 'Sign in again'}</span>
              </span>
            </button>
          )}
          {!phone && !google && (
            <p className="rounded-2xl bg-hover px-4 py-3 text-[13.5px] leading-snug text-text-secondary">
              This account has no phone number or Google sign-in to check. Add a phone number in Settings, Account, then try again.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-7 w-full">
          <CodeBoxes value={code} onChange={setCode} onComplete={(c) => void verify(c)} invalid={Boolean(error)} disabled={busy === 'check'} autoFocus />
          <CodeResend via={via} quota={quota} waitFor={wait} busy={busy === 'sms' || busy === 'call' ? busy : undefined} onSend={(c) => void send(c)} />
        </div>
      )}

      <p role="alert" className="mt-4 min-h-5 text-center text-[13px] text-danger">
        {error}
      </p>
      <button type="button" onClick={step === 'code' ? () => setStep('choose') : onBack} className="mt-2 rounded-full px-3 py-1.5 text-[14px] font-medium text-text-secondary hover:bg-hover focus-ring">
        {step === 'code' ? 'Use another way' : 'Back to PIN'}
      </button>
    </div>
  );
}
