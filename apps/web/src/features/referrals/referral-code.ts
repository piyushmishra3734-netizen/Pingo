/**
 * The code somebody arrived with, kept until there is an account to attach it to.
 *
 * ## Why it has to be stored at all
 *
 * A referral link lands on a public page, and the account it belongs to does
 * not exist yet. Between the link and the account there is a welcome screen, a
 * choice of method, a Google round trip that leaves the origin entirely, a
 * password or an OTP, and a username. The code has to survive all of it,
 * including the part where the browser navigates away to Google and comes back.
 *
 * `localStorage`, therefore - the same mechanism the app already trusts for
 * `pingo:onboarded`, which has the identical job of surviving a signup. A query
 * parameter would be lost at the first redirect; React state would be lost at
 * the first reload; a cookie would be a new mechanism for no gain.
 *
 * ## What it is not
 *
 * It is not a claim about anything. The client stores who invited it and hands
 * that over once; the server decides whether it is true, whether it is allowed,
 * and what it is worth. Nothing here is trusted, which is why nothing here is
 * defended - see `redeem_referral`.
 *
 * The code is cleared only after the server has accepted or finally rejected
 * it, so a signup abandoned halfway still has its referral when the person
 * comes back.
 */

const KEY = 'pingo:referral';

/**
 * The alphabet the server issues from: digits and letters, minus the four that
 * people mistype. Normalising here means a code pasted with a stray space, a
 * lowercase code, or one copied with the surrounding URL punctuation all arrive
 * as the same eight characters the server stored.
 */
const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

/** Uppercase, stripped of anything that is not part of a code. */
export function normaliseReferralCode(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  return CODE.test(cleaned) ? cleaned : undefined;
}

/**
 * Remember a code from a link.
 *
 * First one wins. Somebody who opens two invitations belongs to whoever got
 * them here, and the server enforces the same thing permanently once an account
 * exists - this only keeps the two ends agreeing before it does.
 */
export function rememberReferralCode(raw: string | undefined | null): string | undefined {
  const code = normaliseReferralCode(raw);
  if (!code) return undefined;
  try {
    const held = localStorage.getItem(KEY);
    if (held && CODE.test(held)) return held;
    localStorage.setItem(KEY, code);
  } catch {
    // Private-mode Safari throws on write. A referral that cannot be stored is
    // a referral that does not happen, which is worth nothing and breaks
    // nothing.
  }
  return code;
}

export function heldReferralCode(): string | undefined {
  try {
    const held = localStorage.getItem(KEY);
    return held && CODE.test(held) ? held : undefined;
  } catch {
    return undefined;
  }
}

export function forgetReferralCode(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do, and nothing that depends on it.
  }
}

/** The link a user shares. Built from the running origin so it is right on every deploy. */
export function referralLink(code: string): string {
  return `${globalThis.location?.origin ?? 'https://pingochat.pages.dev'}/r/${code}`;
}
