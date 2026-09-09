import { cn } from '@pingo/ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Primary funnel CTA - brand tokens, so the Appearance accent retints it. The
 * default product accent is ink; purple, green and pink all still work.
 *
 * Sizes and curves come from `packages/tokens` rather than being typed out
 * here. They used to be `text-[0.9375rem]`, `tracking-[-0.01em]` and a
 * `cubic-bezier(0.23,1,0.32,1)` that is not the app's curve - see the note at
 * the top of `AuthScreen`.
 */
export function FunnelCta({
  children,
  className,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      aria-busy={loading || undefined}
      className={cn(
        'relative flex h-12 w-full items-center justify-center rounded-lg',
        'bg-brand-gradient text-on-brand text-body font-medium',
        'shadow-brand',
        'transition-[transform,box-shadow,opacity] duration-instant ease-standard',
        'hover:shadow-lg',
        'active:scale-[0.97] active:shadow-sm',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-focus-ring)]',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      <span className={cn(loading && 'opacity-0')}>{children}</span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="size-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </span>
      )}
    </button>
  );
}

export function FunnelTextLink({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-md px-3 py-2 text-body font-medium text-brand',
        'underline-offset-4 transition-[opacity,transform,background-color]',
        'duration-instant ease-standard',
        'hover:bg-hover hover:underline active:scale-[0.97]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-focus-ring)]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
