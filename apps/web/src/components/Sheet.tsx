import { cn } from '@pingo/ui';
import { useEffect, useId, useRef } from 'react';

import { useReturnFocus } from '../features/conversations/focus-restore.js';

import { Overlay } from './Overlay.js';

/**
 * The bottom sheet, once.
 *
 * The chat list grew four of these - mute, delete, lists, conversation menu  - 
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
 * becomes the containing block for `position: fixed` inside it - and the app
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
  /**
   * Puts the sheet above the full-screen layers rather than beside them.
   *
   * Ordinary sheets sit at `z-500`, which is above the app and below the post
   * viewer, the photo viewer and a call - all of which are `z-1000` and are all
   * places a confirmation can be asked *from*. A confirm rendered at the normal
   * height would open behind the very thing that opened it.
   */
  elevated?: boolean;
  className?: string;
}

export function Sheet({
  title,
  description,
  onClose,
  children,
  hideTitle,
  elevated = false,
  className,
}: SheetProps) {
  useReturnFocus();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  /*
   * Focus goes to the panel, unless something inside asked for it first.
   *
   * React runs a child's effects before its parent's, so a sheet whose content
   * carries `autoFocus` had focus taken back off it a frame later - the caption
   * editor opened with the cursor nowhere. Honouring the attribute here means
   * a form sheet lands in its field and a menu sheet still lands on the dialog,
   * which is the right answer for each.
   */
  useEffect(() => {
    const wanted = panelRef.current?.querySelector<HTMLElement>('[autofocus]');
    (wanted ?? panelRef.current)?.focus();
  }, []);

  /*
   * Escape, and who else gets to hear it.
   *
   * An elevated sheet is by definition on top of something that also listens
   * for Escape - the post viewer, the photo viewer, a conversation menu. Two
   * window listeners both fire, so one Escape would dismiss the confirmation
   * *and* close the thing that asked the question, which is a strange way to
   * answer "no".
   *
   * So an elevated sheet listens in the capture phase, before anything bound to
   * the bubble, and stops the event dead. An ordinary sheet does not: it has
   * nothing above it and no reason to take the key away from anyone.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (elevated) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      onClose();
    };
    window.addEventListener('keydown', onKey, elevated);
    return () => {
      window.removeEventListener('keydown', onKey, elevated);
    };
  }, [onClose, elevated]);

  return (
    <Overlay>
      <div
        className={cn(
          'fixed inset-0 flex items-end justify-center sm:items-center',
          elevated ? 'z-[1100]' : 'z-500',
        )}
        onPointerDown={onClose}
      >
        <div className="absolute inset-0 animate-fade-in bg-backdrop/[0.18]" />

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
        'focus-ring flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left',
        'transition-colors duration-instant hover:bg-hover active:bg-pressed',
        tone === 'danger' ? 'text-danger' : 'text-ink',
      )}
    >
      {/*
        The glyph gets a disc of its own.
        A 20px grey icon floating beside a line of text is the shape of a
        settings row, and these are choices - the two options on "Add to your
        story" carried no more weight than a label. A tinted disc gives each one
        a body to be picked, and the tint follows the tone so a destructive row
        never borrows the brand's colour to look inviting.
      */}
      {icon && (
        <span
          aria-hidden
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-full',
            tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand',
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{label}</span>
        {hint && (
          <span className="block truncate pt-0.5 text-caption text-text-secondary">{hint}</span>
        )}
      </span>
    </button>
  );
}

/**
 * The way out.
 *
 * Separated by a hairline rather than by being another full-width row in the
 * same stack. It was the same size and shape as the choices above it, so a
 * sheet offering two things appeared to offer three - and the third was the
 * one that does nothing.
 */
export function SheetCancel({ onClick, label = 'Cancel' }: { onClick: () => void; label?: string }) {
  return (
    <div className="mt-1 border-t border-line/60 pt-1">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'focus-ring w-full rounded-xl px-5 py-2.5 text-caption font-medium',
          'text-text-secondary transition-colors duration-instant hover:bg-hover hover:text-ink',
        )}
      >
        {label}
      </button>
    </div>
  );
}
