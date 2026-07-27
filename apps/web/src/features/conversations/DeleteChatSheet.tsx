import { cn } from '@pingo/ui';
import { useEffect, useRef } from 'react';

import { useReturnFocus } from './focus-restore.js';

import { Overlay } from '../../components/Overlay.js';

/**
 * The confirmation for deleting chats.
 *
 * A bottom sheet rather than a centred dialog because this is reached by thumb,
 * from a list, on a phone — and the confirming tap should land near where the
 * finger already is. On a wide screen it centres, since a sheet pinned to the
 * bottom of a desktop window is a long way from anything.
 *
 * ## Why "Delete for everyone" is absent rather than disabled
 *
 * There is no such thing for a whole conversation, in this product or any other
 * — you can unsend a message, not un-have a conversation. docs/13 § 3: hide what
 * was never yours. A greyed-out row here would invent a capability and then
 * refuse it, which is worse than never mentioning it.
 *
 * ## What deleting actually does
 *
 * The sheet says so, because "Delete" reads as permanent and this is not: the
 * chat leaves your list and its history goes with it, the other person keeps
 * their copy, and a new message brings the chat back empty. Somebody deleting a
 * conversation to be rid of it deserves to know it can reappear.
 */

export interface DeleteChatSheetProps {
  /** How many chats are going. Drives the wording; there is no "1 chats". */
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteChatSheet({ count, onCancel, onConfirm }: DeleteChatSheetProps) {
  useReturnFocus();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    /*
     * The panel takes focus, never the Delete button — a destructive action
     * pre-focused is one stray Enter away from happening. The user aims.
     */
    panelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  const subject = count === 1 ? 'this chat' : `these ${count} chats`;

  return (
    <Overlay>
      <div
        className="fixed inset-0 z-500 flex items-end justify-center sm:items-center"
        onPointerDown={onCancel}
      >
        <div className="absolute inset-0 bg-ink/[0.18] animate-fade-in" />

        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-chat-title"
          aria-describedby="delete-chat-body"
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'animate-panel-in relative w-full max-w-sm outline-none',
            'rounded-t-xl border border-line bg-surface p-4 shadow-lg',
            'pb-[max(1rem,env(safe-area-inset-bottom))]',
            'sm:rounded-xl sm:pb-4',
          )}
        >
          <h2 id="delete-chat-title" className="text-h2 text-ink">
            Delete {subject}?
          </h2>
          <p id="delete-chat-body" className="mt-1.5 text-caption text-text-secondary">
            The messages will be removed from your device. Everyone else keeps
            their copy, and the chat comes back if someone writes again.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className={cn(
                'focus-ring w-full rounded-full bg-danger px-5 py-3',
                'text-body font-medium text-white',
                'transition-transform duration-instant active:scale-[0.98]',
              )}
            >
              Delete for me
            </button>

            <button
              type="button"
              onClick={onCancel}
              className={cn(
                'focus-ring w-full rounded-full px-5 py-3 text-body',
                'text-text-secondary hover:bg-hover',
              )}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
