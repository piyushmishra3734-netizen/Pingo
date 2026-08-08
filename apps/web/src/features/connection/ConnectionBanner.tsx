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
  /** The second line. Absent where the label says everything. */
  detail?: string;
  /** A spinner reads as work in progress; an icon reads as a condition. */
  busy: boolean;
  /** Filled, in its own colour. See the note on why this is not glass. */
  fill: string;
  glow: string;
}

type NoticeKey = Exclude<ConnectionQuality, 'good'> | 'restored' | 'reconnected';

const LOOKS: Record<NoticeKey, Look> = {
  /*
   * Says what is true rather than what is wrong with you: the device has no
   * internet, which is a fact about the room, not an accusation.
   */
  offline: {
    label: 'No internet connection',
    detail: 'Messages will send when you reconnect',
    busy: false,
    fill: 'linear-gradient(135deg, #e5544b, #d63a5c)',
    glow: 'rgb(229 84 75 / 0.45)',
  },
  connecting: {
    label: 'Connecting…',
    busy: true,
    fill: 'linear-gradient(135deg, #d99323, #c47a15)',
    glow: 'rgb(200 130 30 / 0.42)',
  },
  /*
   * "Poor connection" and not "slow": slow sounds like the app, poor sounds
   * like the signal, and the signal is what it is.
   */
  poor: {
    label: 'Poor connection',
    detail: 'This may take longer than usual',
    busy: true,
    fill: 'linear-gradient(135deg, #d99323, #c47a15)',
    glow: 'rgb(200 130 30 / 0.42)',
  },
  /*
   * Two recoveries, because they are not the same event.
   *
   * "Back online" is only true if the network had actually gone. Saying it
   * after a merely slow link claims something that never happened - you were
   * online the whole time - and a notice that overstates once is a notice
   * people stop reading. `restored` is the honest version for everything
   * short of a real disconnection.
   */
  restored: {
    label: 'Connected',
    busy: false,
    fill: 'linear-gradient(135deg, #23b26b, #17a67a)',
    glow: 'rgb(35 178 107 / 0.45)',
  },
  reconnected: {
    label: 'Back online',
    busy: false,
    fill: 'linear-gradient(135deg, #23b26b, #17a67a)',
    glow: 'rgb(35 178 107 / 0.45)',
  },
};

/** How long the recovery confirmation stays before it lets go. */
const RESTORED_MS = 1_800;

/** Struck-through wifi for a dead network, a tick for a recovered one. */
function Glyph({ restored }: { restored: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="relative"
    >
      {restored ? (
        <path d="m5 13 4.5 4.5L19 7" />
      ) : (
        <>
          <path d="M2 6.5C5 4.3 8.4 3.2 12 3.2s7 1.1 10 3.3M5.6 11c1.9-1.4 4.1-2.1 6.4-2.1M9 15.4c.9-.7 1.9-1 3-1M12 19.6h.01M3 3l18 18" />
        </>
      )}
    </svg>
  );
}

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
  /** Whether the network itself went, as opposed to merely misbehaving. */
  const wasOffline = useRef(false);

  useEffect(() => {
    if (quality !== 'good') {
      wasBad.current = true;
      if (quality === 'offline') wasOffline.current = true;
      setShowRestored(false);
      return;
    }

    // Only worth confirming if there was something to recover from.
    if (!wasBad.current) return;
    wasBad.current = false;
    setShowRestored(true);
    const timer = window.setTimeout(() => {
      setShowRestored(false);
      wasOffline.current = false;
    }, RESTORED_MS);
    return () => window.clearTimeout(timer);
  }, [quality]);

  const key: NoticeKey | undefined =
    quality !== 'good'
      ? quality
      : showRestored
        ? wasOffline.current
          ? 'reconnected'
          : 'restored'
        : undefined;
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
      {/*
        Filled, not glass.

        Everything else that floats in this product is glass, and glass is a
        material for chrome that should recede. This is the one thing on screen
        that has to be noticed before anything else - the first version was a
        pale capsule with a small coloured dot and it read as decoration. So it
        takes its own colour, at full strength, with a glow in that colour
        underneath: the only saturated object on the screen, which is exactly
        how the eye finds it.
      */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl py-2.5 pr-5 pl-3.5',
          'text-white motion-safe:animate-toast-in',
        )}
        style={{
          backgroundImage: look.fill,
          boxShadow: `0 2px 6px -2px ${look.glow}, 0 14px 34px -10px ${look.glow}`,
        }}
      >
        <span
          aria-hidden
          className="relative grid size-8 shrink-0 place-items-center rounded-full bg-white/20"
        >
          {/*
            A halo, only while something is wrong. It breathes rather than
            blinks - a blink is an alarm and this is a status - and it stops
            the moment the news is good, so "Back online" reads as settled.
          */}
          {look.busy && (
            <span className="absolute inset-0 rounded-full bg-white/30 motion-safe:animate-notice-halo" />
          )}
          {look.busy ? (
            <span className="relative size-4 rounded-full border-2 border-white/90 border-t-transparent motion-safe:animate-spin" />
          ) : (
            // Keyed on the state, not the wording: there are two recovery
            // wordings now, and matching on the label drew the dead-wifi glyph
            // for a successful reconnection.
            <Glyph restored={key === 'restored' || key === 'reconnected'} />
          )}
        </span>

        <span className="min-w-0">
          <span className="block text-caption font-semibold">{look.label}</span>
          {look.detail && (
            <span className="block text-[11px] leading-tight text-white/80">{look.detail}</span>
          )}
        </span>
      </div>
    </div>
  );
}
