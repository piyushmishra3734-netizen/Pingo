import { encodeQr, type QrLevel } from './qr.js';

/**
 * The branded QR: purple-to-blue, rounded modules, PINGO in the middle.
 *
 * ## Everything here is subordinate to one rule
 *
 * It has to scan. A QR code is not a graphic that happens to be scannable; it
 * is a scan target that happens to be visible, and every decision below was
 * checked against that rather than against how it looks.
 *
 * What that rule bought, and what it cost:
 *
 * - **White stays white.** The background is `#FFFFFF` in both themes, never
 *   the page surface. Scanners threshold the image to black and white and rely
 *   on the *light* modules being genuinely light; a dark-mode QR on a dark card
 *   inverts that relationship and a good number of readers simply refuse it.
 *   The card is what adapts to the theme — the code inside it does not.
 * - **The gradient runs across the whole code, not per module.** One
 *   `linearGradient` over the full square keeps every module far from the
 *   background in luminance. Per-module colouring, or a gradient that reaches
 *   white at one end, would make the palest corner unreadable.
 * - **Modules are rounded, not circular.** `rx` of 0.36 of a module reads as
 *   soft while keeping about 90% of the ink. Circles look better and throw away
 *   nearly a quarter of it, which is the margin a phone needs at an angle.
 * - **The quiet zone is four modules and non-negotiable.** It is the most
 *   commonly dropped part of the specification and the most common reason a
 *   pretty QR does not scan.
 *
 * ## The finder patterns are drawn by hand
 *
 * The three corner squares are what a scanner locates first, so they are the
 * one place rounding is genuinely risky — and also the place it does the most
 * for how the code looks. They are drawn as a rounded ring plus a rounded
 * centre at their exact specified geometry (7 modules outer, 3 modules inner,
 * one clear module between), rather than as rounded versions of each module,
 * which would break the 1:1:3:1:1 run ratio a decoder measures across them.
 *
 * ## The logo is damage, and is budgeted as such
 *
 * Level H recovers about 30% of a code. The logo plate is 22% of the width,
 * which is 4.8% of the area — comfortably inside that budget with room left for
 * the real-world damage the level is actually there for. The mark itself is
 * capped at 18% of the width as specified.
 */

/** Modules of quiet zone. Four is the specification's minimum, not a taste. */
const QUIET = 4;

/**
 * The white plate behind the logo, as a fraction of the code's width.
 *
 * Slightly larger than the mark so the logo never touches a module — a scanner
 * reading a module that is half-covered is worse off than one reading a module
 * that is cleanly absent, because absence is what the error correction is
 * designed to reconstruct.
 */
const PLATE = 0.22;

/** The mark itself. The brief's ceiling, and the reason the plate is separate. */
const MARK = 0.18;

export interface QrArtProps {
  /** What the code encodes. */
  value: string;
  /** Rendered width in px. The SVG scales; the module count does not change. */
  size?: number;
  /**
   * Level H by default, because the logo needs it.
   *
   * A caller that has no logo can ask for M and get a less dense code.
   */
  level?: QrLevel;
  /** Drawn in the centre. Omit for a plain code. */
  logo?: boolean;
  className?: string;
  title?: string;
}

