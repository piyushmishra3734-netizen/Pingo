import { useAuth } from '@pingo/core';
import { useNavigate } from 'react-router-dom';

import { FunnelBackdrop } from '../features/auth/FunnelBackdrop.js';
import { FunnelTextLink } from '../features/auth/FunnelCta.js';

/**
 * What everybody except the allow list sees while the app is being checked.
 *
 * Deliberately not the `maintenance.html` page. That one says the app is off,
 * which was true for two days and is not true now - it is running, on a new
 * database, and being looked at before the door opens. Telling somebody it is
 * down when it is not is the kind of small lie that costs the next honest
 * notice its credibility.
 *
 * ## Two doors, depending on who is reading it
 *
 * Signed out, the way forward is to sign in - the allow list is on addresses,
 * so there is nothing to check until there is a session. Signed in as somebody
 * else, the only useful action is to leave, so the offer is to sign out rather
 * than to try again with the same account that just failed.
 */
export function PrivateAccessScreen() {
  const { signedIn, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <FunnelBackdrop>
      <div className="grid h-full place-items-center px-6">
        <div className="flex w-full max-w-[24rem] flex-col items-center text-center">
          <h1 className="text-title font-semibold text-ink">Not open yet.</h1>

          <p className="mt-3 text-body text-text-secondary">
            PINGO has just moved to a new home. It is running, and being checked
            over before everyone comes back in.
          </p>

          <p className="mt-2 text-caption text-text-tertiary">
            Nothing is broken. This one was planned.
          </p>

          <div className="mt-8">
            {signedIn ? (
              <FunnelTextLink onClick={() => void signOut()}>
                Sign out
              </FunnelTextLink>
            ) : (
              <FunnelTextLink onClick={() => navigate('/login')}>
                Sign in
              </FunnelTextLink>
            )}
          </div>
        </div>
      </div>
    </FunnelBackdrop>
  );
}
