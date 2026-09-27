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
 * Five is what people actually reach for - your five most used, see `quick` -
 * and the sixth slot is the door to every emoji.
 */

/** docs/13 § 3. `➕` is not in this list - it is the button after it. */
const QUICK: { emoji: string; label: string }[] = [
  { emoji: '❤️', label: 'React with heart' },
  { emoji: '👍', label: 'React with thumbs up' },
  { emoji: '😂', label: 'React with laughing face' },
  { emoji: '😮', label: 'React with surprised face' },
  { emoji: '😢', label: 'React with crying face' },
];

/*
 * The five in the bar are the five you use most.
 *
 * Counted per device, in localStorage, from every reaction you add - the bar
 * or the picker. Until something has been used the defaults hold their places,
 * and a new favourite only moves in once it has been used more than one of them.
 */
const USE_KEY = 'pingo.reactionUse';

function uses(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(USE_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function noteReaction(emoji: string): void {
  try {
    const counts = uses();
    counts[emoji] = (counts[emoji] ?? 0) + 1;
    localStorage.setItem(USE_KEY, JSON.stringify(counts));
  } catch {
    // Private mode: the bar just keeps its defaults.
  }
}

function quick(): { emoji: string; label: string }[] {
  const counts = uses();
  const all = [...new Set([...Object.keys(counts), ...QUICK.map((q) => q.emoji)])];
  // Stable sort: ties keep the defaults' order.
  const top = all
    .map((emoji, i) => ({ emoji, n: counts[emoji] ?? 0, i: QUICK.findIndex((q) => q.emoji === emoji) }))
    .sort((a, b) => b.n - a.n || (a.i < 0 ? 99 : a.i) - (b.i < 0 ? 99 : b.i))
    .slice(0, 5);
  return top.map(({ emoji }) => QUICK.find((q) => q.emoji === emoji) ?? { emoji, label: `React with ${emoji}` });
}

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
  const [row] = useState(quick);

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
      {row.map(({ emoji, label }) => (
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
