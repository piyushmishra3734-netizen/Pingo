import { useId } from 'react';

/**
 * The icons under the face in the composer. Not from a set: each is drawn here
 * as a duotone glyph (a gradient line and a filled accent) with a small spark,
 * in the app's own gradient, so the three read as one family.
 */

function Gradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0" style={{ stopColor: 'var(--gradient-from, #8b5dff)' }} />
        <stop offset="1" style={{ stopColor: 'var(--gradient-to, #e0559b)' }} />
      </linearGradient>
    </defs>
  );
}

/** A four-point spark, centred on (x, y). */
const spark = (x: number, y: number, r: number) =>
  `M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z`;

const base = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true } as const;
const line = { strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function MusicGlyph() {
  const g = useId();
  return (
    <svg {...base}>
      <Gradient id={g} />
      {/* The beam is the filled accent; stems and heads are the line. */}
      <path d="M9.4 6.9 L19.4 4.8 V8.6 L9.4 10.7 Z" fill={`url(#${g})`} opacity="0.9" />
      <path d="M9.4 18 V6.9 M19.4 16 V4.8" stroke={`url(#${g})`} {...line} />
      <circle cx="6.9" cy="18.1" r="2.6" fill={`url(#${g})`} />
      <circle cx="16.9" cy="16.1" r="2.6" fill={`url(#${g})`} />
      <path d={spark(4.2, 6.2, 2)} fill={`url(#${g})`} />
    </svg>
  );
}

export function FriendsGlyph() {
  const g = useId();
  return (
    <svg {...base}>
      <Gradient id={g} />
      <circle cx="9" cy="8.6" r="3.2" stroke={`url(#${g})`} {...line} />
      <path d="M3.4 19.4 C3.9 15.9 6.2 14 9 14 C11.8 14 14.1 15.9 14.6 19.4" stroke={`url(#${g})`} {...line} />
      <circle cx="16.6" cy="9.6" r="2.5" fill={`url(#${g})`} opacity="0.55" />
      <path d="M15.6 14.4 C18.2 14.1 20.2 15.6 20.7 18.8" stroke={`url(#${g})`} {...line} opacity="0.7" />
      <path d={spark(19.6, 4.4, 2.2)} fill={`url(#${g})`} />
    </svg>
  );
}

/** Close friends: the same pair, with the green ring's star in place of the spark. */
export function CloseFriendsGlyph() {
  const g = useId();
  return (
    <svg {...base}>
      <Gradient id={g} />
      <circle cx="9" cy="8.6" r="3.2" stroke={`url(#${g})`} {...line} />
      <path d="M3.4 19.4 C3.9 15.9 6.2 14 9 14 C11.8 14 14.1 15.9 14.6 19.4" stroke={`url(#${g})`} {...line} />
      <path
        d="M17.2 5.2 L18.3 7.6 L20.9 7.9 L19 9.7 L19.5 12.3 L17.2 11 L14.9 12.3 L15.4 9.7 L13.5 7.9 L16.1 7.6 Z"
        fill="#2ecc71"
        stroke="#2ecc71"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SmileGlyph() {
  const g = useId();
  return (
    <svg {...base}>
      <Gradient id={g} />
      <path d="M20.6 12.6 A8.6 8.6 0 1 1 11.4 3.4" stroke={`url(#${g})`} {...line} />
      <circle cx="8.8" cy="10.4" r="1.25" fill={`url(#${g})`} />
      <circle cx="15" cy="10.4" r="1.25" fill={`url(#${g})`} />
      <path d="M7.8 14.4 C9.2 16.8 14.6 16.8 16 14.4" stroke={`url(#${g})`} {...line} />
      <circle cx="6.4" cy="13.4" r="1.15" fill={`url(#${g})`} opacity="0.35" />
      <circle cx="17.4" cy="13.4" r="1.15" fill={`url(#${g})`} opacity="0.35" />
      <path d={spark(19, 5, 3)} fill={`url(#${g})`} />
    </svg>
  );
}

export function CloseGlyph() {
  const g = useId();
  return (
    <svg {...base}>
      <Gradient id={g} />
      <path d="M6 6 L18 18 M18 6 L6 18" stroke={`url(#${g})`} {...line} strokeWidth={2.2} />
    </svg>
  );
}
