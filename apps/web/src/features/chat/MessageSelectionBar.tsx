import type { Message } from '@pingo/core';
import { CloseIcon, IconButton, TrashIcon, cn } from '@pingo/ui';

import { useT } from '../i18n/useT.js';

/**
 * What the thread header becomes while messages are selected.
 *
 * ## Why this exists
 *
 * The menu acts on one message. Clearing twenty of them meant opening it twenty
 * times and confirming twenty times, which is not a slow way to do the job so
 * much as a reason not to do it - so a chat that had got out of hand stayed
 * that way.
 *
 * ## In place, not on top
 *
 * It replaces the header rather than sliding in over it, the same as the chat
 * list's bar. You are in the same conversation doing something to part of it,
 * and a new layer would say you had gone somewhere.
 *
 * ## What is offered, and what is not
 *
 * Copy and Delete. Those are the two reasons anybody selects several messages
 * at once - saving a conversation out, or clearing it. Forwarding several at
 * once is a real want and deliberately absent for now: it needs a recipient
 * picker and an answer for what a forwarded photo means, and half of it would
 * be worse than none.
 *
 * Delete for everyone appears only when every selected message is one you sent
 * and still within the window the service allows. A mixed selection gets the
 * one action that can actually apply to all of it, rather than a button that
 * would half work.
 */

export interface MessageSelectionBarProps {
  selected: Message[];
  mine: (message: Message) => boolean;
  onCancel: () => void;
  onCopy: () => void;
  onDelete: (forEveryone: boolean) => void;
}

export function MessageSelectionBar({
  selected,
  mine,
  onCancel,
  onCopy,
  onDelete,
}: MessageSelectionBarProps) {
  const t = useT();
  const count = selected.length;
  const allMine = count > 0 && selected.every(mine);

  /*
   * Copy is pointless on a selection with nothing to copy - a run of photos and
   * voice notes has no text - so it is hidden rather than offered as a button
   * that produces an empty clipboard.
   */
  const anyText = selected.some((message) => message.body.trim().length > 0);

  return (
    <div className="flex items-center gap-1 px-1">
      <IconButton label={t('select.cancel')} onClick={onCancel}>
        <CloseIcon size={20} />
      </IconButton>

      <span className="flex-1 px-1 text-body font-medium text-ink" aria-live="polite">
        {t('select.nSelected', { n: count })}
      </span>

      {anyText && (
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            'focus-ring rounded-full px-3 py-1.5 text-caption font-medium text-ink',
            'transition-colors duration-instant hover:bg-hover',
          )}
        >
          {t('select.copy')}
        </button>
      )}

      {allMine && (
        <button
          type="button"
          onClick={() => onDelete(true)}
          className={cn(
            'focus-ring rounded-full px-3 py-1.5 text-caption font-medium',
            'text-danger transition-colors duration-instant hover:bg-danger-soft',
          )}
        >
          {t('select.deleteEveryone')}
        </button>
      )}

      {/* Last, and an icon, because it is the destructive one you reach for. */}
      <IconButton label={t('select.deleteMe')} onClick={() => onDelete(false)}>
        <TrashIcon size={19} />
      </IconButton>
    </div>
  );
}
