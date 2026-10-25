import { useProfile } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { Delete, Lock, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
      // Two quiet glows of the brand in opposite corners, so the pad is PINGO's and not a blank sheet.
      style={{
        backgroundImage:
          'radial-gradient(60% 40% at 15% 0%, color-mix(in srgb, var(--color-brand) 14%, transparent), transparent), radial-gradient(60% 40% at 90% 100%, color-mix(in srgb, #e0559b 11%, transparent), transparent)',
      }}
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
      <div className="relative mx-auto flex w-full max-w-[22rem] flex-1 flex-col items-center justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {mode === 'app' && phase === 'verify' && !verifyHint ? (
          /* Opening PINGO: your own face in the story ring, the way you see everybody else's. */
          <span className="grid size-[84px] place-items-center rounded-full p-[3px]" style={{ background: 'var(--sweep-ring)' }}>
            <span className="block size-full overflow-hidden rounded-full border-[3px] border-page bg-page">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="size-full object-cover" draggable={false} />
              ) : (
                <Avatar name={profile?.displayName ?? 'You'} id={profile?.id} size="lg" className="!size-full" />
              )}
            </span>
          </span>
        ) : (
          <span className="grid size-[72px] place-items-center rounded-full bg-brand-soft text-brand ring-1 ring-brand/15">
            <Lock size={28} strokeWidth={1.8} aria-hidden />
          </span>
        )}
        <h2 className="mt-5 text-[22px] font-bold tracking-[-0.01em] text-ink">{heading}</h2>
        <p className="mt-1 min-h-[2.5rem] text-center text-[14px] leading-snug text-text-secondary">{wait > 0 ? `Try again in ${wait}s` : sub}</p>

        <div className={cn('mt-6 flex h-4 items-center gap-4', shake && 'lock-shake')} aria-hidden>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span
              key={i}
              className={cn(
                'size-3.5 rounded-full border transition-all duration-150 ease-out',
                i < digits.length
                  ? error
                    ? 'scale-110 border-danger bg-danger'
                    : 'scale-110 border-transparent bg-brand-gradient shadow-[0_2px_8px_-2px_var(--color-brand)]'
                  : 'border-line-strong bg-transparent',
              )}
            />
          ))}
        </div>
        <p role="alert" className="mt-3 h-5 text-[13px] text-danger">
          {error}
        </p>

        <div className="mt-4 grid w-full grid-cols-3 gap-x-5 gap-y-3">
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
            className="mx-auto grid size-[4.25rem] place-items-center rounded-full text-text-secondary transition-colors duration-instant ease-standard active:bg-hover focus-ring"
          >
            <Delete size={22} aria-hidden />
          </button>
        </div>

        {phase === 'verify' && (
          <button type="button" onClick={() => setPhase('reset')} className="mt-5 rounded-full px-3 py-1.5 text-[14px] font-medium text-brand hover:bg-hover focus-ring">
            Forgot PIN?
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
      // Soft glass keys that take the brand when pressed, not outlined circles.
      className="mx-auto grid size-[4.25rem] place-items-center rounded-full bg-surface/75 text-[26px] font-semibold tabular-nums text-ink shadow-[0_1px_2px_rgb(16_17_20/0.06),0_6px_14px_-8px_rgb(16_17_20/0.18)] ring-1 ring-line transition-[background-color,transform,color] duration-instant ease-standard active:scale-95 active:bg-brand-soft active:text-brand focus-ring disabled:opacity-40"
    >
      {children}
    </button>
  );
}
