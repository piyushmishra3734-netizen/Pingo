import { useAuth } from '@pingo/core';
import { cn } from '@pingo/ui';
import { Delete, Lock, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { checkPin, clearPin, createPin, hasPin, PIN_LENGTH, pinWait, resetLocks, unlockSession } from './lock-store.js';

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

type Phase = 'checking' | 'verify' | 'create' | 'confirm';

export function PinGate({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { signOut } = useAuth();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<Phase>('checking');
  const [digits, setDigits] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string>();
  const [shake, setShake] = useState(false);
  const [wait, setWait] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    void Promise.all([hasPin(), pinWait()]).then(([has, w]) => {
      if (!live) return;
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
          unlockSession();
          onSuccess();
          return;
        }
        const result = await checkPin(pin);
        if (result.ok) {
          unlockSession();
          onSuccess();
          return;
        }
        setWait(result.wait);
        wrong(result.wait ? `Too many tries. Wait ${result.wait}s.` : 'Wrong PIN. Try again.');
      } finally {
        busy.current = false;
      }
    },
    [phase, first, onSuccess, wrong],
  );

  const press = useCallback(
    (d: string) => {
      if (phase === 'checking' || wait > 0 || shake) return;
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
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [press, back, onCancel]);

  const forgot = async () => {
    const go = await confirm({
      title: 'Forgot your PIN?',
      description: 'You will be signed out. Sign in again and you can make a new PIN. Your locked chats stay locked.',
      confirmLabel: 'Sign out',
    });
    if (!go) return;
    await clearPin();
    resetLocks();
    await signOut();
  };

  const title = phase === 'create' ? 'Create a PIN' : phase === 'confirm' ? 'Confirm your PIN' : 'Enter your PIN';
  const sub =
    phase === 'create'
      ? 'This PIN opens your locked chats on this device.'
      : phase === 'confirm'
        ? 'Type it once more.'
        : 'To open your locked chats.';

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[450] flex flex-col bg-page motion-safe:animate-fade-in">
      <div className="flex items-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" aria-label="Close" onClick={onCancel} className="grid size-11 place-items-center rounded-full text-ink transition-colors duration-instant ease-standard hover:bg-hover focus-ring">
          <X size={22} aria-hidden />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-[22rem] flex-1 flex-col items-center justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <span className="grid size-16 place-items-center rounded-full bg-hover text-ink">
          <Lock size={26} strokeWidth={1.8} aria-hidden />
        </span>
        <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        <p className="mt-1 min-h-[2.5rem] text-center text-[14px] leading-snug text-text-secondary">{wait > 0 ? `Try again in ${wait}s` : sub}</p>

        <div className={cn('mt-7 flex h-4 items-center gap-4', shake && 'lock-shake')} aria-hidden>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span
              key={i}
              className={cn(
                'size-3.5 rounded-full border transition-all duration-150 ease-out',
                i < digits.length ? (error ? 'scale-110 border-danger bg-danger' : 'scale-110 border-ink bg-ink') : 'border-line-strong bg-transparent',
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
          <button type="button" onClick={() => void forgot()} className="mt-5 rounded-full px-3 py-1.5 text-[14px] font-medium text-brand hover:bg-hover focus-ring">
            Forgot PIN?
          </button>
        )}
      </div>
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
      className="mx-auto grid size-[4.25rem] place-items-center rounded-full border border-line text-[26px] font-medium tabular-nums text-ink transition-[background-color,transform] duration-instant ease-standard active:scale-95 active:bg-hover focus-ring disabled:opacity-40"
    >
      {children}
    </button>
  );
}
