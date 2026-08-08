import { cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

/**
 * A failed attempt, said where the eye already is.
 *
 * ## Why this exists next to `AuthMessage` rather than instead of it
 *
 * The inline caption is still correct and still there. It is also a line of
 * small text pinned above the footer of a tall screen, and somebody who has
 * just mistyped a password is looking at the field they typed into. The caption
 * is the record; this is the notice.
 *
 * ## Why it is not a dialog
 *
 * Every app these users have shows something unmissable on a wrong password,
 * and § 19's rule against blocking the flow is what stops this from becoming
 * one: nothing to dismiss, no button, no focus change, gone on its own. The
 * field keeps focus with its contents selected, so the next keystroke is still
 * the correction - which was the point of the original rule.
 *
 * ## Why it repeats
 *
 * Keyed on an attempt counter rather than on the message. Two wrong passwords
 * in a row produce the same sentence, and a component that only reacts to the
 * text changing would show it once and then sit silent for every attempt after
 * - which is the moment it is most needed.
 */
export function AuthAlert({
  message,
  /** Increment on each failure. Equal values mean nothing new happened. */
  attempt,
}: {
  message?: string;
  attempt: number;
}) {
  const [shown, setShown] = useState<{ text: string; id: number }>();

  useEffect(() => {
    if (!message) return;
    setShown({ text: message, id: attempt });
    const timer = window.setTimeout(() => setShown(undefined), 4_000);
    return () => window.clearTimeout(timer);
  }, [message, attempt]);

  if (!shown) return null;

  return (
    <div
      // The caption below already carries `role="alert"`. Announcing the same
      // sentence twice is worse than not announcing it here at all.
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-200 flex justify-center px-6 top-[max(1rem,env(safe-area-inset-top))]"
    >
      <div
        key={shown.id}
        className={cn(
          'glass-surface flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3',
          'shadow-lg motion-safe:animate-toast-in',
        )}
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M12 7v6M12 17h.01" />
          </svg>
        </span>
        <p className="min-w-0 text-caption text-ink">{shown.text}</p>
      </div>
    </div>
  );
}
