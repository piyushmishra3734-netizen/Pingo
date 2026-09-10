import { useId } from 'react';

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
  // For the Mars gradient. Colons stripped: they break `url(#...)` references.
  const gid = useId().replace(/:/g, '');
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
        className={cn('block', className)}
        {...a11y}
      >
        {/* Moon yellow, with a darker rim so it holds its edge on a white page. */}
        <path
          fill="#F6C544"
          stroke="#D9981C"
          strokeWidth={1}
          strokeLinejoin="round"
          d="M20.6 14.4A8.6 8.6 0 0 1 9.6 3.4a8.6 8.6 0 1 0 11 11Z"
        />
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
        {/*
          Lit from the top left, so it reads as a ball rather than a red disc -
          the flat version looked like a warning light. One dust band and two
          craters are all the surface there is room for.
        */}
        <defs>
          <radialGradient id={`${gid}-mars`} cx="34%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#FF9A6B" />
            <stop offset="55%" stopColor="#E0583F" />
            <stop offset="100%" stopColor="#9B2B1D" />
          </radialGradient>
        </defs>
        <circle cx="12" cy="12" r="10" fill={`url(#${gid}-mars)`} />
        <path
          d="M3.6 11c2.6-1.1 5.3-.7 7.7.4 2.6 1.2 5.3 1.4 8.4.2"
          stroke="#B53A22"
          strokeWidth={1.7}
          strokeLinecap="round"
          fill="none"
          opacity={0.75}
        />
        <circle cx="15.6" cy="15.8" r="1.7" fill="#B53A22" opacity={0.8} />
        <circle cx="8.2" cy="15.4" r="1.1" fill="#B53A22" opacity={0.7} />
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
