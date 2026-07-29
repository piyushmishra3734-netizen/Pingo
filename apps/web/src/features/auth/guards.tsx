import { useAuth } from '@pingo/core';
import { PingoDot } from '@pingo/ui';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { hasOnboarded } from './onboarded.js';

/**
 * Route guards.
 *
 * Both wait out `status === 'loading'` rather than treating "not known yet" as
 * signed out. Restoring a persisted session is a round-trip, and a guard that
 * redirects during it bounces every refresh through Log In — the single most
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

/**
 * Wraps everything behind the account.
 *
 * A signed-out visitor goes to Log In if they have used this device before and
 * to Welcome if they have not — the same three-way decision the splash makes
 * ([docs/01 § 3](../../../../../docs/01-onboarding-auth.md#3-splash)).
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Resolving />;

  if (status === 'anonymous') {
    return (
      <Navigate
        to={hasOnboarded() ? '/login' : '/welcome'}
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
   * is right almost always and wrong for exactly one journey — Settings →
   * Switch account → Add account, where being signed in is the *premise* of the
   * request rather than a mistake. Without this the redirect fires instantly
   * and the button appears to do nothing at all, which is how it shipped.
   *
   * `?add=1` is set only by that button. Signing in from here replaces the
   * current session, which is safe because it has already been saved — the
   * switcher brings it back in a tap.
   */
  const addingAccount = new URLSearchParams(location.search).get('add') === '1';

  if (status === 'loading') return <Resolving />;
  if (status === 'authenticated' && !addingAccount) return <Navigate to="/chats" replace />;

  return <>{children ?? <Outlet />}</>;
}
