import type { AuthMethodKind } from '@pingo/core';

/**
 * Which door this device used last.
 *
 * [docs/01 § 13.1](../../../../../docs/01-onboarding-auth.md#131-method-selection):
 * the last-used method is **moved to the top and captioned `Last used`**, because
 * most returning sign-ins repeat the previous method. Guessing wrong costs a tap;
 * not guessing costs one every time.
 *
 * With only the email door open this changes nothing on screen, and it is here
 * anyway - it is the piece that would otherwise be forgotten the day Google
 * lands, when the ordering starts to matter and nobody remembers the rule.
 *
 * Device-local, never sent anywhere: it is a UI preference, and *which* method
 * an account uses is exactly the kind of thing that should not leave the device
 * on its own.
 */

const KEY = 'pingo:auth:last-method';

const KINDS: readonly AuthMethodKind[] = ['email', 'google', 'phone'];

export function readLastMethod(): AuthMethodKind | undefined {
  try {
    const stored = localStorage.getItem(KEY);
    return KINDS.find((kind) => kind === stored);
  } catch {
    return undefined;
  }
}

export function writeLastMethod(kind: AuthMethodKind): void {
  try {
    localStorage.setItem(KEY, kind);
  } catch {
    // Non-fatal: the rows simply keep their blueprint order.
  }
}
