import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../utils/cn.js';

/**
 * Chip - the filter pills on the home screen (All · Unread · Groups · Favorites).
 *
 * Selection is shown with a brand-tinted wash and brand text, not a solid fill.
 * A solid fill would make the selected chip compete with the primary button for
 * attention; a wash states the selection quietly, which is the whole point.
 *
 * Rendered as a `radio` in a `radiogroup` rather than a set of buttons, so
 * keyboard users get arrow-key traversal and screen readers announce
 * "2 of 4 selected" instead of four unrelated buttons.
 */

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  selected?: boolean;
  /** Trailing count. Hidden at zero - an empty filter needs no badge. */
  count?: number;
}

export function Chip({
  children,
  selected = false,
  count,
  className,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      role="radio"
      aria-checked={selected}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full',
        'h-8 px-3.5',
        'font-sans text-caption font-medium',
        'focus-ring transition-all duration-instant ease-standard',
        // 32px reads right in a filter row; 32px under a thumb does not. The
        // overlay reaches 44×44 without the chip growing - same trick, and the
        // same reason, as IconButton.
        'touch-target',
        'active:scale-[0.96]',
        selected
          ? // Selected is the only chip at full brand strength so the eye
            // lands on it first among equals.
            'bg-selected text-brand'
          : // Unselected ~6% quieter so weight separates without a redesign.
            'bg-sunken/85 text-text-secondary/90 hover:bg-hover hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            'tabular-nums',
            selected ? 'text-brand/75' : 'text-text-tertiary',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Wrapper for a row of chips. Owns the horizontal scroll behaviour so the row
 * never wraps to a second line on narrow screens - a wrapping filter row makes
 * the header height jump as filters change.
 */
export function ChipGroup({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex items-center gap-2 overflow-x-auto',
        // Hide the scrollbar: the row is short and a visible bar is noise.
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}
