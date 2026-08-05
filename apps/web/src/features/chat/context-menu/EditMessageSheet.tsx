import { cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { Overlay } from '../../../components/Overlay.js';

/**
 * Editing a message, in the app rather than in the browser.
 *
 * This replaces `window.prompt`, which was placeholder scaffolding that shipped.
 * A native prompt is the browser's dialog, not PINGO's: it carries the origin
 * in its title bar, ignores every token in the design system, cannot be styled
 * or animated, blocks the whole page while it is up, and on several mobile
 * browsers is suppressed outright - so on the platform this product is mostly
 * used on, Edit silently did nothing at all.
 *
 * ## Why a centred dialog and not an inline field
 *
 * Editing in place inside the bubble reads better on paper, but the bubble is
 * right-aligned, sized to its content and possibly two lines from the bottom of
 * the screen - so the field would jump around, and on a phone the keyboard
 * would cover the thing being edited about half the time. A dialog above the
 * keyboard is the boring answer that always works.
 */

export interface EditMessageSheetProps {
  /** The text as it stands. The field opens with this, selected. */
  body: string;
  onCancel: () => void;
  onSave: (next: string) => void;
}

export function EditMessageSheet({ body, onCancel, onSave }: EditMessageSheetProps) {
  const [value, setValue] = useState(body);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    /*
     * Caret at the end rather than the text selected.
     *
     * Most edits are a fix at the end or a small change in the middle; opening
     * with everything selected means one stray keystroke destroys the message
     * you were trying to repair.
     */
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const trimmed = value.trim();
  const changed = trimmed.length > 0 && trimmed !== body.trim();

  const save = () => {
    if (!changed) return;
    onSave(trimmed);
  };

  return (
    <Overlay>
      <div
        className="fixed inset-0 z-500 flex items-center justify-center p-4"
        onPointerDown={onCancel}
      >
        <div className="absolute inset-0 bg-backdrop/[0.18] animate-fade-in" />

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit message"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
            /*
             * Enter saves, Shift+Enter breaks the line - the same contract as the
             * composer, because this is the same act. Learning one rule for
             * writing a message and a different one for fixing it is the kind of
             * inconsistency people notice without being able to name.
             */
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              save();
            }
          }}
          className={cn(
            'animate-panel-in relative w-full max-w-sm rounded-xl',
            'border border-line bg-surface p-4 shadow-lg',
          )}
        >
          <h2 className="text-h2 text-ink">Edit message</h2>
          <p className="mt-1 text-caption text-text-secondary">
            Everyone in the chat will see that it was edited.
          </p>

          <textarea
            ref={fieldRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={3}
            maxLength={4000}
            className={cn(
              'focus-ring mt-3 w-full resize-none rounded-lg',
              'border border-line bg-page px-3 py-2',
              'text-body text-ink placeholder:text-text-tertiary',
            )}
          />

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                'focus-ring rounded-full px-4 py-2 text-body',
                'text-text-secondary hover:bg-hover',
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!changed}
              className={cn(
                'focus-ring rounded-full bg-brand-gradient px-5 py-2',
                'text-body font-medium text-white shadow-brand',
                'transition-transform duration-instant active:scale-[0.97]',
                // Nothing to save is the resting state of this dialog, so the
                // button says so rather than failing when pressed.
                'disabled:opacity-50 disabled:active:scale-100',
              )}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
