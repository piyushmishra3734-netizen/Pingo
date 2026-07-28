import type { CSSProperties, ReactNode } from 'react';

import { PingoLoader } from '../brand/PingoLoader.js';
import { cn } from '../utils/cn.js';

/**
 * Loading and empty states.
 *
 * Both are treated as designed screens rather than afterthoughts, because they
 * are what a user sees first on a slow connection and on their first day. A
 * spinner and the word "Empty" would undo the calm the rest of the product works
 * for.
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
 * A placeholder block.
 *
 * Pulses opacity rather than sweeping a shimmer gradient across itself. A
 * shimmer draws the eye and implies progress it cannot know about; a slow fade
 * simply says "not yet".
 */
export function Skeleton({ className, circle = false, style }: SkeletonProps) {
  return (
    <span
      className={cn(
        'block animate-dot-pulse bg-sunken',
        circle ? 'rounded-full' : 'rounded-md',
        className,
      )}
      style={style}
      aria-hidden
    />
  );
}

/** The conversation-list skeleton: avatar, title, preview — the real row's shape. */
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

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Full-area loading, using the monogram's loading state.
 *
 * The brand mark is the product's spinner. Introducing a generic circular
 * spinner anywhere would be the one moment the design system broke character.
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
        'flex flex-col items-center justify-center gap-4 py-16',
        className,
      )}
    >
      <PingoLoader size={44} label={label} />
      <p className="text-caption text-text-tertiary">{label}</p>
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
