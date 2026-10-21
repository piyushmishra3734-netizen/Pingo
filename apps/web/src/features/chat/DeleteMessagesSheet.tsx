import { cn } from '@pingo/ui';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { useReturnFocus } from '../conversations/focus-restore.js';

/**
 * Deleting messages, Telegram's way: one Delete, and a box that says whether
 * the other person loses them too.
 *
 * "Also delete for Rohit" is unticked to begin with, so the plain tap is the
 * gentle one and reaching into the other person's side is a choice made on
 * purpose. It only appears where that is allowed: a one to one chat. Everywhere
 * else the sheet is just a confirmation.
 */
export interface DeleteMessagesSheetProps {
  count: number;
  /** The other person's name, for "Also delete for ...". */
  name?: string;
  /** Whether deleting for the other person is on offer at all. */
  canEveryone: boolean;
  onCancel: () => void;
  onConfirm: (forEveryone: boolean) => void;
}

export function DeleteMessagesSheet({ count, name, canEveryone, onCancel, onConfirm }: DeleteMessagesSheetProps) {
  useReturnFocus();
  const panelRef = useRef<HTMLDivElement>(null);
  const [both, setBoth] = useState(false);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const first = (name ?? '').split(' ')[0] || 'them';

  return (
    <Overlay onDismiss={onCancel}>
      <div className="fixed inset-0 z-500 flex items-end justify-center sm:items-center" onPointerDown={onCancel}>
        <div className="absolute inset-0 bg-backdrop/[0.18] animate-fade-in" />
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-messages-title"
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'animate-panel-in relative w-full max-w-sm outline-none',
            'rounded-t-xl border border-line bg-surface p-4 shadow-lg',
            'pb-[max(1rem,env(safe-area-inset-bottom))]',
            'sm:rounded-xl sm:pb-4',
          )}
        >
          <h2 id="delete-messages-title" className="text-h2 text-ink">
            {count === 1 ? 'Delete message?' : `Delete ${count} messages?`}
          </h2>

          {canEveryone && (
            <button
              type="button"
              role="checkbox"
              aria-checked={both}
              onClick={() => setBoth((v) => !v)}
              className="focus-ring mt-3 flex w-full items-center gap-3 rounded-lg py-2 text-left text-body text-ink"
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-[5px] border transition-colors',
                  both ? 'border-danger bg-danger text-white' : 'border-text-tertiary',
                )}
              >
                {both && <Check size={14} strokeWidth={3} />}
              </span>
              <span>Also delete for {first}</span>
            </button>
          )}

          <div className="mt-3 flex items-center justify-end gap-1">
            <button type="button" onClick={onCancel} className="focus-ring rounded-full px-4 py-2 text-body font-medium text-brand hover:bg-hover">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(canEveryone && both)}
              className="focus-ring rounded-full px-4 py-2 text-body font-medium text-danger hover:bg-danger-soft"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
