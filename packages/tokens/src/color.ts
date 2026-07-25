/**
 * PINGO colour tokens.
 *
 * Transcribed directly from the PINGO branding board. These six values plus the
 * brand gradient are the entire palette — nothing else is invented. Any new
 * surface, border or state colour must be derived from these by opacity, never
 * by picking a new hue.
 *
 * Platform-neutral: plain strings, safe for web CSS and React Native alike.
 */

/** The literal palette from the branding board. Do not edit without a brand decision. */
export const palette = {
  /** #5C6CFF — Primary Blue. Interactive, links, the cooler half of the brand. */
  primaryBlue: '#5C6CFF',
  /** #8B5DFF — Primary Purple. The brand's heart; the PINGO dot. */
  primaryPurple: '#8B5DFF',
  /** #F8F9FD — Soft White. Recessed surfaces: inputs, incoming bubbles, chips. */
  softWhite: '#F8F9FD',
  /** #FBFBFE — Background. The calm base the whole product sits on. */
  background: '#FBFBFE',
  /** #101114 — Text. Near-black, never pure black: pure black is harsh at scale. */
  text: '#101114',
  /** #6F7282 — Secondary. Timestamps, captions, supporting copy. */
  secondary: '#6F7282',
} as const;

/** The brand gradient, #6D7CFF → #A16EFF, used for primary actions and outgoing bubbles. */
export const gradient = {
  from: '#6D7CFF',
  to: '#A16EFF',
  /** 135° reads as light falling from the top-left — consistent with the board. */
  angle: '135deg',
  css: 'linear-gradient(135deg, #6D7CFF 0%, #A16EFF 100%)',
} as const;

/**
 * Semantic colour roles.
 *
 * Screens and components reference these, never `palette` directly. That
 * indirection is what lets us add a dark theme later by swapping one map.
 */
export const color = {
  // Surfaces, from furthest back to closest to the user.
  bg: palette.background,
  surface: '#FFFFFF',
  surfaceSunken: palette.softWhite,
  surfaceRaised: '#FFFFFF',

  // Text, in descending emphasis.
  textPrimary: palette.text,
  textSecondary: palette.secondary,
  /** Metadata that should recede almost entirely: read receipts, dividers' labels. */
  textTertiary: 'rgba(16, 17, 20, 0.38)',
  textOnBrand: '#FFFFFF',

  // Brand.
  brand: palette.primaryBlue,
  brandAlt: palette.primaryPurple,
  /** The purple dot — PINGO's single most recognisable element. */
  dot: palette.primaryPurple,

  // Lines and separators. Deliberately near-invisible; calm interfaces whisper.
  border: 'rgba(16, 17, 20, 0.07)',
  borderStrong: 'rgba(16, 17, 20, 0.12)',
  divider: 'rgba(16, 17, 20, 0.05)',

  // Interaction states, expressed as brand-tinted washes rather than greys.
  hover: 'rgba(92, 108, 255, 0.06)',
  pressed: 'rgba(92, 108, 255, 0.11)',
  selected: 'rgba(92, 108, 255, 0.09)',
  focusRing: 'rgba(92, 108, 255, 0.45)',

  // Status. Muted on purpose — a calm product does not shout in red.
  online: '#34C77B',
  away: '#F0B252',
  danger: '#E5544B',
  dangerSoft: 'rgba(229, 84, 75, 0.10)',

  // Glass, for the floating dock and overlay chrome.
  glass: 'rgba(255, 255, 255, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.55)',
  scrim: 'rgba(16, 17, 20, 0.32)',
} as const;

export type ColorRole = keyof typeof color;
