import { Button, CheckIcon, LockIcon, PhoneIcon, ShieldIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { SettingsRow } from '../settings/SettingsRow.js';
import { CodeBoxes } from './CodeBoxes.js';
import { defaultCountry } from './countries.js';
import { PasswordField } from './PasswordField.js';
import { PhoneField, toE164 } from './PhoneField.js';
import {
  addPhoneStart,
  addPhoneVerify,
  recoveryErrorMessage,
  setNewPassword,
  type AddPhoneStart,
} from './recovery.js';

/**
 * "Keep your account yours": adding a phone number to an account that has none.
 *
 * ## Who is asked
 *
 * Anybody signed in without a number - which is everybody who made their
 * account with Google. Their only way back in is Google; a number gives them a
 * second one, because forgot-password is a call with a code. Somebody who
 * signed up with their number already has it, and is never asked for Google.
 *
 * ## A row, not a banner
 *
 * The ask is one yellow-highlighted row at the top of Settings
 * (`SecurePhoneRow`) - the "finish setting up" pattern: always findable,
 * never in the way of a chat, the camera or a story. The row opens this
 * sheet at the number.
 *
 * ## Three steps in one sheet
 *
 * The number, the code that proves the phone is theirs, and a password so the
 * number can sign in on its own. The password step can be skipped - the number
 * already rescues them through forgot-password.
 */

export interface SecurePhoneApi {
  start: (e164: string) => Promise<AddPhoneStart>;
  verify: (e164: string, code: string) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
}

const REAL_API: SecurePhoneApi = {
  start: addPhoneStart,
  verify: addPhoneVerify,
  setPassword: setNewPassword,
};

export type SecureStep = 'phone' | 'code' | 'password' | 'done';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;
const MIN_PASSWORD = 8;

const FLOW: SecureStep[] = ['phone', 'code', 'password'];

const TITLES: Record<SecureStep, string> = {
  phone: 'Your phone number',
  code: 'Enter the code',
  password: 'Create a password',
  done: "You're covered",
};

export function SecurePhoneSheet({
  onClose,
  api = REAL_API,
  initialStep = 'phone',
}: {
  /** `completed` is true only when a number was actually added. */
  onClose: (completed: boolean) => void;
  api?: SecurePhoneApi;
  initialStep?: SecureStep;
}) {
  const [step, setStep] = useState<SecureStep>(initialStep);
  const [country, setCountry] = useState(defaultCountry);
  const [digits, setDigits] = useState('');
  const [ending, setEnding] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [waitFor, setWaitFor] = useState(0);
  const [added, setAdded] = useState(initialStep === 'password' || initialStep === 'done');

  useEffect(() => {
    if (waitFor <= 0) return undefined;
    const timer = window.setTimeout(() => setWaitFor((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [waitFor]);

  const go = (next: SecureStep) => {
    setError(undefined);
    setStep(next);
  };

  const e164 = toE164(country, digits);

  const sendCode = async () => {
    if (busy || digits.length < 6) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.start(e164);
      if (result.status === 'taken') {
        setError('This number is already on another PINGO account.');
        return;
      }
      setEnding(result.ending);
      setCode('');
      setWaitFor(RESEND_SECONDS);
      go('code');
    } catch (cause) {
      setError(recoveryErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const checkCode = async (entered = code) => {
    if (busy || entered.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.verify(e164, entered);
      setAdded(true);
      go('password');
    } catch (cause) {
      setError(recoveryErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    if (busy || password.length < MIN_PASSWORD) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.setPassword(password);
      go('done');
    } catch (cause) {
      setError(recoveryErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const close = () => onClose(added);

  return (
    <Sheet title={TITLES[step]} hideTitle onClose={close}>
      <div className="flex flex-col items-center pb-1 text-center">
        {FLOW.includes(step) && (
          <div className="mb-5 flex gap-1.5" aria-hidden>
            {FLOW.map((s) => (
              <span
                key={s}
                className={cn(
                  'h-1 w-7 rounded-full transition-colors duration-quick',
                  FLOW.indexOf(s) <= FLOW.indexOf(step) ? 'bg-brand' : 'bg-line',
                )}
              />
            ))}
          </div>
        )}

        <Hero step={step} />

        <h2 className="mt-5 text-h2 text-ink">{TITLES[step]}</h2>

        {step === 'phone' && (
          <>
            <p className="mt-2 max-w-xs text-balance text-body text-text-secondary">
              So you can always get back in, even without Google. We&apos;ll call once
              with a 6-digit code to check it&apos;s yours.
            </p>
            <div className="mt-5 w-full text-left">
              <PhoneField
                country={country}
                onCountryChange={setCountry}
                digits={digits}
                onDigitsChange={(next) => {
                  setDigits(next);
                  setError(undefined);
                }}
                autoFocus
                disabled={busy}
                onSubmit={() => void sendCode()}
              />
            </div>
            <Problem message={error} />
            <Actions>
              <Button
                variant="primary"
                size="lg"
                block
                disabled={digits.length < 6}
                loading={busy}
                onClick={() => void sendCode()}
              >
                Call me with a code
              </Button>
              <Button variant="text" block onClick={close}>
                Not now
              </Button>
            </Actions>
          </>
        )}

        {step === 'code' && (
          <>
            <p className="mt-2 max-w-xs text-balance text-body text-text-secondary">
              {ending ? `Calling the number ending in ${ending}.` : 'Calling your number.'} Pick up
              and type the code you hear.
            </p>
            <div className="mt-5 w-full">
              <CodeBoxes
                value={code}
                onChange={(next) => {
                  setCode(next);
                  setError(undefined);
                }}
                onComplete={(full) => void checkCode(full)}
                length={CODE_LENGTH}
                autoFocus
                invalid={Boolean(error)}
              />
            </div>
            <Problem message={error} />
            <div className="mt-3 text-caption">
              {waitFor > 0 ? (
                <span className="text-text-tertiary">Call again in {waitFor}s</span>
              ) : (
                <button
                  type="button"
                  className="focus-ring rounded font-medium text-brand"
                  onClick={() => void sendCode()}
                >
                  Call me again
                </button>
              )}
            </div>
            <Actions>
              <Button
                variant="primary"
                size="lg"
                block
                disabled={code.length !== CODE_LENGTH}
                loading={busy}
                onClick={() => void checkCode()}
              >
                Verify
              </Button>
              <Button variant="text" block onClick={() => go('phone')}>
                Use a different number
              </Button>
            </Actions>
          </>
        )}

        {step === 'password' && (
          <>
            <p className="mt-2 max-w-xs text-balance text-body text-text-secondary">
              So your number can sign you in on its own - on any phone, even without
              Google.
            </p>
            <div className="mt-5 w-full text-left">
              <PasswordField
                label="Password"
                value={password}
                onChange={(next) => {
                  setPassword(next);
                  setError(undefined);
                }}
                autoComplete="new-password"
                autoFocus
                invalid={Boolean(error)}
                disabled={busy}
                onSubmit={() => void savePassword()}
              />
              <p className="mt-2 text-caption text-text-tertiary">
                At least {MIN_PASSWORD} characters.
              </p>
            </div>
            <Problem message={error} />
            <Actions>
              <Button
                variant="primary"
                size="lg"
                block
                disabled={password.length < MIN_PASSWORD}
                loading={busy}
                onClick={() => void savePassword()}
              >
                Save password
              </Button>
              <Button variant="text" block onClick={() => go('done')}>
                Skip for now
              </Button>
            </Actions>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="mt-2 max-w-xs text-balance text-body text-text-secondary">
              Sign in with Google or with your number - it&apos;s the same account.
              Forgot your password? We&apos;ll call you with a code.
            </p>
            <Actions>
              <Button variant="primary" size="lg" block onClick={close}>
                Done
              </Button>
            </Actions>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The mark at the top: the step's icon on a brand disc, breathing once a
 * cycle, so the sheet always says what it is doing.
 */
function Hero({ step }: { step: SecureStep }) {
  const Icon =
    step === 'code' ? PhoneIcon : step === 'password' ? LockIcon : step === 'done' ? CheckIcon : ShieldIcon;

  return (
    <div className="relative grid size-24 place-items-center" aria-hidden>
      <span className="absolute inset-0 rounded-full bg-brand opacity-15 motion-safe:animate-dot-pulse" />
      <span className="absolute inset-3 rounded-full bg-brand opacity-20" />
      <span className="relative grid size-16 place-items-center rounded-full bg-brand text-on-brand shadow-lg">
        <Icon size={30} />
      </span>
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex w-full flex-col gap-1.5">{children}</div>;
}

function Problem({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 text-caption text-danger">
      {message}
    </p>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Whether the signed-in account has no number yet. Fires at once with the
 * current session, and again when a number lands on it.
 */
export function useNeedsPhone(): boolean {
  const [needs, setNeeds] = useState(false);

  useEffect(() => {
    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      setNeeds(Boolean(session?.user && !session.user.phone));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return needs;
}

/** The row itself, yellow-highlighted. Exported bare for `/dev/secure-lab`. */
export function PhoneRowCard({ onClick }: { onClick: () => void }) {
  return (
    <section className="rounded-lg bg-[rgb(250_204_21/0.14)] p-1 ring-1 ring-inset ring-[rgb(234_179_8/0.35)]">
      <SettingsRow
        icon={<PhoneIcon size={19} />}
        label="Add a phone number"
        value="Recommended"
        onClick={onClick}
      />
      <p className="px-3 pb-2.5 text-caption text-text-secondary">
        Your way back in if you ever lose Google.
      </p>
    </section>
  );
}

/**
 * The ask, at the top of Settings, for an account with no number. Opens the
 * sheet straight at the number.
 */
export function SecurePhoneRow() {
  const needsPhone = useNeedsPhone();
  const [open, setOpen] = useState(false);

  return (
    <>
      {needsPhone && <PhoneRowCard onClick={() => setOpen(true)} />}
      {/* Kept open past the code: the number lands before the password step. */}
      {open && <SecurePhoneSheet onClose={() => setOpen(false)} />}
    </>
  );
}
