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
  | 'loading';

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
