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
export const NOTE_SLOT = 40;

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
  // Nothing to show: the space is kept so every face sits on one line. A note is started from the story `+`.
  if (!note) return <span aria-hidden style={{ height: NOTE_SLOT }} className="block" />;

  return (
    // Above the ring (z-10): the bubble overlaps the face's top edge, as on Instagram.
    <span className="relative z-10 flex w-full justify-center" style={{ height: NOTE_SLOT }}>
      <button
        type="button"
        onClick={onClick}
        aria-label={mine ? `Your note: ${note.body}. Tap to change.` : `${note.name}'s note: ${note.body}`}
        className={cn(
          // Wider than the face, never wider than its column (NOTE_COL), so neighbours never touch.
          'focus-ring absolute bottom-[-3px] left-1/2 w-max max-w-[90px] min-w-[52px] -translate-x-1/2 rounded-[22px] px-3 py-[7px] text-center',
          'font-note text-[11px] leading-[1.22] font-semibold text-ink transition-transform duration-150 active:scale-95',
          'bg-surface shadow-[0_1px_8px_rgb(16_17_20/0.24)]',
        )}
      >
        {note.song && (
          <span className="flex items-center justify-center gap-0.5 text-text-secondary">
            <Music2 size={10} className="shrink-0" />
            <span className="truncate">{note.song.name}</span>
          </span>
        )}
        {note.body && <span className={cn('break-words', note.song ? 'line-clamp-1' : 'line-clamp-2')}>{note.body}</span>}
        {/* Instagram's tail: a rounded nub on the underside of the bubble, and one small dot below it, toward the face. */}
        <svg aria-hidden viewBox="0 0 20 6" className="absolute -bottom-[5px] left-[58%] h-[6px] w-[20px] text-surface drop-shadow-[0_2px_2px_rgb(16_17_20/0.1)]">
          <path d="M0 0 C4 0 5 6 10 6 C15 6 16 0 20 0 Z" fill="currentColor" />
        </svg>
        <span aria-hidden className="absolute -bottom-[13px] left-[52%] size-[5px] rounded-full bg-surface shadow-[0_1px_3px_rgb(16_17_20/0.22)]" />
      </button>
    </span>
  );
}
