import { cn } from '@pingo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n/useT.js';
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
 * ## Why it is water glass, not a solid slab
 *
 * Everything that floats in PINGO is liquid glass. A saturated full-width block
 * in the state's colour found the eye by being the one thing that did not
 * belong to the product. The panel uses `glass-water` — the same bead-of-water
 * material as chat chrome — and colour lives in one 32px disc plus a soft bloom,
 * the same move the unread badge makes.
 *
 * ## Why recovery is announced
 *
 * A bar that simply vanishes leaves you unsure whether it fixed itself or you
 * stopped looking. One short confirmation closes the loop, and then it goes.
 */

interface Look {
  label: string;
  detail?: string;
  busy: boolean;
  tint: string;
  glow: string;
}

type NoticeKey = Exclude<ConnectionQuality, 'good'> | 'restored' | 'reconnected';

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
  const t = useT();
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
   * of the session.
   */
  const wasBad = useRef(false);
  /** Whether the network itself went, as opposed to merely misbehaving. */
  const wasOffline = useRef(false);

  const looks = useMemo<Record<NoticeKey, Look>>(
    () => ({
      offline: {
        label: t('connection.offline'),
        detail: t('connection.offlineDetail'),
        busy: false,
        tint: '#e5544b',
        glow: 'rgb(229 84 75 / 0.30)',
      },
      connecting: {
        label: t('connection.connecting'),
        busy: true,
        tint: '#d9821f',
        glow: 'rgb(200 130 30 / 0.28)',
      },
      poor: {
        label: t('connection.poor'),
        detail: t('connection.poorDetail'),
        busy: true,
        tint: '#d9821f',
        glow: 'rgb(200 130 30 / 0.28)',
      },
      restored: {
        label: t('connection.restored'),
        busy: false,
        tint: '#17a67a',
        glow: 'rgb(35 178 107 / 0.30)',
      },
      reconnected: {
        label: t('connection.reconnected'),
        busy: false,
        tint: '#17a67a',
        glow: 'rgb(35 178 107 / 0.30)',
      },
    }),
    [t],
  );

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

  const look = looks[key];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 z-200 flex justify-center',
        'top-[max(0.75rem,env(safe-area-inset-top))]',
      )}
    >
      {/*
        Liquid water glass: same material family as chat chrome / dock language.
        Colour is concentrated in the disc + bloom, not a full-width slab.
      */}
      <div
        className={cn(
          'glass-water flex items-center gap-3 rounded-2xl py-2.5 pr-5 pl-3',
          'motion-safe:animate-toast-in',
        )}
        style={{
          boxShadow: `0 1px 2px -1px rgb(18 20 38 / 0.22), 0 16px 40px -14px ${look.glow}`,
        }}
      >
        <span
          aria-hidden
          className="relative grid size-8 shrink-0 place-items-center rounded-full text-white"
          style={{
            backgroundImage: `linear-gradient(140deg, ${look.tint}, color-mix(in srgb, ${look.tint} 72%, #000))`,
            boxShadow: `0 4px 12px -4px ${look.glow}`,
          }}
        >
          {look.busy && (
            <span
              className="absolute inset-0 rounded-full motion-safe:animate-notice-halo"
              style={{ backgroundColor: look.tint }}
            />
          )}
          {look.busy ? (
            <span className="relative size-4 rounded-full border-2 border-white/90 border-t-transparent motion-safe:animate-spin" />
          ) : (
            <Glyph restored={key === 'restored' || key === 'reconnected'} />
          )}
        </span>

        <span className="min-w-0">
          <span className="block text-caption font-semibold text-ink">{look.label}</span>
          {look.detail && (
            <span className="block text-[11px] leading-tight text-text-secondary">
              {look.detail}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
