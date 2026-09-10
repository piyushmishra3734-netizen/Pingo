import { useAuth } from '@pingo/core';
import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { isAddingAccount } from './adding-account.js';
import { guestAuthPath, hasIntroSeen } from './intro-seen.js';
import { PRIVATE_ACCESS, isAllowedAddress, isOpenPath } from './private-access.js';

/**
 * Route guards.
 *
 * Both wait out `status === 'loading'` rather than treating "not known yet" as
 * signed out. Restoring a persisted session is a round-trip, and a guard that
 * redirects during it bounces every refresh through Log In - the single most
 * common bug in this pattern.
 */

/**
 * The session restore, which shows nothing.
 *
 * This used to be three pulsing dots on a brand wash, filling the window. It
 * ran on every single load - restoring a persisted session is a round trip that
 * happens before any route renders - so it was the first thing anybody saw,
 * every time, in front of the splash that was about to say the same thing.
 *
 * The comment above it always said the wait was "normally imperceptible", which
 * is the argument against marking it: a spinner for a wait nobody can perceive
 * is not reassurance, it is a flash. And when the restore is slow, what follows
 * is the splash - a screen built for exactly this - so the marker was never the
 * thing carrying the news.
 *
 * The ground, and nothing on it. `#boot` has already painted this same colour
 * before the bundle arrived, so on a cold start the handover is invisible.
 */
function Resolving() {
  return <div className="h-full bg-page" />;
}

/** Pre-auth funnel: intro slides first, then Welcome or Log In. */
function guestEntryPath(): string {
  if (!hasIntroSeen()) return '/intro';
  return guestAuthPath();
}

/**
 * Wraps everything behind the account.
 *
 * A signed-out visitor goes through the intro (once), then Log In if they have
 * used this device before or Welcome if they have not - the same decision the
 * splash makes ([docs/01 § 3](../../../../../docs/01-onboarding-auth.md#3-splash)).
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Resolving />;

  if (status === 'anonymous') {
    return (
      <Navigate
        to={guestEntryPath()}
        replace
        // Kept so a deep link survives the detour through sign-in.
        state={{ from: location.pathname }}
      />
    );
  }

  return <>{children ?? <Outlet />}</>;
}

/**
 * Wraps the auth screens themselves.
 *
 * Without it, a signed-in user following an old link to `/welcome` would be
 * offered a sign-up flow for the account they are already using.
 */
export function RequireGuest({ children }: { children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  /*
   * One deliberate exception: adding a second account.
   *
   * The guard exists to stop a signed-in person landing back on Welcome, which
   * is right almost always and wrong for exactly one journey - Settings →
   * Switch account → Add account, where being signed in is the *premise* of the
   * request rather than a mistake. Without this the redirect fires instantly
   * and the button appears to do nothing at all, which is how it shipped.
   *
   * `?add=1` is set only by that button. Signing in from here replaces the
   * current session, which is safe because it has already been saved - the
   * switcher brings it back in a tap.
   *
   * The query string alone was not enough. It only survives the screen it is
   * on, and Welcome hands off to `/login` or `/signup` without it - so the
   * guard fired on the very next tap and returned the person to the account
   * they were adding one alongside. The flag carries the intent through the
   * whole flow; the query string stays because it is what makes the first hop
   * work when storage is blocked.
   */
  const addingAccount =
    new URLSearchParams(location.search).get('add') === '1' || isAddingAccount();

  if (status === 'loading') return <Resolving />;
  if (status === 'authenticated' && !addingAccount) return <Navigate to="/chats" replace />;

  // Anonymous guests must finish (or have finished) the five intro slides
  // before Welcome / Log In, so deep links cannot flash auth under the intro.
  if (
    status === 'anonymous' &&
    !hasIntroSeen() &&
    !location.pathname.startsWith('/intro')
  ) {
    return <Navigate to="/intro" replace state={{ from: location.pathname }} />;
  }

  return <>{children ?? <Outlet />}</>;
}

/**
 * The door, while the app is open to one address.
 *
 * Wraps the whole router rather than sitting beside `RequireAuth`, because the
 * question it answers is not "may this person see this screen" but "may this
 * person see the app at all" - and the answer has to be the same on a deep
 * link, a bookmark and a notification tap.
 *
 * ## What it deliberately does not do
 *
 * It does not hide the sign-in screens. An allow list of addresses cannot say
 * anything about somebody until they have proved which address is theirs, and
 * proving it *is* signing in. So the funnel stays open and the check runs after
 * the session exists: reaching `/login` gains nobody anything, because signing
 * in with any other address lands back here.
 *
 * It also does not redirect. A `Navigate` would put the notice in the address
 * bar and the history, so the back button would walk somebody through it twice
 * and a refresh would lose where they were. Rendering in place leaves the URL
 * alone, so the moment the flag comes off, everything resumes where it was.
 */
export function PrivateAccessGate({ children }: { children?: ReactNode }) {
  const { status, session } = useAuth();
  const location = useLocation();

  if (!PRIVATE_ACCESS) return <>{children ?? <Outlet />}</>;

  // Same reason as the guards above: "not known yet" is not "not allowed".
  if (status === 'loading') return <Resolving />;

  if (isAllowedAddress(session?.user.email)) return <>{children ?? <Outlet />}</>;
  if (isOpenPath(location.pathname)) return <>{children ?? <Outlet />}</>;

  return <SentToMaintenance />;
}

/**
 * Everybody who is not on the list gets the maintenance page.
 *
 * The real one, in `public/maintenance.html`, rather than a React screen that
 * looks like it: it is the page that was drawn for this, it is already deployed,
 * and having one notice instead of two means there is one place to change the
 * words. Cloudflare Pages serves it at `/maintenance` - it strips the `.html`
 * and redirects, so asking for the file name costs a round trip.
 *
 * `replace`, not `assign`: the app must not be left in the history behind the
 * notice, or Back walks into a screen the visitor is not allowed to see and the
 * gate has to catch them again.
 *
 * Nothing is rendered in the meantime. The redirect is immediate, and a flash
 * of a half-built screen on the way out is worse than a blank one.
 */
function SentToMaintenance() {
  useEffect(() => {
    window.location.replace('/maintenance');
  }, []);

  return null;
}
