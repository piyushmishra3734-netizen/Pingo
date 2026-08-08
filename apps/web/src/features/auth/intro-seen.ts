/**
 * Pre-login intro slides — "has this device finished (or skipped) the 5 slides?"
 *
 * Separate from `pingo:onboarded` (which means an account has existed here).
 * Logout must not clear this flag; clearing site data naturally resets it.
 */

import { hasOnboarded } from './onboarded.js';

export const INTRO_SEEN_KEY = 'pingo:intro_seen';

export function hasIntroSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, 'true');
  } catch {
    // Non-fatal: worst case they see the intro again next cold start.
  }
}

/** Guest destination after intro (or when intro is already done). */
export function guestAuthPath(): '/login' | '/welcome' {
  return hasOnboarded() ? '/login' : '/welcome';
}
