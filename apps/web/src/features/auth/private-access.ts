/**
 * Who is allowed in. Currently: everybody. PINGO is open.
 *
 * This gate was built for the window after the move to the new Supabase
 * project, when the database, the files and the functions all matched from the
 * outside but nobody had yet opened a real account on a real phone and found
 * their history where they left it. That has happened, so the gate is off.
 *
 * It is kept rather than deleted because the next time something needs
 * checking over on production - a migration, a provider swap, an incident - the
 * switch is one line and the reasoning below is already written down.
 *
 * ## Why the allow list is the gate, and not a secret URL
 *
 * The sign-in screens stay reachable. They have to: an allow list of email
 * addresses can only work once somebody has proved which address is theirs, and
 * proving it is what signing in *is*. So there is no hidden path and no secret
 * to leak. Finding the login page gains nothing - signing in with any other
 * address lands on the same notice as before, because the check runs after the
 * session exists, not before.
 *
 * That is worth being explicit about because the tempting version - hide
 * `/login` and tell nobody - reads as security and is not: it is one shared
 * URL away from being over, and it locks out the person it was built for the
 * moment they forget it.
 *
 * ## Turning it off
 *
 * `PRIVATE_ACCESS` to `false`. Nothing else changes; the guard becomes a
 * pass-through and the notice screen is never rendered.
 */

/** The one switch. `false` opens the app to everybody. */
export const PRIVATE_ACCESS = false;

/**
 * Addresses that may use the app while `PRIVATE_ACCESS` is on.
 *
 * Compared case-insensitively and trimmed, because an address typed on a phone
 * keyboard arrives capitalised often enough that the alternative is locking
 * yourself out and not understanding why.
 */
const ALLOWED = ['piyushmishra3734@gmail.com'];

export function isAllowedAddress(email: string | undefined): boolean {
  if (!PRIVATE_ACCESS) return true;
  if (!email) return false;
  return ALLOWED.includes(email.trim().toLowerCase());
}

/**
 * Paths that stay open regardless.
 *
 * Everything needed to establish who you are, and nothing else. `/auth/google`
 * is here because it is the return leg of the OAuth redirect - without it the
 * gate would catch the journey halfway and the session would never land.
 */
const OPEN_PATHS = [
  '/intro',
  '/welcome',
  '/login',
  '/signup',
  /*
   * The return leg of the Google redirect. Without it the gate catches the
   * journey halfway and the session never lands, so the one account that is
   * allowed in could never get in.
   */
  '/auth',
  /*
   * The privacy policy is a promise made to people, and a promise that is only
   * readable by people already allowed inside is not much of one. It costs
   * nothing to leave up and it is the page somebody checks precisely when they
   * cannot get in.
   */
  '/privacy',
];

export function isOpenPath(pathname: string): boolean {
  return OPEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
