/**
 * Password rules - the product's, not the backend's.
 *
 * Lives in core beside `format.ts` for the same reason: these are decisions from
 * [docs/01 § 8](../../../docs/01-onboarding-auth.md#8-create-password), and they
 * must read identically on web and on a future mobile client. A screen renders
 * the result; it never re-implements the rule.
 */

/**
 * The three requirements shown in the live checklist.
 *
 * `id` is stable so the UI can key on it; `label` is shipping copy, straight
 * from the wireframe.
 */
export interface PasswordRequirement {
  id: 'length' | 'not-common' | 'letters-and-numbers';
  label: string;
  met: boolean;
}

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordAssessment {
  requirements: PasswordRequirement[];
  /** True only when every requirement is met. Gates the Continue button. */
  valid: boolean;
  strength: PasswordStrength;
  /** 0-4, for the four-segment meter. */
  score: number;
  /** The meter's caption: `Weak` · `Fair` · `Good` · `Strong`. */
  strengthLabel: string;
}

/** § 8: ten, not eight. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * The blueprint calls for a breached-password list, which is a server-side
 * dataset - k-anonymity range queries against a corpus of millions, not
 * something to ship in a bundle.
 *
 * This is the client-side half: the handful of passwords common enough that
 * letting a user type one and *then* rejecting it server-side would be a worse
 * experience than catching it here. It is a fast fail, not the real check, and
 * the real check belongs behind the auth backend before launch.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'qwerty1234',
  'iloveyou1',
  'letmein123',
  'welcome123',
  'admin12345',
  'abc123456789',
  'football123',
  'sunshine123',
  'princess123',
  'monkey12345',
  'trustno1234',
  'dragon12345',
  'baseball123',
]);

function isCommon(password: string): boolean {
  const normalised = password.toLowerCase().trim();
  if (COMMON_PASSWORDS.has(normalised)) return true;

  // A single repeated character or a straight keyboard run is common in spirit
  // even when it is not in the list - `aaaaaaaaaa` passes a length check and
  // nothing else.
  if (/^(.)\1+$/.test(normalised)) return true;
  if (/^(0123456789|1234567890|abcdefghij)/.test(normalised)) return true;

  return false;
}

/**
 * Assess a password against the live checklist.
 *
 * Called on every keystroke, so it stays cheap - no async, no network.
 */
export function assessPassword(password: string): PasswordAssessment {
  const requirements: PasswordRequirement[] = [
    {
      id: 'length',
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      met: password.length >= MIN_PASSWORD_LENGTH,
    },
    {
      id: 'not-common',
      label: 'Not a common password',
      // An empty field has not *failed* this, but showing it met before anything
      // is typed would be a lie the user can see through.
      met: password.length > 0 && !isCommon(password),
    },
    {
      id: 'letters-and-numbers',
      label: 'Letters and numbers',
      met: /[a-z]/i.test(password) && /\d/.test(password),
    },
  ];

  const valid = requirements.every((r) => r.met);

  /*
   * Strength is not the checklist. A password can satisfy all three rules and
   * still be short, so length beyond the minimum and character variety both
   * earn credit - otherwise the meter would jump to full the instant the last
   * box ticks and stop telling the user anything.
   */
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^\w\s]/.test(password)) score += 1;
  if (isCommon(password)) score = Math.min(score, 1);
  if (password.length === 0) score = 0;

  const strength: PasswordStrength =
    score >= 4 ? 'strong' : score === 3 ? 'good' : score === 2 ? 'fair' : 'weak';

  const strengthLabel = strength.charAt(0).toUpperCase() + strength.slice(1);

  return { requirements, valid, strength, score, strengthLabel };
}

/**
 * Structural email validation - § 6.1, *"structural only on this screen"*.
 *
 * Existence is proven by the code that gets sent to it, so this rejects only
 * what could not possibly be an address. Anything cleverer produces false
 * negatives on valid, unusual addresses, which is a worse failure than letting
 * a typo through to a verification step that will catch it anyway.
 */
export function isStructurallyValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(trimmed);
}

/**
 * Structural phone validation - § 6.2, *"disabled until structurally valid for
 * that country"*.
 *
 * Takes the full E.164 string (`+919876543210`), which is what the backend
 * wants and what the field assembles from its country pill and digits.
 *
 * Length is checked as a range rather than per-country: national number lengths
 * run from 4 to 14 digits across the ITU plan, and a per-country table would be
 * wrong more often than it was right without a real metadata library. Being
 * permissive here is the correct direction - a number that is genuinely wrong
 * fails at the backend, whereas a valid number wrongly rejected by our own
 * regex leaves the user with no way forward at all.
 */
export function isStructurallyValidPhone(e164: string): boolean {
  const trimmed = e164.trim();
  // E.164: a plus, a non-zero country digit, then up to 14 more.
  return /^\+[1-9]\d{6,14}$/.test(trimmed);
}

/** Strips everything a person might type into a number field but E.164 forbids. */
export function normalisePhoneDigits(input: string): string {
  return input.replace(/\D/g, '');
}
