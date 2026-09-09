import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

import './funnel-motion.css';

/**
 * The ground the identity funnel stands on.
 *
 * ## One layer, not four
 *
 * This used to paint four radial gradients, two blurred orbs breathing on a
 * loop, and a vignette - three decorative layers behind a form with two fields
 * in it. That is the background being the busiest thing on screen, and it is
 * why the section read as *trying* to look finished: decoration was doing the
 * work that type and spacing should do.
 *
 * What is left is a single soft wash from the top. It gives the page somewhere
 * to start without competing with anything, and it costs one paint.
 *
 * ## Every colour is still a mix of a token, not a hex
 *
 * It was once painted in light greys - `#F2F2F4`, a `#F8F8F9` wash - which
 * meant that on a dark phone the sign-in funnel arrived as a sheet of
 * near-white over a black app. The tint is mixed from `--color-ink` instead, so
 * it inverts with the theme and carries the same amount of depth either way.
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
      {/*
        One wash. Mixed from ink so it inverts, and stopping well short of the
        bottom so the primary button never sits on a gradient.
      */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(90% 55% at 50% 0%, color-mix(in srgb, var(--color-ink) 5%, transparent), transparent 62%)',
        }}
        aria-hidden
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
