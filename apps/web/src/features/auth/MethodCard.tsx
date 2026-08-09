import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

/**
 * Method door — crisp hover, short transitions, solid white (no backdrop-blur).
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
        'border border-black/[0.07] bg-white',
        'shadow-[0_1px_2px_rgba(0,0,0,0.03)]',
        'transition-[transform,border-color,box-shadow] duration-150',
        'ease-[cubic-bezier(0.23,1,0.32,1)]',
        'hover:border-black/[0.12] hover:shadow-[0_4px_14px_rgba(0,0,0,0.06)]',
        'active:scale-[0.985]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111113]',
      )}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-[10px]',
          'bg-[#F0F0F2] text-[#111113]',
          'transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
          'group-active:scale-95',
        )}
        aria-hidden
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="block truncate text-[0.9375rem] font-medium tracking-[-0.01em] text-[#111113]">
            {label}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-md bg-[#F0F0F2] px-1.5 py-0.5 text-[0.6875rem] font-medium text-[#6B6B6F]">
              {badge}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-0.5 block truncate text-[0.8125rem] text-[#8B8B90]">
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
          'shrink-0 text-[#C4C4C8]',
          'transition-[transform,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
          'group-hover:translate-x-0.5 group-hover:text-[#111113]',
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
