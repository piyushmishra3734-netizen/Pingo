import { Button, CheckIcon, CloseIcon, LockIcon, PhoneIcon, ShieldIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Sheet } from '../../components/Sheet.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
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
 * ## A card, not a page
 *
 * The ask is one small yellow card floating above the dock
 * (`SecurePhoneBanner`) - never a page or a popup, and never inside a chat,
 * the camera or a story, where it would be in the way of the thing being done.
 * "Add" opens this sheet straight at the number; "later" puts it away for a
 * few days rather than for good, and rather than never.
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
 * The caution card: a shield in a yellow disc, one title, one line, one
 * button, and a way to say "later". Exported on its own for `/dev/secure-lab`.
 *
 * Shaped like a Material banner - icon, one or two short lines, a single action
 * and a dismiss - because that is the pattern people already read as "worth a
 * look, not an emergency". The line is a situation rather than a threat: a
 * concrete "lose Google access?" moves people where a generic warning does not.
 */
export function CautionCard({ onAdd, onLater }: { onAdd: () => void; onLater: () => void }) {
  return (
    <div
      role="status"
      className={cn(
        'fixed inset-x-4 z-190 mx-auto flex max-w-md items-center gap-3 rounded-2xl p-3 pr-1.5',
        // Just above the dock, which reserves 8rem including its own inset.
        'bottom-[calc(8.5rem_+_max(0rem,env(safe-area-inset-bottom)_-_1.25rem))]',
        'border border-[rgb(234_179_8/0.4)] bg-[color-mix(in_srgb,var(--color-surface)_88%,#FACC15)] shadow-lg',
        'motion-safe:animate-rise',
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#FACC15] text-[#422006]">
        <ShieldIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">Secure your account</p>
        <p className="text-caption text-text-secondary">
          Lose Google access? Your number gets you back in.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="focus-ring shrink-0 rounded-full bg-[#FACC15] px-4 py-2 text-caption font-semibold text-[#422006] transition-transform duration-quick active:scale-95"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onLater}
        aria-label="Remind me later"
        className="focus-ring grid size-8 shrink-0 place-items-center rounded-full text-text-tertiary"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

/** "Later" puts it away for this long, then it comes back. */
const LATER_MS = 3 * 24 * 60 * 60 * 1000;

function laterKey(userId: string): string {
  return `pingo:secure-phone-later:${userId}`;
}

function putAwayRecently(userId: string): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(laterKey(userId))) < LATER_MS;
  } catch {
    return false;
  }
}

/**
 * The card, for an account with no number - everywhere but inside a chat, the
 * camera and stories. It stays until a number is added, except for three days
 * after "later". Mounted in the shell.
 */
export function SecurePhoneBanner() {
  const { pathname } = useLocation();
  /** Set only while the signed-in account has no number. */
  const [userId, setUserId] = useState<string>();
  const [later, setLater] = useState(false);
  const [open, setOpen] = useState(false);

  // Fires at once with the current session, and again when a number lands on it.
  useEffect(() => {
    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      setUserId(user && !user.phone ? user.id : undefined);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const inChat =
    /^\/chats\/[^/]+$/.test(pathname) && pathname !== '/chats/new' && pathname !== '/chats/new-group';
  const away = inChat || pathname === '/camera' || pathname.startsWith('/stories');
  const visible = Boolean(userId) && !later && !open && !away && !putAwayRecently(userId ?? '');

  // Room under the page while it shows, so the last row never ends up behind it.
  useEffect(() => {
    if (!visible) return undefined;
    const root = document.documentElement.style;
    root.setProperty('--caution-space', '5.5rem');
    return () => {
      root.removeProperty('--caution-space');
    };
  }, [visible]);

  return (
    <>
      {visible && (
        <CautionCard
          onAdd={() => setOpen(true)}
          onLater={() => {
            try {
              if (userId) localStorage.setItem(laterKey(userId), String(Date.now()));
            } catch {
              // Private mode: it goes for this visit only.
            }
            setLater(true);
          }}
        />
      )}
      {/* Kept open past the code: the number lands before the password step. */}
      {open && <SecurePhoneSheet onClose={() => setOpen(false)} />}
    </>
  );
}
