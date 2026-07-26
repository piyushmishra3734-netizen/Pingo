import { AuthError, type AuthErrorCode } from '@pingo/core';

/**
 * Failure copy, in one place.
 *
 * Screens branch on `AuthError.code` and render the string this returns, so the
 * wording of a failure is a product decision rather than something each screen
 * improvises. The tone rules come from docs/01 and are worth restating, because
 * they are easy to undo one well-meant edit at a time:
 *
 * - **Never blame.** "That password doesn't match" — not "incorrect password".
 * - **Never confirm or deny that an account exists** *at sign-in*. § 13.2: an
 *   unknown identity and a wrong password produce the same message. Telling a
 *   stranger "no account with this number" is an enumeration oracle.
 * - **Say what is happening and why.** § 13.2 surfaces rate limiting honestly —
 *   a user who does not know they are throttled assumes the app is broken.
 * - **Never a blocking dialog** (§ 19). Every one of these is an inline caption.
 *
 * `identity_exists` is the deliberate exception to the second rule. It only
 * happens at *sign-up*, where § 17 requires routing the user to Log In rather
 * than silently creating a second account — and a duplicate account in a
 * messaging product is unrecoverable, because the wrong one holds the
 * conversations. The trade is made knowingly and only in that one direction.
 */

/**
 * The offline line from § 19, exact.
 *
 * "We'll retry when you're back" is a promise the screens keep by preserving the
 * input rather than clearing it.
 */
export const OFFLINE_MESSAGE = "You're offline. We'll retry when you're back.";

/** § 17's copy for an identifier that already has an account. */
export const ALREADY_REGISTERED_MESSAGE = "Looks like you're already with us.";

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * @param context which screen is asking — the same code reads differently under
 * a password field than beneath a Google row.
 */
export function authErrorMessage(
  error: unknown,
  context: 'signIn' | 'signUp' | 'oauth' = 'signIn',
): string {
  const code: AuthErrorCode = error instanceof AuthError ? error.code : 'unknown';
  const retryAfter = error instanceof AuthError ? error.retryAfterSeconds : undefined;

  switch (code) {
    case 'offline':
      return OFFLINE_MESSAGE;

    case 'invalid_credentials':
      // § 13.2's copy, minus its "or recover your account" clause: account
      // recovery (§ 14–16) is not built yet, and pointing at a path that does
      // not exist is worse than saying less.
      return "That password doesn't match. Try again.";

    case 'identity_exists':
      return ALREADY_REGISTERED_MESSAGE;

    case 'identity_unconfirmed':
      /*
       * An operator's problem wearing a user's clothes: the backend wants a
       * confirmation step this product does not have. It happens to accounts
       * created while "Confirm email" was still on — their password is correct
       * and they still cannot get in.
       *
       * So the copy does the one thing that helps: **tells them it is not their
       * password**, so they stop retyping it and stop resetting it. The fix is a
       * dashboard action, and naming it here would only hand a user an
       * instruction they cannot act on — that detail goes to the console for
       * whoever is actually looking (see `assertSession`).
       */
      return "Your password is fine — this account just can't be signed into yet. Try another method, or use a new one.";

    case 'provider_disabled':
      return 'That sign-in method is switched off for this project.';

    case 'signup_disabled':
      return 'New accounts are switched off for this project.';

    case 'invalid_identifier':
      return context === 'signUp'
        ? "That doesn't look like a valid email or number."
        : "That doesn't look right. Check it and try again.";

    case 'weak_password':
      return 'Pick a stronger password.';

    case 'cancelled':
      // The user backed out of a consent screen. § 19: "nothing created,
      // nothing said" — so this is near-silent by design.
      return '';

    case 'rate_limited':
      return retryAfter
        ? `Too many attempts. Try again in ${formatCountdown(retryAfter)} — this protects your account.`
        : 'Too many attempts. Wait a few minutes and try again — this protects your account.';

    default:
      return context === 'oauth'
        ? "We couldn't reach Google. Try again."
        : context === 'signUp'
          ? "We couldn't create your account. Try again."
          : "We couldn't sign you in. Try again.";
  }
}
