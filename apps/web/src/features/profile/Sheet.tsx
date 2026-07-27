import { cn } from '@pingo/ui';
import { useEffect, useRef } from 'react';

import { useReturnFocus } from '../conversations/focus-restore.js';

import { Overlay } from '../../components/Overlay.js';

/**
 * The bottom sheet, once.
 *
 * The chat list grew four of these — mute, delete, lists, conversation menu —
 * and each one re-implemented the same four things: a portal, a scrim that
 * closes on tap, focus moved in and handed back, and Escape. The profile module
 * needs five more, and nine copies of that is nine chances for one of them to
 * quietly forget the Escape key.
 *
 * So the behaviour lives here and the sheets supply only their contents. The
 * existing chat-list sheets are deliberately *not* migrated: they work, they are
 * tested, and rewriting working screens is not what this module is for.
 *
 * ## Why a portal
 *
 * Anything with a `transform`, `filter` or `backdrop-filter` on an ancestor
 * becomes the containing block for `position: fixed` inside it — and the app
 * shell has all three. A sheet rendered in place ends up clipped to whatever
 * card it was declared in, which is how the photo editor once opened 100px
 * short of the bottom of the screen. Rendering into `document.body` is what
 * makes "fixed" mean the viewport.
 */

export interface SheetProps {
  title: string;
  /** Optional supporting line under the title. */
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Hides the heading visually while keeping it for screen readers. */
  hideTitle?: boolean;
  className?: string;
}

export function Sheet({
  title,
  description,
  onClose,
  children,
  hideTitle,
  className,
}: SheetProps) {
  useReturnFocus();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`sheet-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    panelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <Overlay>
      <div
        className="fixed inset-0 z-500 flex items-end justify-center sm:items-center"
        onPointerDown={onClose}
      >
        <div className="absolute inset-0 animate-fade-in bg-ink/[0.18]" />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          // The scrim closes on tap; the panel must not, or every button in it
          // would close the sheet before it did its job.
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'animate-panel-in relative w-full max-w-sm outline-none',
            'max-h-[85vh] overflow-y-auto',
            'rounded-t-xl border border-line bg-surface p-4 shadow-lg',
            'pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-xl sm:pb-4',
            className,
          )}
        >
          <h2 id={titleId} className={cn('text-h2 text-ink', hideTitle && 'sr-only')}>
            {title}
          </h2>
          {description && !hideTitle && (
            <p className="mt-1.5 text-caption text-text-secondary">{description}</p>
          )}

          {children}
        </div>
      </div>
    </Overlay>
  );
}

/**
 * A row inside a sheet: an icon, a label, and the whole width to tap.
 *
 * `py-3` on body text clears 44px, which is the minimum target the rest of the
 * product holds itself to.
 */
export function SheetItem({
  icon,
  label,
  hint,
  tone = 'normal',
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  tone?: 'normal' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'focus-ring flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left',
        'transition-colors duration-instant hover:bg-hover active:bg-pressed',
        tone === 'danger' ? 'text-danger' : 'text-ink',
      )}
    >
      {icon && <span className="shrink-0 text-text-tertiary">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{label}</span>
        {hint && <span className="block truncate text-caption text-text-secondary">{hint}</span>}
      </span>
    </button>
  );
}

export function SheetCancel({ onClick, label = 'Cancel' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'focus-ring mt-1 w-full rounded-full px-5 py-3 text-body',
        'text-text-secondary hover:bg-hover',
      )}
    >
      {label}
    </button>
  );
}
