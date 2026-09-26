import { cn } from '@pingo/ui';
import { Plus } from 'lucide-react';
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
        'lq-glass-water lq-menu flex items-center gap-0.5 rounded-full px-1.5 py-[5px]',
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
            'focus-ring grid size-[42px] place-items-center rounded-full text-[26px]',
            'transition-transform duration-[250ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]',
            'hover:-translate-y-[5px] hover:scale-[1.3] active:-translate-y-[5px] active:scale-[1.3]',
            pressed === emoji && '-translate-y-[5px] scale-[1.3]',
            // What you already chose stays marked, so tapping it again reads as removal.
            mine === emoji && 'bg-hover',
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
          'focus-ring grid size-[42px] place-items-center rounded-full',
          'text-text-secondary',
          'transition-transform duration-instant ease-standard active:scale-110',
        )}
      >
        <Plus size={20} aria-hidden />
      </button>
    </div>
  );
}
