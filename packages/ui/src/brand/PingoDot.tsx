import { cn } from '../utils/cn.js';

/**
 * The brand dot - PINGO's live mark, used on its own.
 *
 * Online indicator, typing, loading, badge and status all share this component
 * so the mark stays consistent across avatars, list rows and headers.
 */

export type DotState =
  /** Present but inert - a static mark. */
  | 'idle'
  /** A slow breath. Never a blink: blinking demands attention. */
  | 'online'
  /** Three dots lifting in sequence. */
  | 'typing'
  /** A steady pulse with a soft halo, for live recording. */
  | 'recording'
  /** Three dots cycling, used while waiting. */
  | 'loading'
  /** A crescent moon: here, and choosing not to say so. Shown only to its owner. */
  | 'invisible'
  /** A small red Mars: do not disturb. Shown only to its owner. */
  | 'dnd';

export interface PingoDotProps {
  state?: DotState;
  /** Diameter in px of a single dot. */
  size?: number;
  className?: string;
  /** Announced to assistive tech; without it the dot is decorative. */
  label?: string;
}

/**
 * Sequencing offsets for the three-dot states. Negative delays start the
 * animation mid-cycle, so the group is already in motion on first paint rather
 * than beginning with an awkward pause.
 */
const SEQUENCE_DELAYS = ['-400ms', '-200ms', '0ms'] as const;

export function PingoDot({
  state = 'idle',
  size = 8,
  className,
  label,
}: PingoDotProps) {
  const a11y = label
    ? { role: 'status' as const, 'aria-label': label }
    : { 'aria-hidden': true as const };

  // Multi-dot states render a row; the gap scales with the dot so the group
  // stays proportional at any size.
  if (state === 'typing' || state === 'loading') {
    return (
      <span
        className={cn('inline-flex items-center', className)}
        style={{ gap: size * 0.5 }}
        {...a11y}
      >
        {SEQUENCE_DELAYS.map((delay) => (
          <span
            key={delay}
            className={cn(
              'block rounded-full bg-dot',
              state === 'typing' ? 'animate-dot-typing' : 'animate-dot-pulse',
            )}
            style={{ width: size, height: size, animationDelay: delay }}
          />
        ))}
      </span>
    );
  }

  if (state === 'recording') {
    return (
      <span
        className={cn('relative inline-flex items-center justify-center', className)}
        style={{ width: size * 2, height: size * 2 }}
        {...a11y}
      >
        {/* The halo carries the motion so the dot itself stays a solid, legible mark. */}
        <span
          className="absolute inset-0 rounded-full bg-dot/25 animate-dot-pulse"
          aria-hidden
        />
        <span
          className="relative block rounded-full bg-dot"
          style={{ width: size, height: size }}
        />
      </span>
    );
  }

  /*
   * The two statuses that are not "here". Drawn a little larger than the dot
   * because a shape needs more pixels than a disc to be recognised: at the
   * dot's own nine pixels a crescent is a smudge.
   */
  if (state === 'invisible') {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size * 1.35}
        height={size * 1.35}
        className={cn('block text-text-tertiary', className)}
        {...a11y}
      >
        <path fill="currentColor" d="M20.6 14.4A8.6 8.6 0 0 1 9.6 3.4a8.6 8.6 0 1 0 11 11Z" />
      </svg>
    );
  }

  if (state === 'dnd') {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size * 1.35}
        height={size * 1.35}
        className={cn('block', className)}
        {...a11y}
      >
        <circle cx="12" cy="12" r="10" fill="#E0533D" />
        <ellipse cx="8.4" cy="9" rx="2.6" ry="1.8" fill="#A8321F" />
        <ellipse cx="15.2" cy="15.6" rx="3.1" ry="2" fill="#A8321F" />
        <circle cx="16.2" cy="7.4" r="1.2" fill="#A8321F" />
      </svg>
    );
  }

  return (
    <span
      className={cn(
        'inline-block rounded-full bg-dot',
        state === 'online' && 'animate-dot-pulse',
        className,
      )}
      style={{ width: size, height: size }}
      {...a11y}
    />
  );
}
