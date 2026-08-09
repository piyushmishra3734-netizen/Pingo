import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

import './funnel-motion.css';

/**
 * Identity funnel stage — quiet depth, cheap to paint.
 *
 * Static mesh + two soft orbs (opacity-only motion). No grain, no multi-layer
 * blur stacks. Feels finished without costing frames.
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
        'bg-[#F2F2F4]',
        className,
      )}
    >
      {/* One composite mesh — no animated gradients */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(85% 60% at 15% 0%, rgb(17 17 19 / 0.055), transparent 58%)',
            'radial-gradient(70% 50% at 95% 25%, rgb(60 70 90 / 0.06), transparent 55%)',
            'radial-gradient(90% 45% at 50% 100%, rgb(17 17 19 / 0.05), transparent 55%)',
            'linear-gradient(180deg, #F8F8F9 0%, #F2F2F4 100%)',
          ].join(','),
        }}
        aria-hidden
      />

      {/* Soft static mass with gentle opacity breath only */}
      <div
        className="funnel-orb-breathe pointer-events-none absolute -left-12 top-[10%] size-[14rem] rounded-full bg-[rgb(17_17_19/0.05)] blur-3xl"
        aria-hidden
      />
      <div
        className="funnel-orb-breathe pointer-events-none absolute -right-14 top-[42%] size-[12rem] rounded-full bg-[rgb(55_65_85/0.06)] blur-3xl"
        style={{ animationDelay: '3s' }}
        aria-hidden
      />

      {/* Light vignette */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_42%,transparent_40%,rgb(242_242_244/0.65)_100%)]"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
