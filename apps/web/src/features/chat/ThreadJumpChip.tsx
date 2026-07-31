import { cn } from '@pingo/ui';

/**
 * Single slot above the composer for thread navigation.
 *
 * Two labels, one control:
 *   - `latest` — jump to the bottom
 *   - `new`    — jump to the first unread of this away session
 *
 * New Messages always wins when both would apply; the parent never mounts two.
 */

export type ThreadJumpMode = 'latest' | 'new';

export interface ThreadJumpChipProps {
  mode: ThreadJumpMode;
  /** Only for `new`. Capped at 99+ in the label. */
  count?: number;
  onClick: () => void;
  className?: string;
}

export function ThreadJumpChip({ mode, count = 0, onClick, className }: ThreadJumpChipProps) {
  const label = mode === 'latest' ? formatLatestLabel() : formatNewLabel(count);
  const aria =
    mode === 'latest'
      ? 'Jump to latest messages.'
      : count <= 1
        ? '1 new message. Jump to unread.'
        : `${count > 99 ? '99 or more' : count} new messages. Jump to unread.`;

  return (
    <div className={cn('mb-2 flex justify-center', className)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={aria}
        className={cn(
          'focus-ring inline-flex items-center gap-1.5 rounded-full',
          'glass-surface px-3 py-1.5 shadow-sm',
          'text-caption font-medium text-ink',
          'transition-[opacity,transform] duration-base ease-liquid',
          'motion-safe:animate-[fade-in_var(--duration-base)_var(--ease-liquid)_both]',
          'hover:bg-hover active:scale-[0.98]',
        )}
      >
        <span aria-hidden className="text-text-secondary">
          ↓
        </span>
        <span>{label}</span>
      </button>
    </div>
  );
}

function formatLatestLabel(): string {
  return 'Latest';
}

function formatNewLabel(count: number): string {
  if (count <= 1) return 'New Message';
  if (count > 99) return 'New Messages (99+)';
  return `New Messages (${count})`;
}
