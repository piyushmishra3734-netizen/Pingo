/**
 * How full the progress bar is at each setup step.
 *
 * Fractions, not step numbers — [docs/01 § 2.1](../../../../../docs/01-onboarding-auth.md#21-global-rules-for-the-whole-flow)
 * rules out "3 of 4" because a count makes a short flow feel long.
 *
 * These continue the bar that sign-up started: by the time the account exists
 * the user is already partway through, so setup runs from a half-full bar to a
 * complete one rather than resetting to zero and implying the work restarted.
 */
export const SETUP_PROGRESS = {
  name: 0.55,
  username: 0.7,
  photo: 0.85,
  permissions: 1,
} as const;
