import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { ChevronRightIcon } from '../icons/index.js';
import { PingoDot } from '../brand/PingoDot.js';
import { cn } from '../utils/cn.js';

/**
 * Button - the three variants on the branding board.
 *
 *   primary   gradient fill, brand glow. One per view; it is the answer to
 *             "what should I do here?"
 *   secondary white fill, hairline border. Everything else.
 *   text      no chrome, brand-coloured, with an optional trailing chevron.
 *
 * Notes on the details that matter:
 *   - Press feedback is a 2% inward scale, not a colour flash. It reads as
 *     physical, which a colour change does not.
 *   - `loading` swaps the label for the brand dots and keeps the button's width,
 *     so the layout never jumps mid-action.
 *   - Disabled buttons drop to 45% opacity rather than turning grey: a grey
 *     button on a near-white page looks broken rather than unavailable.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  /** Fills the container width. Used for onboarding and sheet actions. */
  block?: boolean;
  loading?: boolean;
  /** Trailing chevron. Idiomatic for `text` buttons that navigate onward. */
  trailingChevron?: boolean;
  leadingIcon?: ReactNode;
}

const BASE = cn(
  'relative inline-flex items-center justify-center gap-2',
  'font-sans font-medium whitespace-nowrap select-none',
  'focus-ring',
  'transition-[transform,box-shadow,background-color,border-color,color,opacity]',
  'duration-instant ease-standard',
  'active:scale-[0.98]',
  'disabled:pointer-events-none disabled:opacity-45',
);

const VARIANT: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-brand-gradient text-white shadow-brand',
    // Lifting the shadow on hover is enough; the gradient itself never shifts.
    'hover:shadow-lg',
    'active:shadow-sm',
  ),
  secondary: cn(
    'bg-surface text-ink border border-line shadow-sm',
    'hover:bg-hover hover:border-line-strong',
  ),
  text: cn('text-brand hover:bg-hover', 'active:scale-[0.96]'),
};

/** `text` buttons get tighter padding, they are labels, not surfaces. */
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-caption rounded-md',
  md: 'h-11 px-5 text-body rounded-md',
  lg: 'h-13 px-7 text-body rounded-lg',
};

const TEXT_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-2 text-caption rounded-sm',
  md: 'h-9 px-2.5 text-body rounded-md',
  lg: 'h-10 px-3 text-body rounded-md',
};

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  block = false,
  loading = false,
  trailingChevron = false,
  leadingIcon,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANT[variant],
        variant === 'text' ? TEXT_SIZE[size] : SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {/*
        The label stays mounted and is hidden with opacity while loading. That
        preserves the button's intrinsic width, so nothing around it reflows.
      */}
      <span
        className={cn(
          'inline-flex items-center gap-2',
          loading && 'opacity-0',
        )}
      >
        {leadingIcon}
        {children}
        {trailingChevron && <ChevronRightIcon size={16} />}
      </span>

      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <PingoDot
            state="loading"
            size={size === 'sm' ? 5 : 6}
            // On the gradient fill the purple dot has no contrast, so go white.
            className={variant === 'primary' ? '[&>span]:bg-white' : undefined}
            label="Loading"
          />
        </span>
      )}
    </button>
  );
}

/**
 * A square, icon-only button for chrome: headers, composers, the dock.
 *
 * Separate from `Button` because the constraints are different - it must stay
 * square, it must never contain text, and it *requires* an accessible label,
 * which the type signature enforces.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  label: string;
  size?: ButtonSize;
  variant?: 'ghost' | 'filled' | 'gradient';
}

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'size-9',
  md: 'size-10',
  lg: 'size-11',
};

const ICON_VARIANT = {
  ghost: 'text-text-secondary hover:bg-hover hover:text-ink',
  filled: 'bg-sunken text-ink hover:bg-hover',
  gradient: 'bg-brand-gradient text-white shadow-brand hover:shadow-lg',
} as const;

export function IconButton({
  children,
  label,
  size = 'md',
  variant = 'ghost',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-full',
        'focus-ring transition-all duration-instant ease-standard',
        // The visual size stays; the hit area reaches 44×44. A row of 44px
        // buttons in a header looks heavy, and a 40px target under a thumb is
        // a miss - this is how both are true at once.
        'touch-target',
        'active:scale-[0.96]',
        'disabled:pointer-events-none disabled:opacity-45',
        ICON_SIZE[size],
        ICON_VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
