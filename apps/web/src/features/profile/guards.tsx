import { useProfile } from '@pingo/core';
import { ConversationSkeleton } from '@pingo/ui';
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

/**
 * What fills the screen while the profile is read.
 *
 * This was three pulsing dots centred on a brand wash, and it is the last thing
 * standing between the splash and the chat list - so on a cold start it was
 * what people actually watched, after a splash that had already said the app
 * was here.
 *
 * It is a skeleton now, of the shape that is coming, sweeping the same way the
 * boot shell in `index.html` sweeps before React has mounted at all. That is
 * the point: `#boot` already painted this exact thing a moment earlier, so
 * where it applies the handover is invisible rather than a cut from a list to
 * a spinner and back to a list.
 *
 * The route test is copied from `#boot` deliberately, and the reasoning with
 * it: a chat-list skeleton over Settings would be a lie about what is coming,
 * and on those routes the ground alone is still better than a spinner.
 */
const LIST_ROUTES = /^\/(chats|calls|communities|notifications|profile|settings)/;

function Resolving() {
  const listIsComing =
    typeof window !== 'undefined' && LIST_ROUTES.test(window.location.pathname);

  return (
    <div className="h-full overflow-hidden bg-page">
      {listIsComing && (
        <div className="mx-auto w-full max-w-2xl px-3 pt-3">
          <ConversationSkeleton rows={7} />
        </div>
      )}
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
