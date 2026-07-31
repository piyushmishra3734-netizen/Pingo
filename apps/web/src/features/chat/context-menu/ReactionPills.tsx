import type { Reaction, UserId } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * Reactions as they sit under a message.
 *
 * One pill per emoji, count beside it, yours marked. Tapping your own removes
 * it; tapping another swaps - the same rule as the bar, so the two surfaces
 * never disagree about what a tap means.
 *
 * ## Why a pill lingers after it hits zero
 *
 * The service drops an emptied group immediately, which is correct for the
 * data and wrong for the eye: the pill would vanish between frames. This keeps
 * a departing pill for one animation, then lets it go. docs/13 § 3.
 *
 * ## Counts animate only when they change
 *
 * Re-rendering for an unrelated reason must not make every number jump. The
 * previous count is remembered per emoji, and the transition runs only where
 * the two differ.
 */

/** Long enough to see, short enough not to hold up the next tap. */
const EXIT_MS = 160;

export interface ReactionPillsProps {
  reactions: Reaction[];
  me: UserId | undefined;
  onToggle: (emoji: string) => void;
  /** Set while a toggle is in flight, so repeated taps cannot stack up. */
  busy?: boolean;
  className?: string;
}

export function ReactionPills({
  reactions,
  me,
  onToggle,
  busy,
  className,
}: ReactionPillsProps) {
  /** Emoji that have just gone, kept for one animation. */
  const [leaving, setLeaving] = useState<Reaction[]>([]);
  const previous = useRef<Reaction[]>(reactions);

  useEffect(() => {
    const gone = previous.current.filter(
      (was) => !reactions.some((now) => now.emoji === was.emoji),
    );
    previous.current = reactions;
    if (gone.length === 0) return;

    setLeaving(gone);
    const timer = window.setTimeout(() => setLeaving([]), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [reactions]);

  if (reactions.length === 0 && leaving.length === 0) return null;

  return (
    <div className={cn('mt-1 flex flex-wrap items-center gap-1', className)}>
      {reactions.map((reaction) => (
        <Pill
          key={reaction.emoji}
          reaction={reaction}
          mine={Boolean(me && reaction.userIds.includes(me))}
          busy={busy}
          onClick={() => onToggle(reaction.emoji)}
        />
      ))}

      {/* On their way out: no longer interactive, just fading. */}
      {leaving.map((reaction) => (
        <Pill key={`leaving-${reaction.emoji}`} reaction={reaction} mine={false} leaving />
      ))}
    </div>
  );
}

function Pill({
  reaction,
  mine,
  busy,
  leaving,
  onClick,
}: {
  reaction: Reaction;
  mine: boolean;
  busy?: boolean;
  leaving?: boolean;
  onClick?: () => void;
}) {
  const count = reaction.userIds.length;
  const [changed, setChanged] = useState(false);
  const lastCount = useRef(count);

  useEffect(() => {
    if (lastCount.current === count) return;
    lastCount.current = count;
    setChanged(true);
    const timer = window.setTimeout(() => setChanged(false), 160);
    return () => window.clearTimeout(timer);
  }, [count]);

  return (
    <button
      type="button"
      disabled={busy || leaving}
      onClick={onClick}
      aria-label={`${reaction.emoji}, ${count} ${count === 1 ? 'reaction' : 'reactions'}${
        mine ? ', including yours' : ''
      }`}
      aria-pressed={mine}
      className={cn(
        'focus-ring flex items-center gap-1 rounded-full px-2 py-0.5',
        // Springs in on arrival. Only when it is genuinely new: a pill that is
        // merely re-rendering must not re-announce itself.
        !leaving && 'motion-safe:animate-react-in',
        'text-caption transition-all duration-quick ease-standard',
        mine ? 'bg-selected text-brand' : 'bg-sunken text-text-secondary',
        leaving ? 'scale-90 opacity-0' : 'scale-100 opacity-100',
        busy && 'opacity-60',
      )}
    >
      <span className="text-[0.95rem] leading-none">{reaction.emoji}</span>
      {/* Only a real change animates; an unrelated render leaves it still. */}
      <span
        className={cn(
          'tabular-nums transition-transform duration-instant',
          changed && 'scale-110',
        )}
      >
        {count}
      </span>
    </button>
  );
}
