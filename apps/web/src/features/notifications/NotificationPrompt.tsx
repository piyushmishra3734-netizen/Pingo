import { cn } from '@pingo/ui';
import { Bell, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { usePushPermission } from './usePushPermission.js';

/**
 * The "turn on notifications" strip, shown each time the Chats page opens while
 * they are off.
 *
 * Quiet on purpose: one slim row above the dock with a small bell, a line of
 * text, a single dark "Turn on" and a close. It uses the app's own surface and
 * hairline border, so it reads as part of the page rather than an ad. The close
 * puts it away for this visit; it is back on the next one until they are on.
 *
 * When they were refused earlier the system will not show its dialog again, so
 * the row says where to switch them on instead of offering a button that could
 * do nothing.
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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[320] flex justify-center px-3 pb-[max(5.5rem,calc(env(safe-area-inset-bottom)+4.75rem))]">
      <section
        role="dialog"
        aria-label="Notifications"
        className={cn(
          'pointer-events-auto flex w-full max-w-[26rem] items-center gap-3 rounded-2xl border border-line bg-surface py-2.5 pl-3 pr-2 shadow-[0_8px_28px_-12px_rgb(0_0_0/0.25)]',
          leaving ? 'np-leave' : 'np-enter',
        )}
      >
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-hover text-ink">
          {done ? <Check size={17} /> : <Bell size={17} />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-medium leading-tight text-ink">
            {done ? 'Notifications are on' : blocked ? 'Notifications are off' : 'Turn on notifications'}
          </p>
          <p className="truncate text-[12.5px] leading-snug text-text-secondary">
            {done ? 'You will hear about new messages.' : blocked ? 'Enable them in your device settings.' : 'Messages and calls, right away.'}
          </p>
        </div>

        {!done && !blocked && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void turnOn()}
            className="h-9 shrink-0 rounded-full bg-ink px-4 text-[13.5px] font-medium text-page transition-opacity duration-instant ease-standard active:opacity-80 focus-ring disabled:opacity-60"
          >
            {busy ? 'Asking…' : 'Turn on'}
          </button>
        )}
        {!done && (
          <button
            type="button"
            aria-label="Not now"
            onClick={close}
            className="grid size-9 shrink-0 place-items-center rounded-full text-text-tertiary transition-colors duration-instant ease-standard hover:bg-hover focus-ring"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </section>
    </div>,
    document.body,
  );
}
