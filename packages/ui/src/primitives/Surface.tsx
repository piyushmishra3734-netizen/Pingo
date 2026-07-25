import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../utils/cn.js';

/**
 * The surface family: Card, GlassPanel and Badge.
 *
 * Grouped in one file because they are all answers to the same question — how
 * something sits above the page — and keeping the elevation decisions adjacent
 * is what stops them drifting apart.
 */

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** `flat` for cards inside an already-elevated container. */
  elevation?: 'flat' | 'sm' | 'md' | 'lg';
  /** Adds hover and press feedback. Only for cards that actually do something. */
  interactive?: boolean;
  padded?: boolean;
}

const ELEVATION = {
  flat: 'shadow-none border border-line',
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
} as const;

export function Card({
  children,
  elevation = 'sm',
  interactive = false,
  padded = true,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg bg-surface',
        ELEVATION[elevation],
        padded && 'p-4',
        interactive &&
          cn(
            'cursor-pointer transition-all duration-instant ease-standard',
            'hover:shadow-md active:scale-[0.995]',
          ),
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GlassPanel
// ---------------------------------------------------------------------------

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * Liquid glass, for chrome that floats over content — the dock, sticky headers.
 *
 * Used sparingly and only where something scrolls behind it. Glass over a static
 * background is just a tinted box paying the cost of a backdrop filter.
 */
export function GlassPanel({ children, className, ...rest }: GlassPanelProps) {
  return (
    <div
      className={cn('glass-surface rounded-xl shadow-lg', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export interface BadgeProps {
  /** Rendered as "99+" above 99, so the badge can never stretch a layout. */
  count?: number;
  /** Text badges for labels like "Group" or "Muted". */
  children?: ReactNode;
  tone?: 'brand' | 'neutral' | 'danger';
  className?: string;
  /** Screen-reader context, e.g. "unread messages". */
  srSuffix?: string;
}

const TONE = {
  brand: 'bg-dot text-white',
  neutral: 'bg-sunken text-text-secondary',
  danger: 'bg-danger text-white',
} as const;

export function Badge({
  count,
  children,
  tone = 'brand',
  className,
  srSuffix,
}: BadgeProps) {
  // A zero count is not a badge. Rendering "0" would be noise.
  if (count !== undefined && count <= 0 && !children) return null;

  const content = children ?? (count !== undefined && count > 99 ? '99+' : count);

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full',
        'font-sans text-caption font-medium tabular-nums',
        // min-w equal to the height keeps single digits perfectly circular.
        'h-5 min-w-5 px-1.5',
        TONE[tone],
        className,
      )}
    >
      {content}
      {srSuffix && <span className="sr-only"> {srSuffix}</span>}
    </span>
  );
}
