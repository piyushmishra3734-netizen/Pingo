import { Button, CheckIcon, LockIcon, PhoneIcon, ShieldIcon, TextField, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Sheet } from '../../components/Sheet.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
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
 * ## Not annoying, on purpose
 *
 * A security prompt that nags gets dismissed without being read, which is worse
 * than not asking. So it waits until the chat list has settled, appears only
 * there - never over a conversation - and "Not now" is as prominent as a text
 * button can be and keeps it away for a week. Nothing is locked behind it.
 *
 * ## Four steps in one sheet
 *
 * The pitch, the number, the code that proves the phone is theirs, and a
 * password so the number can sign in on its own. The password step can be
 * skipped - the number already rescues them through forgot-password - and the
 * whole thing stays in one sheet rather than leaving for a flow of screens,
 * because it is an aside from the chat list, not somewhere to go.
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

export type SecureStep = 'intro' | 'phone' | 'code' | 'password' | 'done';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;
const MIN_PASSWORD = 8;

const FLOW: SecureStep[] = ['phone', 'code', 'password'];

const TITLES: Record<SecureStep, string> = {
  intro: 'Keep your account yours',
  phone: 'Your phone number',
  code: 'Enter the code',
  password: 'Create a password',
  done: "You're covered",
};

export function SecurePhoneSheet({
  onClose,
  api = REAL_API,
  initialStep = 'intro',
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

  const checkCode = async () => {
    if (busy || code.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.verify(e164, code);
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

        {step === 'intro' && (
          <>
            <p className="mt-2 max-w-xs text-balance text-body text-text-secondary">
              Add your phone number. If you ever lose Google or forget your password,
              we&apos;ll call you with a code and you&apos;re back in.
            </p>
            <ul className="mt-5 w-full max-w-xs space-y-3 text-left">
              {[
                'Only used to get you back in',
                'Never shown on your profile',
                'Google or your number - one account',
              ].map((line) => (
                <li key={line} className="flex items-center gap-3 text-body text-ink">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-brand">
                    <CheckIcon size={14} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
            <Actions>
              <Button variant="primary" size="lg" block onClick={() => go('phone')}>
                Add phone number
              </Button>
              <Button variant="text" block onClick={close}>
                Not now
              </Button>
            </Actions>
          </>
        )}

        {step === 'phone' && (
          <>
            <p className="mt-2 max-w-xs text-balance text-body text-text-secondary">
              We&apos;ll call it once with a 6-digit code to check it&apos;s yours.
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
              <Button variant="text" block onClick={() => go('intro')}>
                Back
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
            <div className="mt-5 w-full text-left">
              <TextField
                label="Code"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH));
                  setError(undefined);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void checkCode();
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={CODE_LENGTH}
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
 * The mark at the top: a shield on a brand disc, breathing once a cycle, with
 * the phone tucked into its corner on the pitch - "your number, guarding this".
 * The icon follows the step so the sheet always says what it is doing.
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
      {step === 'intro' && (
        <span className="absolute bottom-1 right-1 grid size-9 place-items-center rounded-full bg-page">
          <span className="grid size-7 place-items-center rounded-full bg-[#22C55E] text-white">
            <PhoneIcon size={14} />
          </span>
        </span>
      )}
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

const QUIET_MS = 7 * 24 * 60 * 60 * 1000;
const WAIT_MS = 3500;

/** Asked at most once per app load, whatever the answer. */
let askedThisLoad = false;

function dismissedRecently(userId: string): boolean {
  try {
    const at = Number(localStorage.getItem(`pingo:secure-phone:${userId}`));
    return Number.isFinite(at) && Date.now() - at < QUIET_MS;
  } catch {
    return false;
  }
}

function rememberDismissal(userId: string): void {
  try {
    localStorage.setItem(`pingo:secure-phone:${userId}`, String(Date.now()));
  } catch {
    // Private mode: they may be asked again next load, which is the lesser harm.
  }
}

/**
 * Decides whether to show the sheet, and shows it. Mounted in the app shell.
 *
 * Only on the chat list, only after it has had a few seconds to settle, only
 * for an account with no number, and not again for a week after "Not now".
 */
export function SecurePhonePrompt() {
  const location = useLocation();
  const [userId, setUserId] = useState<string>();
  const onChats = location.pathname === '/chats';

  useEffect(() => {
    if (!onChats || askedThisLoad) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      void getSupabaseClient()
        .auth.getSession()
        .then(({ data }) => {
          const user = data.session?.user;
          if (!live || !user || user.phone || askedThisLoad) return;
          if (dismissedRecently(user.id)) return;
          askedThisLoad = true;
          setUserId(user.id);
        });
    }, WAIT_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [onChats]);

  if (!userId) return null;

  return (
    <SecurePhoneSheet
      onClose={(completed) => {
        if (!completed) rememberDismissal(userId);
        setUserId(undefined);
      }}
    />
  );
}
