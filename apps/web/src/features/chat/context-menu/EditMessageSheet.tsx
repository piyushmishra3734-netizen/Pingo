import { cn } from '@pingo/ui';
import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Overlay } from '../../../components/Overlay.js';

/**
 * Editing a sent message, the iPhone way.
 *
 * The chat behind blurs and dims, as it does under the hold menu, and the
 * message itself becomes the field - still a bubble, still yours - with a
 * cross to leave and a tick to save either side of it, sitting just above the
 * keyboard. A card with a text box and two buttons was a form about a message;
 * this is the message.
 *
 * Held still: nothing arriving in the chat (a read receipt, somebody typing)
 * moves or closes it. It is its own layer, not something riding the thread.
 */

export interface EditMessageSheetProps {
  body: string;
  onCancel: () => void;
  onSave: (next: string) => void;
}

export function EditMessageSheet({ body, onCancel, onSave }: EditMessageSheetProps) {
  const [value, setValue] = useState(body);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, window.innerHeight * 0.4)}px`;
  };

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    grow();
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const trimmed = value.trim();
  const changed = trimmed.length > 0 && trimmed !== body.trim();
  const save = () => {
    if (changed) onSave(trimmed);
  };

  return (
    <Overlay onDismiss={onCancel}>
      <div className="fixed inset-x-0 top-0 z-500 flex flex-col justify-end" style={{ height: 'var(--app-height, 100dvh)' }}>
        <div className="lq-dim animate-fade-in absolute inset-0" onPointerDown={onCancel} />

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit message"
          className="animate-panel-in relative flex flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              save();
            }
          }}
        >
          <p className="self-center rounded-full bg-black/40 px-3 py-1 text-[12px] font-medium text-white backdrop-blur-md">
            Editing · everyone will see it was edited
          </p>
          <div className="flex items-end gap-2">
            <button
              type="button"
              aria-label="Cancel editing"
              onClick={onCancel}
              className="lq-glass-water grid size-10 shrink-0 place-items-center rounded-full text-ink active:scale-90"
            >
              <X size={20} />
            </button>
            <textarea
              ref={fieldRef}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                grow();
              }}
              rows={1}
              maxLength={4000}
              aria-label="Message"
              className={cn(
                'lq-brand-glass-water min-h-[42px] min-w-0 flex-1 resize-none rounded-[20px] px-4 py-2.5',
                'text-body text-on-brand outline-none placeholder:text-white/60',
              )}
            />
            <button
              type="button"
              aria-label="Save edit"
              onClick={save}
              disabled={!changed}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-[#0a84ff] text-white transition-opacity active:scale-90 disabled:opacity-40"
            >
              <Check size={20} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