export function QrArt({
  value,
  size = 260,
  level = 'H',
  logo = true,
  className,
  title,
}: QrArtProps) {
  const modules = encodeQr(value, level);
  const count = modules.length;
  const span = count + QUIET * 2;

  const finders: [number, number][] = [
    [0, 0],
    [count - 7, 0],
    [0, count - 7],
  ];

  const inFinder = (x: number, y: number) =>
    finders.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);

  /*
   * The modules the logo will cover, dropped before they are drawn.
   *
   * Painting them and then covering them would leave their edges peeking out
   * from behind the plate, which reads as a rendering bug and gives a scanner a
   * partial module to misjudge. Cleared here, the plate sits on empty white.
   */
  const plateSpan = logo ? count * PLATE : 0;
  const plateFrom = (count - plateSpan) / 2;
  const plateTo = plateFrom + plateSpan;
  const underPlate = (x: number, y: number) =>
    logo && x + 1 > plateFrom && x < plateTo && y + 1 > plateFrom && y < plateTo;

  const dots: { x: number; y: number }[] = [];
  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) {
      if (!modules[y]![x]) continue;
      if (inFinder(x, y) || underPlate(x, y)) continue;
      dots.push({ x, y });
    }
  }

  const id = `qr-${value.length}-${count}`;

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title ?? `QR code for ${value}`}
      shapeRendering="geometricPrecision"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {/* Purple to blue, both dark enough to threshold as "black". */}
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>

      {/*
        White, always, in both themes. See the note at the top of this file —
        this is the single most load-bearing rule in the component.
      */}
      <rect width={span} height={span} rx={span * 0.06} fill="#FFFFFF" />

      <g transform={`translate(${QUIET} ${QUIET})`} fill={`url(#${id})`}>
        {/*
          Data modules, rounded and very slightly inset.

          The inset (0.08 of a module each side) is what makes neighbouring
          modules read as separate dots rather than a blob, and it is small
          enough that a scanner still samples ink at every module centre —
          which is the only place it looks.
        */}
        {dots.map(({ x, y }) => (
          <rect
            key={`${x}-${y}`}
            x={x + 0.08}
            y={y + 0.08}
            width={0.84}
            height={0.84}
            rx={0.3}
          />
        ))}

        {/* The three finders, at their exact geometry. */}
        {finders.map(([fx, fy]) => (
          <g key={`${fx}-${fy}`}>
            {/*
              The ring: a 7-module rounded square with a 5-module hole, drawn as
              a stroke so the one-module gap is exact rather than approximated.
            */}
            <rect
              x={fx + 0.5}
              y={fy + 0.5}
              width={6}
              height={6}
              rx={1.75}
              fill="none"
              stroke={`url(#${id})`}
              strokeWidth={1}
            />
            <rect
              x={fx + 2}
              y={fy + 2}
              width={3}
              height={3}
              rx={0.95}
            />
          </g>
        ))}
      </g>

      {logo && (
        <g transform={`translate(${QUIET} ${QUIET})`}>
          {/* The plate, so the mark never overlaps a live module. */}
          <rect
            x={plateFrom}
            y={plateFrom}
            width={plateSpan}
            height={plateSpan}
            rx={plateSpan * 0.26}
            fill="#FFFFFF"
          />
          <PingoGlyph
            x={(count - count * MARK) / 2}
            y={(count - count * MARK) / 2}
            span={count * MARK}
            fill={`url(#${id})`}
          />
        </g>
      )}
    </svg>
  );
}

/**
 * The PINGO mark, inline.
 *
 * Drawn here rather than reusing `<PingoMark>` because that renders its own
 * `<svg>` with its own viewBox, and nesting one inside this one would place it
 * in the wrong coordinate space — the mark has to be in *module* units to sit
 * on the plate at any rendered size.
 */
function PingoGlyph({
  x,
  y,
  span,
  fill,
}: {
  x: number;
  y: number;
  span: number;
  fill: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${span / 24})`} fill={fill}>
      {/* A speech mark with the signature dot — the same silhouette as the app icon. */}
      <path
        d="M12 2.5c-5.2 0-9.5 3.6-9.5 8.1 0 2.6 1.4 4.9 3.6 6.4v3.4c0 .5.6.8 1 .5l3.2-2.2c.55.09 1.12.14 1.7.14 5.2 0 9.5-3.6 9.5-8.2S17.2 2.5 12 2.5z"
        opacity="0.16"
      />
      <path
        d="M12 4c-4.4 0-8 3-8 6.6 0 2.1 1.2 4 3.1 5.2l.4.3v2.3l2.1-1.4.4.06c.65.11 1.32.16 2 .16 4.4 0 8-3 8-6.6S16.4 4 12 4zm0-1.5c5.2 0 9.5 3.6 9.5 8.1s-4.3 8.2-9.5 8.2c-.58 0-1.15-.05-1.7-.14l-3.2 2.2c-.4.3-1 0-1-.5V17c-2.2-1.5-3.6-3.8-3.6-6.4C2.5 6.1 6.8 2.5 12 2.5z"
      />
      <circle cx="12" cy="10.6" r="2.1" />
    </g>
  );
}
