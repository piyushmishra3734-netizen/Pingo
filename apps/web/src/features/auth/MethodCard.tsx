import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

/**
 * Method door — neutral card; text is ink (content), focus uses brand ring.
 * Accent never hardcodes black: focus-ring / hover follow tokens.
 */
export function MethodCard({
  icon,
  label,
  description,
  onClick,
  badge,
  delayMs = 0,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  badge?: string;
  delayMs?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${delayMs}ms` }}
      className={cn(
        'group funnel-enter flex w-full items-center gap-3.5 rounded-xl px-3.5 py-3.5 text-left',
        'border border-line bg-surface',
        'shadow-[0_1px_2px_rgba(16,17,20,0.03)]',
        'transition-[transform,border-color,box-shadow] duration-150',
        'ease-[cubic-bezier(0.23,1,0.32,1)]',
        'hover:border-line-strong hover:shadow-sm',
        'active:scale-[0.985]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-focus-ring)]',
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-[10px]',
          'bg-sunken text-ink',
          'transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
          'group-active:scale-95',
        )}
        aria-hidden
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="block truncate text-[0.9375rem] font-medium tracking-[-0.01em] text-ink">
            {label}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-md bg-selected px-1.5 py-0.5 text-[0.6875rem] font-medium text-brand">
              {badge}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-0.5 block truncate text-[0.8125rem] text-text-tertiary">
            {description}
          </span>
        ) : null}
      </span>

      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        className={cn(
          'shrink-0 text-text-tertiary',
          'transition-[transform,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
          'group-hover:translate-x-0.5 group-hover:text-brand',
        )}
        aria-hidden
      >
        <path
          d="m9 6 6 6-6 6"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
