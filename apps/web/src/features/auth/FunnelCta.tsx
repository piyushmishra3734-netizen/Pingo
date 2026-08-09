import { cn } from '@pingo/ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Near-black primary — snappy press, no enter sheen (sheen felt laggy).
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
        'relative flex h-12 w-full items-center justify-center rounded-xl',
        'bg-[#111113] text-[0.9375rem] font-medium tracking-[-0.01em] text-white',
        'shadow-[0_1px_2px_rgba(0,0,0,0.08),0_6px_16px_rgba(0,0,0,0.1)]',
        'transition-[transform,background-color,box-shadow] duration-100',
        'ease-[cubic-bezier(0.23,1,0.32,1)]',
        'hover:bg-black hover:shadow-[0_2px_8px_rgba(0,0,0,0.12)]',
        'active:scale-[0.97] active:shadow-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111113]',
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
        'rounded-lg px-3 py-2 text-[0.9375rem] font-medium text-[#111113]',
        'underline-offset-4 transition-[opacity,transform,background-color] duration-100',
        'ease-[cubic-bezier(0.23,1,0.32,1)]',
        'hover:bg-black/[0.04] hover:underline active:scale-[0.97]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111113]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
