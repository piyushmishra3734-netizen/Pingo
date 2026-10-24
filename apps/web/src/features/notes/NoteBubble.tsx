import { cn } from '@pingo/ui';
import { Music2 } from 'lucide-react';

import type { Note } from './notes.js';

/**
 * A note over a circle in the tray, drawn the way Instagram draws it: a
 * rounded bubble that rests on the top edge of the face with a small dot for a
 * tail, up to two lines of words, and a song as
 * a note glyph with its name. With nothing written, yours is the same bubble
 * saying "Note...", so the invitation looks like the thing it makes.
 */

/** The height every circle reserves above it, so faces stay on one line. */
export const NOTE_SLOT = 50;

/** Circles that carry a note get a wider column than the 74px of a plain one, so bubbles have room. */
export const NOTE_COL = 92;

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
          // Fits the wider note column (NOTE_COL), so neighbours never touch.
          'focus-ring absolute bottom-[-9px] left-1/2 w-max max-w-[88px] min-w-[56px] -translate-x-1/2 rounded-[20px] px-3 py-[7px] text-center',
          'text-[11.5px] leading-[1.25] transition-transform duration-150 active:scale-95',
          'bg-surface shadow-[0_1px_7px_rgb(16_17_20/0.24)]',
          note ? 'text-ink' : 'text-text-tertiary',
        )}
      >
        {note ? (
          <>
            {note.song && (
              <span className="flex items-center justify-center gap-0.5 text-text-secondary">
                <Music2 size={10} className="shrink-0" />
                <span className="truncate">{note.song.name}</span>
              </span>
            )}
            {note.body && <span className={cn('break-words', note.song ? 'line-clamp-2' : 'line-clamp-3')}>{note.body}</span>}
          </>
        ) : (
          <span>Note...</span>
        )}
        {/* Instagram's tail: a dot, and a smaller one trailing off the lower left. */}
        <span aria-hidden className="absolute -bottom-[4px] left-[14px] size-[8px] rounded-full bg-surface shadow-[0_1px_3px_rgb(16_17_20/0.2)]" />
        <span aria-hidden className="absolute -bottom-[10px] left-[8px] size-[4px] rounded-full bg-surface shadow-[0_1px_3px_rgb(16_17_20/0.2)]" />
      </button>
    </span>
  );
}
