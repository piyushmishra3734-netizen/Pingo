import { useAuth } from '@pingo/core';
import { PingoDot } from '@pingo/ui';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { isAddingAccount } from './adding-account.js';
import { guestAuthPath, hasIntroSeen } from './intro-seen.js';

/**
 * Route guards.
 *
 * Both wait out `status === 'loading'` rather than treating "not known yet" as
 * signed out. Restoring a persisted session is a round-trip, and a guard that
 * redirects during it bounces every refresh through Log In - the single most
 * common bug in this pattern.
 */

/** Shown only during the session restore, which is normally imperceptible. */
function Resolving() {
  return (
    <div className="grid h-full place-items-center bg-brand-wash">
      <PingoDot state="loading" size={7} label="Loading" />
    </div>
  );
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
