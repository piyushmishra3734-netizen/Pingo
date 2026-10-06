import { cn } from '@pingo/ui';
import { ChevronDown } from 'lucide-react';

/**
 * WhatsApp's "you are scrolled up" button: a round glass disc at the
 * bottom-right, just above the composer, with a brand badge counting the new
 * messages that arrived while you were away. Tap goes to the latest message.
 *
 * Always mounted, so leaving can animate as well as arriving - unmounting on
 * hide would make it blink out. Hidden, it is `inert`: no taps, no focus, and
 * screen readers skip it.
 *
 * The disc is `lq-glass-water lq-read` - the same surface as the typing bubble
 * across from it - so it reads as part of the thread, and on low-end phones
 * (`data-glass='0'`, no blur) that pair already carries a near-solid fill.
 */
export interface JumpToLatestButtonProps {
  visible: boolean;
  /** New foreign messages since the reader left the bottom. 0 hides the badge. */
  count: number;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function JumpToLatestButton({ visible, count, onClick, className, style }: JumpToLatestButtonProps) {
  const aria =
    count === 0
      ? 'Jump to latest message'
      : `${count === 1 ? '1 new message' : `${count > 99 ? '99+' : count} new messages`}, jump to latest`;

  return (
    <div
      inert={!visible}
      style={style}
      className={cn(
        // Springs in (overshoot), slips out (plain ease-in) - arriving should be
        // noticed, leaving should not. Tailwind v4 moves translate/scale onto their
        // own properties, so those are what transition, not `transform`.
        'transition-[opacity,translate,scale] duration-[420ms]',
        visible
          ? 'ease-[var(--ease-spring)] opacity-100'
          : 'pointer-events-none translate-y-3 scale-75 opacity-0 duration-200 ease-[var(--ease-exit)]',
        // Reduced motion: a fade only.
        'motion-reduce:translate-none motion-reduce:scale-100',
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={aria}
        className="lq-glass-water lq-read focus-ring relative grid size-10 place-items-center rounded-full"
      >
        <ChevronDown aria-hidden size={22} strokeWidth={2.25} />
        {count > 0 && (
          <span
            // Keyed on nothing: pops once when the first message lands, then the
            // number just changes - a bounce on every message would nag.
            aria-hidden
            className="absolute -top-1.5 -right-1 min-w-5 rounded-full bg-brand px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums text-on-brand shadow-sm motion-safe:animate-[lq-pop_0.42s_var(--ease-spring)_backwards]"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    </div>
  );
}
