import { cn } from '@pingo/ui';
import { BellRing, Check, Phone, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { usePushPermission } from './usePushPermission.js';

/**
 * The "turn on notifications" card, shown each time the Chats page opens while
 * they are off.
 *
 * Not a system-style banner. It rises from the bottom as one soft card above the
 * dock: a glowing bell tile with three little notifications drifting around it,
 * one line that says why, and one button. It never covers the list with a dark
 * wall, "Not now" puts it away for this visit, and it is back on the next one
 * until the notifications are on.
 *
 * When they were refused earlier the system will not show its dialog again, so
 * the card says where to switch them on instead of offering a button that
 * could do nothing.
 */

/** Long enough that the list has painted and the card does not fight the first frame. */
const DELAY_MS = 900;

export function NotificationPrompt({ onVisible }: { onVisible?: (up: boolean) => void }) {
  const { state, ask } = usePushPermission();
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // This visit only: a new mount of the Chats page starts afresh.
  const [dismissed, setDismissed] = useState(false);

  const wanted = !dismissed && (state === 'ask' || state === 'blocked');
  useEffect(() => {
    if (!wanted) return;
    const id = setTimeout(() => setShown(true), DELAY_MS);
    return () => clearTimeout(id);
  }, [wanted]);

  const close = () => {
    setLeaving(true);
    setTimeout(() => setDismissed(true), 220);
  };

  // Turned on from somewhere else (Settings, the browser bar): let it go quietly.
  useEffect(() => {
    if (shown && state === 'granted' && !done) close();
  }, [state, shown, done]);

  const up = wanted && shown;
  // So the page can step other bottom banners out of the way while this is up.
  useEffect(() => {
    onVisible?.(up);
    return () => onVisible?.(false);
  }, [up, onVisible]);

  if (!up) return null;
  const blocked = state === 'blocked';

  const turnOn = async () => {
    setBusy(true);
    await ask();
    setBusy(false);
    setDone(true);
    setTimeout(close, 1100);
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[320] flex justify-center px-3 pb-[max(5.75rem,calc(env(safe-area-inset-bottom)+5rem))]">
      <section
        role="dialog"
        aria-label="Notifications"
        className={cn(
          'pointer-events-auto relative w-full max-w-[26rem] overflow-hidden rounded-[28px] border border-line/70 bg-surface p-5 shadow-[0_24px_60px_-18px_rgb(0_0_0/0.35)]',
          leaving ? 'np-leave' : 'np-enter',
        )}
      >
        {/* A wash of the brand colour in one corner, so the card glows instead of sitting flat. */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-brand/20 blur-3xl" />

        <div className="relative flex items-center gap-4">
          <div className="relative size-[88px] shrink-0">
            <span className="np-ring absolute inset-0 rounded-[26px] bg-brand/25" aria-hidden />
            <span className="absolute inset-0 grid place-items-center rounded-[26px] bg-gradient-to-br from-brand to-[#d946ef] text-white shadow-lg">
              {done ? <Check size={36} aria-hidden /> : <BellRing size={36} className="np-bell" aria-hidden />}
            </span>
            <Chip className="-left-3 -top-2" delay="0s" icon={<Sparkles size={11} aria-hidden />} label="New Ping" />
            <Chip className="-right-5 top-9" delay="0.7s" icon={<Phone size={11} aria-hidden />} label="Call" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {done ? 'You are all set' : blocked ? 'Notifications are off' : 'Never miss a message'}
            </h2>
            <p className="mt-1 text-[14px] leading-snug text-text-secondary">
              {done
                ? 'Messages, calls and Pings will reach you.'
                : blocked
                  ? 'You turned them off earlier. Switch them on in your phone or browser settings for PINGO.'
                  : 'Turn on notifications so messages, calls and Pings find you, even when PINGO is closed.'}
            </p>
          </div>
        </div>

        {!done && (
          <div className="relative mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={close}
              className="h-12 flex-1 rounded-full text-[15px] font-medium text-text-secondary transition-colors duration-instant ease-standard hover:bg-hover focus-ring"
            >
              {blocked ? 'Got it' : 'Not now'}
            </button>
            {!blocked && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void turnOn()}
                className="h-12 flex-[1.6] rounded-full bg-gradient-to-r from-brand to-[#d946ef] text-[15px] font-semibold text-white shadow-md transition-transform duration-instant ease-standard active:scale-[0.98] focus-ring disabled:opacity-70"
              >
                {busy ? 'Asking…' : 'Turn on notifications'}
              </button>
            )}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** A tiny notification drifting beside the bell. Purely decorative. */
function Chip({ className, delay, icon, label }: { className: string; delay: string; icon: React.ReactNode; label: string }) {
  return (
    <span
      aria-hidden
      style={{ animationDelay: delay }}
      className={cn(
        'np-float absolute flex items-center gap-1 rounded-full border border-line/70 bg-surface px-2 py-1 text-[10.5px] font-medium text-ink shadow-md',
        className,
      )}
    >
      <span className="text-brand">{icon}</span>
      {label}
    </span>
  );
}
