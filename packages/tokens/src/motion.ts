/**
 * PINGO motion tokens.
 *
 * "No unnecessary animations" and "smooth motion feels natural" together imply
 * a specific discipline: motion exists only to explain a change of state, and
 * it never overshoots. There are deliberately no spring, bounce or elastic
 * easings in this file — adding one would contradict the brand.
 *
 * Everything here is fast. Anything above ~320ms starts to feel like the
 * interface is making the user wait, which is the opposite of calm.
 */

export const duration = {
  /** 120ms — colour and opacity on hover/press. Should feel instantaneous. */
  instant: '120ms',
  /** 180ms — the default. Small transforms, chip selection, toggles. */
  quick: '180ms',
  /** 240ms — entering elements: bubbles, sheets, route transitions. */
  base: '240ms',
  /** 320ms — full-screen transitions. The slowest motion in the product. */
  slow: '320ms',
  /** Ambient, looping brand motion: the typing and loading dots. */
  ambient: '1400ms',
} as const;

export const easing = {
  /**
   * The house curve — a strong ease-out. Motion starts immediately and settles
   * gently, which is what makes an interface feel responsive rather than slow.
   * Used for anything entering or responding to direct input.
   */
  standard: 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** For elements leaving: quicker off the mark, no lingering. */
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Symmetric, for things that move without appearing or disappearing. */
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Continuous loops (the dot pulse) need an even curve to avoid a heartbeat feel. */
  ambient: 'cubic-bezier(0.4, 0, 0.6, 1)',
} as const;

/** Pre-composed transitions, so components don't re-derive the common cases. */
export const transition = {
  colors: `background-color ${duration.instant} ${easing.standard}, border-color ${duration.instant} ${easing.standard}, color ${duration.instant} ${easing.standard}`,
  transform: `transform ${duration.quick} ${easing.standard}`,
  opacity: `opacity ${duration.base} ${easing.standard}`,
  all: `all ${duration.quick} ${easing.standard}`,
} as const;

/**
 * Press feedback. A 2% inward scale is enough to register as tactile — the
 * "premium physical object" feel — without looking like a game button.
 */
export const press = {
  scale: 0.98,
  scaleSmall: 0.96,
} as const;
