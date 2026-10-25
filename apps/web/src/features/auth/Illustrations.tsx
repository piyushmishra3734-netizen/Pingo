import { useId } from 'react';

/**
 * The two pictures that stand above the code and PIN screens, drawn here rather
 * than taken from a set: a padlock with a brass keyhole, and a phone sending a
 * code. The padlock is graphite with a brass keyhole; the phone is PINGO's
 * violet, so the two screens sit together without either shouting.
 */

/** A glossy padlock: graphite body, steel shackle, brass keyhole, a soft shadow under it. */
export function PadlockArt({ size = 96 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size * 1.12} viewBox="0 0 96 108" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`${id}b`} x1="20" y1="44" x2="76" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5b5b62" />
          <stop offset="1" stopColor="#222226" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="26" y1="10" x2="70" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e9e6f5" />
          <stop offset="0.55" stopColor="#a9a3c4" />
          <stop offset="1" stopColor="#d6d2e6" />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="40" y1="56" x2="56" y2="84" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffe29a" />
          <stop offset="1" stopColor="#e39a12" />
        </linearGradient>
        <radialGradient id={`${id}h`} cx="0.3" cy="0.15" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Shadow on the ground. */}
      <ellipse cx="48" cy="102" rx="26" ry="4" fill="#1b1340" opacity="0.18" />
      {/* Shackle: a thick steel arc, with a darker inner edge for depth. */}
      <path d="M27 50 V34 C27 21 36 13 48 13 C60 13 69 21 69 34 V50" stroke={`url(#${id}s)`} strokeWidth="9" strokeLinecap="round" />
      <path d="M31.5 50 V34 C31.5 24 38 17.5 48 17.5" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      {/* Body. */}
      <rect x="14" y="46" width="68" height="52" rx="15" fill={`url(#${id}b)`} />
      <rect x="14" y="46" width="68" height="52" rx="15" fill={`url(#${id}h)`} />
      <rect x="14.75" y="46.75" width="66.5" height="50.5" rx="14.25" stroke="#fff" strokeOpacity="0.16" strokeWidth="1.5" />
      {/* Brass keyhole. */}
      <circle cx="48" cy="67" r="8.2" fill={`url(#${id}g)`} />
      <path d="M45.4 72 H50.6 L52 83 H44 Z" fill={`url(#${id}g)`} />
      <circle cx="48" cy="67" r="3" fill="#5a3a05" opacity="0.55" />
    </svg>
  );
}

/** A phone, a speech bubble of dots, and a shield with a tick: a code on its way and checked. */
export function OtpArt({ width = 196 }: { width?: number }) {
  const id = useId();
  return (
    <svg width={width} height={width * 0.74} viewBox="0 0 196 145" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`${id}v`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5dff" />
          <stop offset="1" stopColor="#e0559b" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b2a8a" />
          <stop offset="1" stopColor="#1f1550" />
        </linearGradient>
      </defs>
      {/* A soft ground behind the whole picture. */}
      <ellipse cx="98" cy="126" rx="70" ry="9" fill="#8b5dff" opacity="0.1" />
      <circle cx="98" cy="70" r="54" fill="#8b5dff" opacity="0.08" />
      {/* The phone. */}
      <rect x="68" y="14" width="60" height="108" rx="13" fill={`url(#${id}p)`} />
      <rect x="72" y="20" width="52" height="96" rx="9" fill="#fff" />
      <rect x="88" y="16.5" width="20" height="3.2" rx="1.6" fill="#1f1550" opacity="0.5" />
      {/* Placeholder lines and the six code boxes on its screen. */}
      <rect x="80" y="32" width="36" height="5" rx="2.5" fill="#e6e1fa" />
      <rect x="80" y="42" width="26" height="5" rx="2.5" fill="#efebfc" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={78 + (i % 3) * 14.5} y={60 + Math.floor(i / 3) * 15} width="11.5" height="11.5" rx="3.2" fill={i < 4 ? '#ece8fb' : '#f6f4fd'} stroke={i === 4 ? '#8b5dff' : 'none'} strokeWidth="1.4" />
      ))}
      <rect x="80" y="94" width="36" height="12" rx="6" fill={`url(#${id}v)`} />
      {/* A message bubble leaving the phone. */}
      <path d="M18 34 C18 27 23 22 30 22 H68 C75 22 80 27 80 34 V44 C80 51 75 56 68 56 H44 L30 66 V56 H30 C23 56 18 51 18 44 Z" fill="#fff" stroke="#e3dcfa" strokeWidth="1.6" />
      {[34, 46, 58, 70].map((x) => (
        <circle key={x} cx={x - 6} cy="39" r="3.4" fill={`url(#${id}v)`} />
      ))}
      {/* The shield: checked. */}
      <path d="M150 40 L172 48 V68 C172 82 163 92 150 98 C137 92 128 82 128 68 V48 Z" fill={`url(#${id}v)`} />
      <path d="M150 40 L172 48 V68 C172 82 163 92 150 98 Z" fill="#fff" opacity="0.1" />
      <path d="M139.5 69 L147.5 77 L161.5 61" stroke="#fff" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Sparks. */}
      <path d="M176 24 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#ffc94d" />
      <path d="M14 82 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4 Z" fill="#e0559b" opacity="0.8" />
      <circle cx="184" cy="104" r="3" fill="#8b5dff" opacity="0.5" />
    </svg>
  );
}
