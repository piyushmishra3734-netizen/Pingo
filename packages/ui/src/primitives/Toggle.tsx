import { useId } from 'react';

import { cn } from '../utils/cn.js';

/**
 * Toggle - the switch from the board, in its on and off states.
 *
 * Built on a real `<button role="switch">` rather than a styled checkbox, which
 * gives correct semantics without fighting native rendering. The knob moves with
 * a transform, so the animation runs on the compositor and stays smooth on a
 * settings screen full of them.
 *
 * The off state is a neutral track, not a red or hollow one: "off" is a valid
 * resting state, not a warning.
 */

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Required unless the toggle is labelled by an adjacent element. */
  label?: string;
  labelledBy?: string;
  className?: string;
  size?: 'sm' | 'md';
}

const TRACK = {
  sm: 'w-10 h-6',
  md: 'w-12 h-7',
} as const;

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  labelledBy,
  className,
  size = 'md',
}: ToggleProps) {
  const id = useId();

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full',
        'focus-ring',
        'transition-colors duration-quick ease-standard',
        'disabled:pointer-events-none disabled:opacity-45',
        TRACK[size],
        checked ? 'bg-brand-gradient' : 'bg-line-strong',
        className,
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-0.5 block rounded-full bg-white shadow-sm',
          'transition-transform duration-quick ease-standard',
          size === 'sm' ? 'size-5' : 'size-6',
          // Travel = track width - knob - (2 × inset).
          checked
            ? size === 'sm'
              ? 'translate-x-4'
              : 'translate-x-5'
            : 'translate-x-0',
        )}
      />
    </button>
  );
}
