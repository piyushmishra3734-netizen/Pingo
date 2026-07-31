import { cn } from '@pingo/ui';

/**
 * Single slot above the composer for thread navigation.
 *
 * Text-only control - no pill, no glass bubble, no full-width bar. A quiet
 * label with a soft brand wash and a hint of glow so it stays findable without
 * reading as a second UI chrome strip.
 *
 * Modes: `latest` (bottom) · `new` (first unread). Parent shows one or none.
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
    <div className={cn('flex justify-center', className)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={aria}
        className={cn(
          'focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1',
          // No glass pill / shadow strip - just type with a soft brand wash.
          'text-caption font-medium text-brand',
          'bg-brand/10',
          // Quiet glow - findable, not a lamp.
          'shadow-[0_0_16px_rgba(92,108,255,0.22)]',
          'transition-[opacity,transform,box-shadow,background-color] duration-base ease-liquid',
          'motion-safe:animate-[fade-in_var(--duration-base)_var(--ease-liquid)_both]',
          'hover:bg-brand/14 hover:shadow-[0_0_20px_rgba(92,108,255,0.3)]',
          'active:scale-[0.98]',
        )}
      >
        <span aria-hidden className="opacity-80">
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
