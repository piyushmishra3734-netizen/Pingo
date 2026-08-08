import { cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { useConnectionStatus, type ConnectionQuality } from './useConnectionStatus.js';

/**
 * The bar that says why nothing is arriving.
 *
 * ## Why it floats rather than pushing
 *
 * The obvious build is a strip between the header and the content, which is
 * what most apps do. It also means every appearance and disappearance reflows
 * the screen underneath - a list jumping down half a centimetre while somebody
 * is reading it, on the one occasion the app is already misbehaving. This sits
 * over the top instead, in the same floating language as the dock, and costs
 * the layout nothing.
 *
 * ## Why recovery is announced
 *
 * A bar that simply vanishes leaves you unsure whether it fixed itself or you
 * stopped looking. One short confirmation closes the loop, and then it goes.
 * It is the only state here that is not about a problem, which is why it is the
 * only one in the brand's own colour.
 */

interface Look {
  label: string;
  /** A spinner reads as work in progress; a dot reads as a condition. */
  busy: boolean;
  tone: 'danger' | 'warning' | 'brand';
}

const LOOKS: Record<Exclude<ConnectionQuality, 'good'> | 'restored', Look> = {
  /*
   * Says what is true rather than what is wrong with you: the device has no
   * internet, which is a fact about the room, not an accusation.
   */
  offline: { label: 'No internet connection', busy: false, tone: 'danger' },
  connecting: { label: 'Connecting…', busy: true, tone: 'warning' },
  /*
   * "Poor connection" and not "slow": slow sounds like the app, poor sounds
   * like the signal, and the signal is what it is.
   */
  poor: { label: 'Poor connection', busy: true, tone: 'warning' },
  restored: { label: 'Back online', busy: false, tone: 'brand' },
};

/** How long the recovery confirmation stays before it lets go. */
const RESTORED_MS = 1_800;

export function ConnectionBanner() {
  const quality = useConnectionStatus();
  const [showRestored, setShowRestored] = useState(false);
  /*
   * A ref, and that is the whole point.
   *
   * As state it has to be a dependency of the effect below, and the effect
   * sets it - so scheduling the dismissal immediately re-ran the effect, whose
   * cleanup cancelled the timer it had just scheduled. On the re-run the
   * connection was good and the flag was already cleared, so nothing
   * rescheduled it: "Back online" appeared and then stayed there for the rest
   * of the session. Measured live - still on screen 2.8s after a 1.8s timer.
   *
   * Nothing renders from it, only the effect reads it, so a ref is also what
   * it should have been on the merits.
   */
  const wasBad = useRef(false);

  useEffect(() => {
    if (quality !== 'good') {
      wasBad.current = true;
      setShowRestored(false);
      return;
    }

    // Only worth confirming if there was something to recover from.
    if (!wasBad.current) return;
    wasBad.current = false;
    setShowRestored(true);
    const timer = window.setTimeout(() => setShowRestored(false), RESTORED_MS);
    return () => window.clearTimeout(timer);
  }, [quality]);

  const key = quality !== 'good' ? quality : showRestored ? 'restored' : undefined;
  if (!key) return null;

  const look = LOOKS[key];

  return (
    <div
      // `polite`, not `assertive`: a screen reader should finish the sentence it
      // is on. The network being slow is not worth interrupting a message for.
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 z-200 flex justify-center',
        'top-[max(0.75rem,env(safe-area-inset-top))]',
      )}
    >
      <div
        className={cn(
          'glass-surface flex items-center gap-2 rounded-full py-2 pr-4 pl-3',
          'text-caption font-medium shadow-lg',
          'motion-safe:animate-toast-in',
          look.tone === 'danger' && 'text-danger',
          look.tone === 'warning' && 'text-warning',
          look.tone === 'brand' && 'text-brand',
        )}
      >
        {look.busy ? (
          <span
            aria-hidden
            className={cn(
              'size-3 shrink-0 rounded-full border-2 border-current border-t-transparent',
              'motion-safe:animate-spin',
            )}
          />
        ) : (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-current" />
        )}
        {look.label}
      </div>
    </div>
  );
}
