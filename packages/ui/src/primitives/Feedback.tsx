import type { CSSProperties, ReactNode } from 'react';

import { PingoLoader } from '../brand/PingoLoader.js';
import { cn } from '../utils/cn.js';

/**
 * Loading and empty states.
 *
 * Both are treated as designed screens rather than afterthoughts, because they
 * are what a user sees first on a slow connection and on their first day.
 */

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export interface SkeletonProps {
  className?: string;
  /** Rounds fully, for avatar placeholders. */
  circle?: boolean;
  /** For widths that must vary per instance, which utilities cannot express. */
  style?: CSSProperties;
}

/**
 * A placeholder block, with a light passing across it.
 *
 * This used to pulse its opacity, on the reasoning that a shimmer draws the eye
 * and implies progress it cannot know about. The reasoning still holds and the
 * decision changed anyway, because a second thing outweighed it: the boot shell
 * in `index.html` paints these same placeholders before React exists, and the
 * handover between the two has to be invisible. One animation, in one place -
 * see `.skeleton` in tokens.css - is what makes that true.
 *
 * It also stops borrowing `dot-pulse`, which belongs to the presence dot and
 * means "this person is here". A placeholder is not a person, and sharing the
 * animation meant neither could be tuned without moving the other.
 */
export function Skeleton({ className, circle = false, style }: SkeletonProps) {
  return (
    <span
      className={cn(
        'block skeleton bg-sunken',
        circle ? 'rounded-full' : 'rounded-md',
        className,
      )}
      style={style}
      aria-hidden
    />
  );
}

/** The conversation-list skeleton: avatar, title, preview - the real row's shape. */
export function ConversationSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1" role="status" aria-label="Loading conversations">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <Skeleton circle className="size-11" />
          <div className="flex-1 space-y-2">
            {/* Varied widths so the placeholder reads as text, not as bars. */}
            <Skeleton className="h-3.5" style={{ width: `${52 + ((i * 13) % 26)}%` }} />
            <Skeleton className="h-3" style={{ width: `${34 + ((i * 17) % 30)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * What a lazily-loaded screen shows while its chunk is on the way.
 *
 * Fifty of the app's screens are `React.lazy`, and the Suspense boundary
 * around them had `fallback={null}` - so opening settings, a profile or the
 * camera on a slow connection showed nothing at all, and the dock went with it
 * because the boundary wraps the whole route. It is the same blank the app used
 * to start on, arriving later.
 *
 * A title and some rows, in the same language as the boot shell in
 * `index.html` and the conversation list beside it: most lazy screens here are
 * a heading over a list, so this is close enough to be a promise rather than a
 * decoration. The rows fade out down the page, which stops it reading as a real
 * list that has failed to fill in.
 */
export function ScreenSkeleton() {
  return (
    <div className="space-y-4 p-4" role="status" aria-label="Loading">
      <Skeleton className="h-6 w-32" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-xl" style={{ opacity: 1 - i * 0.13 }} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Full-area loading — three soft ink dots, nothing else.
 *
 * No card, no spinner arc. Calm centre of the screen; the wait is small and
 * confident rather than decorated.
 */
export function LoadingState({
  label = 'Loading',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 py-20',
        'motion-safe:animate-loader-enter',
        className,
      )}
    >
      <PingoLoader size={48} label={label} />
      <p className="text-[0.8125rem] font-medium tracking-[-0.02em] text-text-tertiary">
        {label}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  title: string;
  /** One calm sentence. Says what to do next, never apologises. */
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-8 py-16 text-center',
        className,
      )}
    >
      {icon && (
        <div
          className="mb-5 grid size-14 place-items-center rounded-xl bg-sunken text-text-tertiary"
          aria-hidden
        >
          {icon}
        </div>
      )}
      <h2 className="text-h2 text-ink">{title}</h2>
      {description && (
        <p className="mt-2 max-w-xs text-body text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
