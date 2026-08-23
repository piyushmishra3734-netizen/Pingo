import { encodeQr, type QrLevel } from './qr.js';

/**
 * The branded QR: the account's own accent, rounded modules, PINGO in the middle.
 *
 * ## The ink follows the theme, but only its hue
 *
 * This was a fixed purple-to-blue, and on a pink account it read as somebody
 * else's graphic dropped into the page - measured: the accent was `#e0559b` and
 * the code was `#7C3AED`, which is not a near miss, it is a different family.
 *
 * So the stops are derived from `--color-brand`: its hue and saturation are
 * kept and its lightness is *replaced* with two fixed dark values. That
 * direction matters. Using the accent as given would have shipped a code at
 * luminance 135 on white, which is the wrong side of where a scanner puts its
 * threshold; forcing the lightness means every accent - and the near-white one
 * the dark theme uses - lands at the same safe darkness, and only the colour
 * changes.
 *
 * Resolved to literal hex here rather than left as `var(--color-brand)` in the
 * stop. The QR sheet exports a PNG by serialising this SVG and drawing it into
 * a canvas, and a serialised SVG has no document to read custom properties
 * from - the saved image would come out with no ink at all.
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
 *   The card is what adapts to the theme - the code inside it does not.
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
 * one place rounding is genuinely risky - and also the place it does the most
 * for how the code looks. They are drawn as a rounded ring plus a rounded
 * centre at their exact specified geometry (7 modules outer, 3 modules inner,
 * one clear module between), rather than as rounded versions of each module,
 * which would break the 1:1:3:1:1 run ratio a decoder measures across them.
 *
 * ## There is no logo, and that is what made it legible
 *
 * There was one - the penguin, on a white plate in the middle - and it was
 * costing more than it looked like it was. A logo needs level H to survive
 * being drawn over, H needs 30% more modules for the same URL, and more modules
 * at a fixed pixel width means smaller ones: the referral code came out at
 * version 6, forty-one modules across, 3.4 pixels each. That is what read as
 * confetti.
 *
 * Taking the logo out lets the level go back to M, which puts the same link in
 * version 3 - twenty-nine across - and every module gets nearly twice the area.
 * The code is plainer and enormously easier to look at, and to scan.
 *
 * `make-qr-mark.mjs` still cuts the mark out of the artwork if it is ever
 * wanted back; nothing here imports it, so nothing ships in the bundle for it.
 *
 * Verified rather than reasoned: `pnpm verify:qr` decodes the real output with
 * jsQR, at both levels and with the centre blanked, and the preview that chose
 * this decoded the rendered SVG itself.
 */

/** Modules of quiet zone. Four is the specification's minimum, not a taste. */
const QUIET = 4;

/**
 * The two lightnesses the ink is forced to, whatever the accent is.
 *
 * 0.19 and 0.34 put both stops between luminance 45 and 90 on white for every
 * accent PINGO ships, which is comfortably the dark side of where a scanner
 * thresholds. The spread is small on purpose: a gradient wide enough to notice
 * is a gradient whose pale end is closer to the paper.
 */
const INK_DARK = 0.19;
const INK_LIGHT = 0.34;

/** Deep ink, for when the accent cannot be read. Never light, never absent. */
const FALLBACK: [string, string] = ['#241a33', '#3d2a5c'];

function hexToRgb(hex: string): [number, number, number] | undefined {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return undefined;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Hue and saturation from the accent, lightness from us. See `INK_DARK`. */
function atLightness([r, g, b]: [number, number, number], lightness: number): string {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  /*
   * A floor under the saturation, so a near-grey accent - the default theme's
   * `#111113`, and the near-white one the dark theme uses - still comes out as
   * ink with a colour in it rather than as flat charcoal.
   */
  const sat = Math.max(s, 0.35);
  const c = (1 - Math.abs(2 * lightness - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector]!;

  return `#${rgb
    .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The two stops, read from the theme at render time.
 *
 * A plain read, not a hook: it is called during render, the value is only ever
 * two strings, and the screens that own a QR already re-render when the accent
 * changes because they are the ones that read the preference.
 */
function inkStops(): [string, string] {
  if (typeof window === 'undefined') return FALLBACK;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-brand')
    .trim();
  const rgb = accent ? hexToRgb(accent) : undefined;
  if (!rgb) return FALLBACK;
  return [atLightness(rgb, INK_DARK), atLightness(rgb, INK_LIGHT)];
}

export interface QrArtProps {
  /** What the code encodes. */
  value: string;
  /** Rendered width in px. The SVG scales; the module count does not change. */
  size?: number;
  /**
   * Level M by default.
   *
   * H exists for a caller that covers part of the code - it recovers about 30%
   * instead of 15% - and it costs a denser, smaller-moduled code for the same
   * link. Nothing covers the code any more, so nothing pays for that.
   */
  level?: QrLevel;
  className?: string;
  title?: string;
}

export function QrArt({ value, size = 260, level = 'M', className, title }: QrArtProps) {
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

  const dots: { x: number; y: number }[] = [];
  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) {
      if (!modules[y]![x]) continue;
      if (inFinder(x, y)) continue;
      dots.push({ x, y });
    }
  }

  const [inkFrom, inkTo] = inkStops();
  /*
   * The colour goes in the id. Two codes on one page under different accents
   * would otherwise share a gradient definition, and the second one drawn would
   * silently take the first one's ink.
   */
  const id = `qr-${value.length}-${count}-${inkFrom.slice(1)}`;

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
          {/* The account's accent at our lightness, both dark enough to
              threshold as "black". See `inkStops`. */}
          <stop offset="0%" stopColor={inkFrom} />
          <stop offset="100%" stopColor={inkTo} />
        </linearGradient>
      </defs>

      {/*
        White, always, in both themes. See the note at the top of this file  - 
        this is the single most load-bearing rule in the component.
      */}
      <rect width={span} height={span} rx={span * 0.06} fill="#FFFFFF" />

      <g transform={`translate(${QUIET} ${QUIET})`} fill={`url(#${id})`}>
        {/*
          Data modules, rounded and very slightly inset.

          The inset (0.08 of a module each side) is what makes neighbouring
          modules read as separate dots rather than a blob, and it is small
          enough that a scanner still samples ink at every module centre  - 
          which is the only place it looks.
        */}
        {dots.map(({ x, y }) => (
          <rect
            key={`${x}-${y}`}
            x={x + 0.03}
            y={y + 0.03}
            width={0.94}
            height={0.94}
            rx={0.28}
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

    </svg>
  );
}
