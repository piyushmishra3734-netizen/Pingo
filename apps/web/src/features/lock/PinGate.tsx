import { useProfile } from '@pingo/core';
import { cn } from '@pingo/ui';
import { Delete, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { PadlockArt } from '../auth/Illustrations.js';
import { ResetPin } from './ResetPin.js';
import { checkPin, clearResetStarted, createPin, hasPin, PIN_LENGTH, pinWait, resetVerifiedByReturn, unlockSession } from './lock-store.js';

/**
 * The PIN pad that stands in front of locked chats.
 *
 * Plain on purpose: a lock icon, six dots, a keypad. Nothing here says which
 * chats are behind it. The first time it asks for a PIN to be made, twice; after
 * that it asks for the PIN. Wrong answers shake the dots and, after five, make
 * the pad wait. "Forgot PIN" signs out, because signing back in is how this
 * device learns it is still you; the lock list stays, and a new PIN is asked
 * for next time.
 */

type Phase = 'checking' | 'verify' | 'reset' | 'create' | 'confirm';

/**
 * `mode` says what the PIN is for. 'chats' opens the locked chats and can be
 * closed; 'app' is the PINGO lock, which sits above everything, cannot be
 * closed (no `onCancel`), and does not open the locked chats behind it.
 */
export function PinGate({
  onSuccess,
  onCancel,
  mode = 'chats',
  verifyHint,
}: {
  onSuccess: () => void;
  onCancel?: () => void;
  mode?: 'chats' | 'app';
  /** What the PIN is being asked for, when it is asked to confirm a change rather than to open something. */
  verifyHint?: string;
}) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [digits, setDigits] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string>();
  const [shake, setShake] = useState(false);
  const [wait, setWait] = useState(0);
  // Past a successful reset check: the new PIN replaces the old one.
  const [resetting, setResetting] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    void Promise.all([hasPin(), pinWait(), resetVerifiedByReturn()]).then(([has, w, back]) => {
      if (!live) return;
      // Came back from Google a moment after asking to reset: that was the check.
      if (back && has) {
        setResetting(true);
        setPhase('create');
        return;
      }
      setPhase(has ? 'verify' : 'create');
      setWait(w);
    });
    return () => {
      live = false;
    };
  }, []);

  // Counts the wait down, so the pad opens again by itself.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(id);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const wrong = useCallback((message: string) => {
    setError(message);
    setShake(true);
    navigator.vibrate?.(60);
    setTimeout(() => {
      setShake(false);
      setDigits('');
    }, 420);
  }, []);

  const submit = useCallback(
    async (pin: string) => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (phase === 'create') {
          setFirst(pin);
          setDigits('');
          setPhase('confirm');
          return;
        }
        if (phase === 'confirm') {
          if (pin !== first) {
            setFirst('');
            setPhase('create');
            wrong('Those did not match. Start again.');
            return;
          }
          await createPin(pin);
          void clearResetStarted();
          if (mode === 'chats') unlockSession();
          onSuccess();
          return;
        }
        const result = await checkPin(pin);
        if (result.ok) {
          if (mode === 'chats') unlockSession();
          onSuccess();
          return;
        }
        setWait(result.wait);
        wrong(result.wait ? `Too many tries. Wait ${result.wait}s.` : 'Wrong PIN. Try again.');
      } finally {
        busy.current = false;
      }
    },
    [phase, first, onSuccess, wrong, mode],
  );

  const press = useCallback(
    (d: string) => {
      if (phase === 'checking' || phase === 'reset' || wait > 0 || shake) return;
      setError(undefined);
      navigator.vibrate?.(8);
      setDigits((cur) => {
        if (cur.length >= PIN_LENGTH) return cur;
        const next = cur + d;
        if (next.length === PIN_LENGTH) setTimeout(() => void submit(next), 120);
        return next;
      });
    },
    [phase, wait, shake, submit],
  );
  const back = useCallback(() => setDigits((cur) => cur.slice(0, -1)), []);

  // A keyboard on a laptop.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (phase === 'reset') {
        if (e.key === 'Escape') onCancel?.();
        return;
      }
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [press, back, onCancel, phase]);

  const title = phase === 'create' ? (resetting ? 'Make a new PIN' : 'Create a PIN') : phase === 'confirm' ? 'Confirm your PIN' : 'Enter your PIN';
  const sub =
    phase === 'create'
      ? resetting
        ? mode === 'app'
          ? 'You are verified. Choose a new PIN to open PINGO.'
          : 'You are verified. Your locked chats are still locked.'
        : mode === 'app'
          ? 'This PIN opens PINGO on this device.'
          : 'This PIN opens your locked chats on this device.'
      : phase === 'confirm'
        ? 'Type it once more.'
        : verifyHint
          ? verifyHint
          : mode === 'app'
            ? 'PINGO is locked.'
            : 'To open your locked chats.';

  const { profile } = useProfile();
  // Opening PINGO greets by name; every other step keeps the plain title.
  const heading = mode === 'app' && phase === 'verify' && !verifyHint ? `Welcome back${profile?.displayName ? `, ${profile.displayName.split(' ')[0]}` : ''}` : title;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn('fixed inset-0 flex flex-col bg-page motion-safe:animate-fade-in', mode === 'app' ? 'z-[2000]' : 'z-[450]')}
    >
      <div className="flex min-h-11 items-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {onCancel && (
          <button type="button" aria-label="Close" onClick={onCancel} className="grid size-11 place-items-center rounded-full text-ink transition-colors duration-instant ease-standard hover:bg-hover focus-ring">
            <X size={22} aria-hidden />
          </button>
        )}
      </div>

      {phase === 'reset' ? (
        <ResetPin
          onVerified={() => {
            setResetting(true);
            setDigits('');
            setPhase('create');
          }}
          onBack={() => setPhase('verify')}
        />
      ) : (
      <div className="relative mx-auto flex w-full max-w-[22rem] flex-1 flex-col items-center px-6 pt-[4vh] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <PadlockArt size={92} />
        <h2 className="mt-3 text-[21px] font-semibold tracking-[-0.01em] text-ink">{heading}</h2>
        <p className="mt-1.5 min-h-[2.25rem] text-center text-[14px] leading-snug text-text-secondary">{wait > 0 ? `Try again in ${wait}s` : sub}</p>

        <div className={cn('mt-5 flex h-3 items-center gap-3.5', shake && 'lock-shake')} aria-hidden>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span
              key={i}
              className={cn(
                'size-2.5 rounded-full border transition-all duration-150 ease-out',
                i < digits.length ? (error ? 'border-danger bg-danger' : 'border-ink bg-ink') : 'border-ink/70 bg-transparent',
              )}
            />
          ))}
        </div>
        <p role="alert" className="mt-2 h-5 text-[13px] text-danger">
          {error}
        </p>

        <div className="mt-3 grid w-full max-w-[18.5rem] grid-cols-3 gap-x-4 gap-y-3.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <Key key={d} onPress={() => press(d)} disabled={wait > 0}>
              {d}
            </Key>
          ))}
          <span aria-hidden />
          <Key onPress={() => press('0')} disabled={wait > 0}>
            0
          </Key>
          <button
            type="button"
            aria-label="Delete"
            onClick={back}
            className="mx-auto grid size-[4.5rem] place-items-center rounded-full border border-[#d9d9de] text-ink transition-colors duration-instant ease-standard active:bg-[#e6e6ea] focus-ring dark:border-white/10"
          >
            <Delete size={22} aria-hidden />
          </button>
        </div>

        <div className="min-h-4 flex-1" aria-hidden />
        {phase === 'verify' && (
          <button type="button" onClick={() => setPhase('reset')} className="rounded-full px-3 py-1.5 text-[14px] font-medium text-[#1a6ed8] underline underline-offset-2 focus-ring">
            Forgot PIN code?
          </button>
        )}
      </div>
      )}
    </div>,
    document.body,
  );
}

function Key({ children, onPress, disabled }: { children: string; onPress: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      // Light grey discs with a hairline edge and a soft drop shadow, as in the reference.
      className="mx-auto grid size-[4.5rem] place-items-center rounded-full border border-[#d9d9de] bg-[#f1f1f3] text-[28px] font-normal tabular-nums text-ink shadow-[0_2px_5px_rgb(16_17_20/0.14)] transition-[background-color,transform] duration-instant ease-standard active:scale-95 active:bg-[#e6e6ea] focus-ring disabled:opacity-40 dark:border-white/10 dark:bg-white/10"
    >
      {children}
    </button>
  );
}
