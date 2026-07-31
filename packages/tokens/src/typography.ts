/**
 * PINGO typography tokens.
 *
 * The board specifies "Space Grotesk Rounded" at five sizes. Space Grotesk is
 * the shipped face; the "Rounded" descriptor is honoured through the geometric,
 * soft-terminal character of the family itself rather than a separate cut,
 * because no rounded variant is published. If a bespoke rounded cut is
 * commissioned later, only `fontFamily.sans` changes.
 */

export const fontFamily = {
  sans: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  /** For voice-note durations and any tabular figure alignment. */
  mono: "'Space Grotesk', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/**
 * The type scale, exactly as specified on the board.
 *
 * Line heights are not on the board, so they are derived: generous multipliers
 * for body copy (readability, breathing space) tightening as size grows
 * (large text needs proportionally less leading). Letter-spacing goes slightly
 * negative at display sizes, which is what keeps large geometric type from
 * looking loose.
 */
export const textStyle = {
  /** 56 / Bold - splash and onboarding headlines only. Used sparingly. */
  display: {
    fontSize: '3.5rem',
    lineHeight: '1.05',
    fontWeight: fontWeight.bold,
    letterSpacing: '-0.02em',
  },
  /** 32 / SemiBold - screen titles. */
  h1: {
    fontSize: '2rem',
    lineHeight: '1.18',
    fontWeight: fontWeight.semibold,
    letterSpacing: '-0.015em',
  },
  /** 20 / Medium - section headers, conversation names. */
  h2: {
    fontSize: '1.25rem',
    lineHeight: '1.3',
    fontWeight: fontWeight.medium,
    letterSpacing: '-0.01em',
  },
  /** 16 / Regular - the workhorse. Message text, list rows, settings labels. */
  body: {
    fontSize: '1rem',
    lineHeight: '1.5',
    fontWeight: fontWeight.regular,
    letterSpacing: '0',
  },
  /** 16 / Medium - body copy that needs to carry slightly more weight. */
  bodyStrong: {
    fontSize: '1rem',
    lineHeight: '1.5',
    fontWeight: fontWeight.medium,
    letterSpacing: '0',
  },
  /** 12 / Regular - timestamps, metadata, helper text. */
  caption: {
    fontSize: '0.75rem',
    lineHeight: '1.35',
    fontWeight: fontWeight.regular,
    letterSpacing: '0.005em',
  },
  /**
   * The wordmark treatment. The board's logo is wide-tracked geometric caps;
   * this reproduces that spacing for inline "PINGO" text.
   */
  wordmark: {
    fontSize: '1.25rem',
    lineHeight: '1',
    fontWeight: fontWeight.medium,
    letterSpacing: '0.34em',
  },
} as const;

export type TextStyleName = keyof typeof textStyle;
