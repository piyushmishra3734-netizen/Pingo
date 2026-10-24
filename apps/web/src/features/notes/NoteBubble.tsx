import { cn } from '@pingo/ui';
import { Music2 } from 'lucide-react';

import type { Note } from './notes.js';

/**
 * A note over a circle in the tray, drawn the way Instagram draws it: a
 * rounded bubble that sits across the top edge of the face, a small tail of two
 * dots trailing off its lower left, up to three lines of words, and a song as
 * a note glyph with its name. With nothing written, yours is the same bubble
 * saying "Note...", so the invitation looks like the thing it makes.
 */

/** The height every circle reserves above it, so faces stay on one line. */
export const NOTE_SLOT = 46;

export function NoteBubble({
  note,
  mine = false,
  onClick,
}: {
  note: Note | undefined;
  mine?: boolean;
  onClick: () => void;
}) {
  if (!note && !mine) return <span aria-hidden style={{ height: NOTE_SLOT }} className="block" />;

  return (
    // Above the ring (z-10): the bubble overlaps the face's top edge, as on Instagram.
    <span className="relative z-10 flex w-full justify-center" style={{ height: NOTE_SLOT }}>
      <button
        type="button"
        onClick={onClick}
        aria-label={note ? (mine ? `Your note: ${note.body}. Tap to change.` : `${note.name}'s note: ${note.body}`) : 'Add a note'}
        className={cn(
          'focus-ring absolute bottom-[-8px] left-1/2 w-max max-w-[96px] min-w-[52px] -translate-x-1/2 rounded-[18px] px-2.5 py-[6px] text-center',
          'text-[11.5px] leading-[1.22] transition-transform duration-150 active:scale-95',
          'bg-surface shadow-[0_1px_6px_rgb(16_17_20/0.22)]',
          note ? 'text-ink' : 'text-text-tertiary',
        )}
      >
        {note ? (
          <>
            {note.song && (
              <span className="mb-px flex items-center justify-center gap-0.5 text-text-secondary">
                <Music2 size={10} className="shrink-0" />
                <span className="truncate">{note.song.name}</span>
              </span>
            )}
            {note.body && <span className="line-clamp-3 break-words">{note.body}</span>}
          </>
        ) : (
          <span>Note...</span>
        )}
        {/* The tail: a larger dot and a smaller one, trailing down and to the left. */}
        <span aria-hidden className="absolute -bottom-[3px] left-[11px] size-[7px] rounded-full bg-surface shadow-[0_1px_3px_rgb(16_17_20/0.2)]" />
        <span aria-hidden className="absolute -bottom-[8px] left-[5px] size-[4px] rounded-full bg-surface shadow-[0_1px_3px_rgb(16_17_20/0.2)]" />
      </button>
    </span>
  );
}
