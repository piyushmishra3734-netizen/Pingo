import { cn } from '@pingo/ui';
import { useRef, useState } from 'react';

/**
 * The six-emoji bar that appears above a held message.
 *
 * docs/13 § 2 - it grows from the message anchor with the same motion as the
 * action list, because they are two halves of one gesture rather than two
 * separate surfaces that happen to appear together.
 *
 * ## Six, and the sixth is always `➕`
 *
 * Five is what people actually reach for; the sixth slot is the door to
 * everything else. Fixing `➕` in last position means the five that matter never
 * move, which is the whole argument for a quick bar over a picker.
 */

/** docs/13 § 3. `➕` is not in this list - it is the button after it. */
const QUICK: { emoji: string; label: string }[] = [
  { emoji: '❤️', label: 'React with heart' },
  { emoji: '👍', label: 'React with thumbs up' },
  { emoji: '😂', label: 'React with laughing face' },
  { emoji: '😮', label: 'React with surprised face' },
  { emoji: '😢', label: 'React with crying face' },
];

export interface ReactionBarProps {
  /** The viewer's current reaction, so the bar can show what is already chosen. */
  mine?: string;
  onReact: (emoji: string) => void;
  onOpenPicker: () => void;
}

export function ReactionBar({ mine, onReact, onOpenPicker }: ReactionBarProps) {
  const listRef = useRef<HTMLDivElement>(null);
  /** Which emoji is mid-press, so only that one scales. */
  const [pressed, setPressed] = useState<string>();

  /*
   * Horizontal arrows move between reactions. A row of buttons that only
   * responds to Tab makes a keyboard user walk through every one to leave it,
   * and this row is meant to be crossed quickly.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();

    const buttons = [...(listRef.current?.querySelectorAll('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(index + step + buttons.length) % buttons.length];
    next?.focus();
  };

  const react = (emoji: string) => {
    setPressed(emoji);
    // Settles back rather than bouncing. docs/13 § 3 - a bounce reads as a
    // celebration, and reacting is a small, frequent act.
    window.setTimeout(() => setPressed(undefined), 160);
    onReact(emoji);
  };

  return (
    <div
      ref={listRef}
      role="group"
      aria-label="Quick reactions"
      onKeyDown={onKeyDown}
      className={cn(
        'bg-surface border border-line flex items-center gap-1 rounded-full p-1.5 shadow-lg',
      )}
    >
      {QUICK.map(({ emoji, label }) => (
        <button
          key={emoji}
          type="button"
          aria-label={label}
          aria-pressed={mine === emoji}
          onClick={() => react(emoji)}
          className={cn(
            'focus-ring grid size-10 place-items-center rounded-full text-[1.35rem]',
            'transition-transform duration-instant ease-standard',
            // 1.1×, settling back. Only the one being pressed moves.
            pressed === emoji ? 'scale-110' : 'scale-100',
            // What you already chose stays marked, so tapping it again reads
            // as removal rather than as a repeat.
            mine === emoji && 'bg-selected',
          )}
        >
          {emoji}
        </button>
      ))}

      <button
        type="button"
        aria-label="Choose another reaction"
        onClick={onOpenPicker}
        className={cn(
          'focus-ring grid size-10 place-items-center rounded-full',
          'text-body text-text-secondary',
          'transition-transform duration-instant ease-standard active:scale-110',
        )}
      >
        ➕
      </button>
    </div>
  );
}
