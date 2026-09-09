import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

/**
 * "Continue with Google". "Continue with phone number".
 *
 * ## Why this replaced `MethodCard`
 *
 * The old one was a list row wearing a card: a border, a shadow, a tinted icon
 * tile and a chevron, per method. Three separate devices all saying "tap this",
 * on a screen whose entire job is two choices - and the chevron in particular
 * promises a submenu that is not there. Apple's own sign-in buttons are
 * full-width buttons with a mark and a named action, and nothing else.
 *
 * ## The label always names the method
 *
 * HIG, Managing accounts: "Always identify the authentication method you
 * offer … title it using a phrase like 'Sign In with Face ID' instead of a
 * generic phrase like 'Sign In.'" The rows used to read "Google" and "Phone",
 * which are nouns, not actions, and say nothing about what is about to happen.
 *
 * `variant` exists because a chooser with two equal buttons has no shape. The
 * first method is filled, the rest are outlined - same size, same height, one
 * of them obviously the way most people go.
 */
export function MethodButton({
  label,
  icon,
  onClick,
  variant = 'outline',
  badge,
  delayMs = 0,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'outline';
  /** "Last used", and nothing else so far. */
  badge?: string;
  delayMs?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${delayMs}ms` }}
      className={cn(
        'funnel-enter relative flex h-12 w-full items-center justify-center gap-2.5',
        'rounded-lg text-body font-medium',
        'transition-[transform,background-color,border-color] duration-instant ease-standard',
        'active:scale-[0.98]',
        'focus-ring',
        variant === 'primary'
          ? 'bg-brand-gradient text-on-brand shadow-brand active:shadow-sm'
          : 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-hover',
      )}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      {label}
      {badge ? (
        /*
          The badge has to survive both grounds. Brand-on-selected is legible on
          the outlined button and nearly invisible on the gradient, which is
          where the last-used method actually sits - it is promoted to first,
          and first is the filled one.
        */
        <span
          className={cn(
            'absolute right-3 rounded-sm px-1.5 py-0.5 text-caption font-medium',
            variant === 'primary'
              ? 'bg-white/20 text-on-brand'
              : 'bg-selected text-brand',
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
