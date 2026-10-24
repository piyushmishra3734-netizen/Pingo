import { cn } from '@pingo/ui';
import { Music2 } from 'lucide-react';

import type { Note } from './notes.js';

/**
 * A note over a circle in the tray: a small speech bubble with its tail pointing
 * down at the face. One or two lines of words, and a song shows as a note glyph
 * with its name. `mine` with nothing written is the invitation instead: a
 * dashed bubble that reads "Note…".
 */

/** The height every circle reserves for its bubble, so faces stay on one line. */
export const NOTE_SLOT = 40;

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
    <span className="relative flex w-full justify-center" style={{ height: NOTE_SLOT }}>
      <button
        type="button"
        onClick={onClick}
        aria-label={note ? (mine ? `Your note: ${note.body}. Tap to change.` : `${note.name}'s note: ${note.body}`) : 'Add a note'}
        className={cn(
          'focus-ring absolute bottom-[7px] left-1/2 max-w-[92px] min-w-[44px] -translate-x-1/2 rounded-[14px] px-2 py-[3px] text-left',
          'text-[10.5px] leading-[1.25] transition-transform duration-150 active:scale-95',
          note
            ? 'bg-surface text-ink shadow-[0_2px_10px_-3px_rgb(16_17_20/0.28)] ring-1 ring-line'
            : 'border border-dashed border-text-tertiary/60 bg-page/80 text-text-tertiary',
        )}
      >
        {note ? (
          <>
            {note.song && (
              <span className="flex items-center gap-0.5 font-semibold text-brand">
                <Music2 size={10} className="shrink-0" />
                <span className="truncate">{note.song.name}</span>
              </span>
            )}
            {note.body && <span className="line-clamp-2 break-words">{note.body}</span>}
          </>
        ) : (
          <span>Note…</span>
        )}
        {/* The tail: two dots, the bubble's own thought-cloud. */}
        <span
          aria-hidden
          className={cn(
            'absolute -bottom-[4px] left-1/2 size-[6px] -translate-x-1/2 rounded-full',
            note ? 'bg-surface ring-1 ring-line' : 'border border-dashed border-text-tertiary/60 bg-page',
          )}
        />
      </button>
    </span>
  );
}
