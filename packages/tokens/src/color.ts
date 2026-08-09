/**
 * PINGO colour tokens.
 *
 * Transcribed directly from the PINGO branding board. These six values plus the
 * brand gradient are the entire palette - nothing else is invented. Any new
 * surface, border or state colour must be derived from these by opacity, never
 * by picking a new hue.
 *
 * Platform-neutral: plain strings, safe for web CSS and React Native alike.
 */

/** Product palette — ink monochrome product chrome. */
export const palette = {
  /** Near-black. Interactive, primary. */
  primaryBlue: '#111113',
  /** Softer charcoal companion stop. */
  primaryPurple: '#2A2A2E',
  /** Soft White. Recessed surfaces: inputs, incoming bubbles, chips. */
  softWhite: '#F4F4F5',
  /** Background. Calm base. */
  background: '#F7F7F8',
  /** Text. Near-black. */
  text: '#111113',
  /** Secondary. Timestamps, captions, supporting copy. */
  secondary: '#6B6B6F',
} as const;

/** Primary gradient for actions and outgoing bubbles. */
export const gradient = {
  from: '#111113',
  to: '#2A2A2E',
  angle: '135deg',
  css: 'linear-gradient(135deg, #111113 0%, #2A2A2E 100%)',
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
  /** Presence / live mark. */
  dot: palette.primaryBlue,

  // Lines and separators. Deliberately near-invisible; calm interfaces whisper.
  border: 'rgba(17, 17, 19, 0.07)',
  borderStrong: 'rgba(17, 17, 19, 0.12)',
  divider: 'rgba(17, 17, 19, 0.05)',

  // Interaction states — ink washes.
  hover: 'rgba(17, 17, 19, 0.05)',
  pressed: 'rgba(17, 17, 19, 0.09)',
  selected: 'rgba(17, 17, 19, 0.07)',
  focusRing: 'rgba(17, 17, 19, 0.4)',

  // Status. Muted on purpose - a calm product does not shout in red.
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
