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
export const NOTE_SLOT = 44;

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
          // Never wider than its own column, so neighbours cannot touch.
          'focus-ring absolute bottom-[-4px] left-1/2 w-max max-w-[72px] min-w-[44px] -translate-x-1/2 rounded-[14px] px-2 py-[5px] text-center',
          'text-[10.5px] leading-[1.25] font-medium transition-transform duration-150 active:scale-95',
          'bg-surface ring-1 ring-line shadow-[0_3px_10px_-4px_rgb(16_17_20/0.25)]',
          note ? 'text-ink' : 'text-text-tertiary',
        )}
      >
        {note ? (
          <>
            {note.song && (
              <span className="flex items-center justify-center gap-0.5 text-brand">
                <Music2 size={9} className="shrink-0" />
                <span className="truncate">{note.song.name}</span>
              </span>
            )}
            {note.body && <span className="line-clamp-2 break-words">{note.body}</span>}
          </>
        ) : (
          <span>Note...</span>
        )}
        {/* A single quiet dot for the tail. */}
        <span aria-hidden className="absolute -bottom-[4px] left-1/2 size-[6px] -translate-x-1/2 rounded-full bg-surface ring-1 ring-line" />
      </button>
    </span>
  );
}
