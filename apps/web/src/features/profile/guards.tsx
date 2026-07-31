import { useProfile } from '@pingo/core';
import { PingoDot } from '@pingo/ui';
import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

/**
 * Keeps a half-finished account out of the product.
 *
 * Signing up creates the *account*; the setup steps create the **profile**. In
 * between there is a real state - signed in, but with no name and no handle  - 
 * and a user in it cannot be shown to anyone they talk to.
 *
 * This guard is what resolves that state, and it matters beyond the happy path:
 * someone who closes the tab on the username screen and returns a week later is
 * still signed in, and lands back on the step they left rather than in a
 * product that has no name for them.
 *
 * Runs *inside* `RequireAuth`, so by here the session is settled and the only
 * question left is the profile.
 */

function Resolving() {
  return (
    <div className="grid h-full place-items-center bg-brand-wash">
      <PingoDot state="loading" size={7} label="Loading" />
    </div>
  );
}

export function RequireProfile({ children }: { children?: ReactNode }) {
  const { profile, ready } = useProfile();

  // `ready` false, or a read that failed and left the profile unknown. Waiting
  // is right either way - treating "unknown" as "missing" would push a complete
  // user back through setup on nothing more than a flaky connection.
  if (!ready || profile === undefined) return <Resolving />;

  if (profile === null) return <Navigate to="/setup/name" replace />;

  return <>{children ?? <Outlet />}</>;
}
