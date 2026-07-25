/**
 * PINGO spacing, radius, elevation and layout tokens.
 *
 * Spacing is a 4px-based scale, but the *usable* steps skew large. That is the
 * whole point: "every screen should have breathing space" is enforced by making
 * generous spacing the path of least resistance rather than a judgement call.
 */

export const space = {
  '0': '0',
  '1': '0.25rem', // 4
  '2': '0.5rem', // 8
  '3': '0.75rem', // 12
  '4': '1rem', // 16
  '5': '1.25rem', // 20
  '6': '1.5rem', // 24
  '8': '2rem', // 32
  '10': '2.5rem', // 40
  '12': '3rem', // 48
  '16': '4rem', // 64
  '20': '5rem', // 80
  '24': '6rem', // 96
} as const;

/**
 * Corner radii. "Rounded shapes feel friendlier than sharp edges" — so there is
 * no 0 and no 2px in this scale. The smallest corner in PINGO is 8px.
 */
export const radius = {
  sm: '0.5rem', // 8  — chips, badges, small controls
  md: '0.875rem', // 14 — inputs, list-row hover targets
  lg: '1.25rem', // 20 — cards, message bubbles
  xl: '1.75rem', // 28 — sheets, large panels, the dock
  '2xl': '2.25rem', // 36 — app icon, hero surfaces
  pill: '9999px', // buttons, search fields, avatars
} as const;

/**
 * Elevation.
 *
 * Shadows are tinted with the brand blue rather than neutral black. Black
 * shadows on a near-white background read as dirt; a blue-violet shadow reads
 * as light. Opacities stay low — depth should be felt, not seen.
 */
export const shadow = {
  none: 'none',
  /** Resting cards and list rows. */
  sm: '0 1px 2px rgba(16, 17, 20, 0.04), 0 1px 3px rgba(92, 108, 255, 0.04)',
  /** Raised cards, hovered rows. */
  md: '0 2px 6px rgba(16, 17, 20, 0.04), 0 6px 16px rgba(92, 108, 255, 0.06)',
  /** Popovers, the floating dock. */
  lg: '0 4px 12px rgba(16, 17, 20, 0.05), 0 16px 40px rgba(92, 108, 255, 0.10)',
  /** Modals and sheets. */
  xl: '0 8px 24px rgba(16, 17, 20, 0.06), 0 32px 72px rgba(92, 108, 255, 0.14)',
  /** Primary buttons — a coloured glow that ties the action to the brand. */
  brand: '0 4px 14px rgba(109, 124, 255, 0.32)',
  brandPressed: '0 2px 6px rgba(109, 124, 255, 0.28)',
} as const;

/** Liquid-glass surface recipe for the floating dock and overlay chrome. */
export const glass = {
  blur: '24px',
  saturation: '180%',
  background: 'rgba(255, 255, 255, 0.72)',
  border: '1px solid rgba(255, 255, 255, 0.55)',
} as const;

export const layout = {
  /** Chat column max width. Long measure hurts readability; this caps it. */
  chatMaxWidth: '48rem',
  /** Conversation list width on desktop two-pane layouts. */
  sidebarWidth: '22rem',
  sidebarWidthWide: '25rem',
  /** Message bubbles never exceed this share of the column. */
  bubbleMaxWidth: '68%',
  /** Floating dock height, plus the safe gap it leaves above the viewport edge. */
  dockHeight: '4.25rem',
  dockInset: '1.25rem',
  /** Standard screen gutter on mobile. */
  gutter: space['5'],
} as const;

export const zIndex = {
  base: 0,
  raised: 10,
  sticky: 100,
  dock: 200,
  overlay: 300,
  modal: 400,
  toast: 500,
} as const;

/** Breakpoints. Mobile-first: these are min-widths. */
export const breakpoint = {
  sm: '480px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;
