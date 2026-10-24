import { useId } from 'react';

/**
 * The icons under the face in the composer. Not from a set: each is drawn here
 * as a neon glyph, a thin bright line over a wider, softer copy of itself, in a
 * pink-to-violet gradient with a spark, so a row of three reads as one family
 * sitting on dark glass.
 */

function Gradient({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={from} />
        <stop offset="1" stopColor={to} />
      </linearGradient>
    </defs>
  );
}

/** Instagram's colours for these three: a hot pink for music, a magenta for the audience, the pink again for the rest. */
const PINK = { from: '#ff3d71', to: '#ff2d92', glow: '#ff2d6f' };
const MAGENTA = { from: '#e02ff0', to: '#b436f2', glow: '#d02be0' };

/** A four-point spark, centred on (x, y). */
const spark = (x: number, y: number, r: number) =>
  `M${x} ${y - r} L${x + r * 0.26} ${y - r * 0.26} L${x + r} ${y} L${x + r * 0.26} ${y + r * 0.26} L${x} ${y + r} L${x - r * 0.26} ${y + r * 0.26} L${x - r} ${y} L${x - r * 0.26} ${y - r * 0.26} Z`;

function Neon({ children, tone = PINK }: { children: (paint: string) => React.ReactNode; tone?: { from: string; to: string; glow: string } }) {
  const { glow } = tone;
  const g = useId();
  const paint = `url(#${g})`;
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden style={{ filter: `drop-shadow(0 0 3px ${glow}66)` }}>
      <Gradient id={g} from={tone.from} to={tone.to} />
      {children(paint)}
    </svg>
  );
}

const line = (paint: string, width = 1.7) => ({ stroke: paint, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' }) as const;

export function MusicGlyph() {
  return (
    <Neon>
      {(p) => (
        <>
          <path d="M9.2 6.8 L18 5 V8.4 L9.2 10.2 Z" fill={p} />
          <path d="M9.2 17.4 V6.8 M18 15.4 V5" {...line(p)} />
          <circle cx="6.9" cy="17.6" r="2.5" fill={p} />
          <circle cx="15.7" cy="15.6" r="2.5" fill={p} />
          {/* Sound leaving the note. */}
          <path d="M20.4 9.2 C21.6 10.6 21.6 12.8 20.4 14.2" {...line(p, 1.4)} opacity="0.8" />
          <path d="M22 7.6 C24 10 24 13.4 22 15.8" {...line(p, 1.2)} opacity="0.45" />
          <path d={spark(4.4, 6.2, 2.3)} fill={p} />
        </>
      )}
    </Neon>
  );
}

export function FriendsGlyph() {
  return (
    <Neon tone={MAGENTA}>
      {(p) => (
        <>
          <circle cx="8.6" cy="12.4" r="5.6" {...line(p)} />
          <circle cx="15.4" cy="12.4" r="5.6" {...line(p)} opacity="0.8" />
          <path d="M6.6 13.2 C7.6 14.8 9.8 14.8 10.8 13.2" {...line(p, 1.3)} />
          <circle cx="7.4" cy="10.8" r="0.9" fill={p} />
          <circle cx="10" cy="10.8" r="0.9" fill={p} />
          {/* A heart where the two faces meet. */}
          <path d="M12 8.4 C12 7.2 10.6 6.6 9.9 7.5 C9.2 6.6 7.8 7.2 7.8 8.4 C7.8 9.8 9.9 11 9.9 11 C9.9 11 12 9.8 12 8.4 Z" transform="translate(2.1 -3.9) scale(1)" fill={p} />
          <path d={spark(20.6, 5.2, 2.2)} fill={p} />
        </>
      )}
    </Neon>
  );
}

/** Close friends: the green ring's star, lit. */
export function CloseFriendsGlyph() {
  return (
    <Neon tone={{ from: '#2ee283', to: '#2ee283', glow: '#2ee283' }}>
      {() => (
        <>
          <path
            d="M12 2.6 L14.7 8.5 L21.2 9.2 L16.4 13.6 L17.7 20 L12 16.8 L6.3 20 L7.6 13.6 L2.8 9.2 L9.3 8.5 Z"
            fill="#2ee283"
            stroke="#b8ffd9"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M12 7 L13.2 9.8" stroke="#eafff3" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
        </>
      )}
    </Neon>
  );
}

export function SmileGlyph() {
  return (
    <Neon>
      {(p) => (
        <>
          <path d="M20.8 12.8 A8.8 8.8 0 1 1 11.2 3.2" {...line(p)} />
          {/* Star eyes. */}
          <path d={spark(8.6, 10, 2)} fill={p} />
          <path d={spark(15.2, 10, 2)} fill={p} />
          {/* An open grin. */}
          <path d="M7.6 14.2 C9 18 15 18 16.4 14.2 Z" fill={p} opacity="0.9" />
          <path d={spark(19.6, 4.6, 3)} fill={p} />
        </>
      )}
    </Neon>
  );
}

export function CloseGlyph() {
  return (
    <Neon>
      {(p) => <path d="M6.4 6.4 L17.6 17.6 M17.6 6.4 L6.4 17.6" {...line(p, 2.3)} />}
    </Neon>
  );
}
