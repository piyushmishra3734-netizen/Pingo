import type { ReactNode } from 'react';

import { ChevronRightIcon } from '../icons/index.js';
import { cn } from '../utils/cn.js';

/**
 * ListRow - the settings-row pattern from the board: icon, label, chevron.
 *
 * Renders as a `<button>` when given `onClick` and a `<div>` otherwise, because a
 * row holding a toggle is not itself clickable and should not be announced as a
 * button. Getting this wrong is the most common accessibility defect in settings
 * screens.
 *
 * Icons sit in a fixed-width slot so labels align down the column even when the
 * glyphs have different optical widths.
 */

export interface ListRowProps {
  label: string;
  /** Second line, for state or explanation. */
  description?: string;
  icon?: ReactNode;
  /** Right-hand content: a Toggle, a value, a Badge. */
  trailing?: ReactNode;
  onClick?: () => void;
  /** Shows the chevron. Implied by `onClick` unless `trailing` is present. */
  chevron?: boolean;
  /** Styles the label and icon as destructive. */
  destructive?: boolean;
  className?: string;
}

export function ListRow({
  label,
  description,
  icon,
  trailing,
  onClick,
  chevron,
  destructive = false,
  className,
}: ListRowProps) {
  const showChevron = chevron ?? (Boolean(onClick) && !trailing);
  const interactive = Boolean(onClick);

  const content = (
    <>
      {icon && (
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center',
            destructive ? 'text-danger' : 'text-text-secondary',
          )}
          aria-hidden
        >
          {icon}
        </span>
      )}

      <span className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            'block truncate font-sans text-body',
            destructive ? 'text-danger' : 'text-ink',
          )}
        >
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-caption text-text-secondary">
            {description}
          </span>
        )}
      </span>

      {trailing && <span className="shrink-0">{trailing}</span>}

      {showChevron && (
        <ChevronRightIcon size={18} className="shrink-0 text-text-tertiary" />
      )}
    </>
  );

  const shared = cn(
    'flex w-full items-center gap-3 rounded-md px-3 py-3',
    'transition-[background-color,transform] duration-instant ease-standard active:scale-[0.99]',
    className,
  );

  if (!interactive) {
    return <div className={shared}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(shared, 'focus-ring hover:bg-hover active:bg-pressed')}
    >
      {content}
    </button>
  );
}

/**
 * Groups rows into one card with hairline dividers.
 *
 * Dividers are drawn between children with a selector rather than per-row, so a
 * group never ends with a stray line - a small detail that separates a tidy
 * settings screen from a sloppy one.
 */
export function ListGroup({
  children,
  title,
  className,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <section className={className}>
      {title && (
        <h2 className="mb-2 px-3 text-caption font-medium uppercase tracking-wider text-text-tertiary">
          {title}
        </h2>
      )}
      <div
        className={cn(
          'rounded-lg bg-surface p-1 shadow-sm',
          '[&>*+*]:relative',
          "[&>*+*]:before:absolute [&>*+*]:before:left-3 [&>*+*]:before:right-3 [&>*+*]:before:top-0",
          '[&>*+*]:before:h-px [&>*+*]:before:bg-divider',
        )}
      >
        {children}
      </div>
    </section>
  );
}
