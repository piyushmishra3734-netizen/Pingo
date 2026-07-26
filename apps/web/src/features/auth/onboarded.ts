/**
 * "Has this device ever had an account?"
 *
 * The splash needs three destinations, not two
 * ([docs/01 § 3](../../../../../docs/01-onboarding-auth.md#3-splash)):
 *
 * | Condition | Destination |
 * | --- | --- |
 * | Valid session | Home |
 * | Onboarded, no session | Log In |
 * | Never onboarded | Welcome |
 *
 * The middle row is the reason this flag exists. A returning user who signed out
 * should land on Log In, not be walked through the method triage again — but
 * that is only knowable from something persisted locally, because by definition
 * there is no session to ask.
 *
 * Set when a session first appears rather than when Welcome is *seen*: browsing
 * the triage screen and leaving is not onboarding, and treating it as such would
 * strand a curious visitor on a Log In screen for an account they never made.
 */

/** Kept at its original value so devices that onboarded before Phase 2 still count. */
export const ONBOARDED_KEY = 'pingo:onboarded';

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === 'true';
  } catch {
    // Private-mode Safari throws on access. An unreadable flag is a user we
    // treat as new, which is the safe direction: Welcome always works.
    return false;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, 'true');
  } catch {
    // Non-fatal. The cost is one extra trip through Welcome next launch.
  }
}
