import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

import './funnel-motion.css';

/**
 * Identity funnel stage — quiet depth, cheap to paint.
 *
 * Static mesh + two soft orbs (opacity-only motion). No grain, no multi-layer
 * blur stacks. Feels finished without costing frames.
 *
 * ## Every colour here is a mix of a token, not a hex
 *
 * It was painted in light greys - `#F2F2F4`, a `#F8F8F9` wash, a vignette of
 * the same - which meant that on a dark phone the sign-in funnel arrived as a
 * sheet of near-white over a black app. The tints are mixed from `--color-ink`
 * and `--color-page` instead, so they invert with the theme: a dark wash on a
 * light page, a light one on a dark page, and the same amount of depth either
 * way.
 */
export function FunnelBackdrop({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden',
        'bg-page',
        className,
      )}
    >
      {/* One composite mesh — no animated gradients */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(85% 60% at 15% 0%, color-mix(in srgb, var(--color-ink) 5.5%, transparent), transparent 58%)',
            'radial-gradient(70% 50% at 95% 25%, color-mix(in srgb, var(--color-ink) 6%, transparent), transparent 55%)',
            'radial-gradient(90% 45% at 50% 100%, color-mix(in srgb, var(--color-ink) 5%, transparent), transparent 55%)',
            'linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 45%, transparent) 0%, transparent 100%)',
          ].join(','),
        }}
        aria-hidden
      />

      {/* Soft static mass with gentle opacity breath only */}
      <div
        className="funnel-orb-breathe pointer-events-none absolute -left-12 top-[10%] size-[14rem] rounded-full bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)] blur-3xl"
        aria-hidden
      />
      <div
        className="funnel-orb-breathe pointer-events-none absolute -right-14 top-[42%] size-[12rem] rounded-full bg-[color-mix(in_srgb,var(--color-ink)_6%,transparent)] blur-3xl"
        style={{ animationDelay: '3s' }}
        aria-hidden
      />

      {/* Light vignette */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_42%,transparent_40%,color-mix(in_srgb,var(--color-page)_65%,transparent)_100%)]"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
