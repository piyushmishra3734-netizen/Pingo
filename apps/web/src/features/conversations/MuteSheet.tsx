import { MUTE_DURATIONS } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useRef } from 'react';

import { useReturnFocus } from './focus-restore.js';

import { Overlay } from '../../components/Overlay.js';

/**
 * How long to mute for.
 *
 * A sheet rather than an immediate toggle, because "muted" is almost never
 * meant forever - it is "not for the next few hours", and a switch cannot say
 * that. The cost is one extra tap on an action nobody performs often.
 *
 * Unmuting skips this entirely: there is only one way to be unmuted, so asking
 * would be a question with a single answer.
 */

export interface MuteSheetProps {
  count: number;
  onCancel: () => void;
  /** `Infinity` for always. */
  onChoose: (durationMs: number) => void;
}

export function MuteSheet({ count, onCancel, onChoose }: MuteSheetProps) {
  useReturnFocus();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return (
    <Overlay onDismiss={onCancel}>
      <div
        className="fixed inset-0 z-500 flex items-end justify-center sm:items-center"
        onPointerDown={onCancel}
      >
        <div className="absolute inset-0 bg-backdrop/[0.18] animate-fade-in" />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="mute-title"
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'animate-panel-in relative w-full max-w-sm outline-none',
            'rounded-t-xl border border-line bg-surface p-4 shadow-lg',
            'pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-xl sm:pb-4',
          )}
        >
          <h2 id="mute-title" className="text-h2 text-ink">
            Mute {count === 1 ? 'this chat' : `${count} chats`}
          </h2>
          <p className="mt-1.5 text-caption text-text-secondary">
            You'll still see new messages in the list, they just won't notify you.
          </p>

          <div className="mt-4 flex flex-col gap-1.5">
            {MUTE_DURATIONS.map(({ label, ms }) => (
              <button
                key={label}
                type="button"
                onClick={() => onChoose(ms)}
                className={cn(
                  // 44px minimum target, which py-3 on body text clears.
                  'focus-ring w-full rounded-lg px-4 py-3 text-left text-body text-ink',
                  'transition-colors duration-instant hover:bg-hover active:bg-pressed',
                )}
              >
                {label}
              </button>
            ))}

            <button
              type="button"
              onClick={onCancel}
              className={cn(
                'focus-ring mt-1 w-full rounded-full px-5 py-3 text-body',
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
