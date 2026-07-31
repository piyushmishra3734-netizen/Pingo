import { createContext, useContext, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

/**
 * Carries the profile across its four setup steps.
 *
 * Name → Username → Photo → Permissions. The same pattern as `IdentityFlow`:
 * a route layout owns the draft, so it lives exactly as long as the flow and is
 * gone the moment the user reaches Home.
 *
 * ## Where the row actually gets written
 *
 * **At the username step**, not at the end. Name and username are the two
 * required fields, so the moment both exist there is a complete profile worth
 * saving - and a user who closes the tab on the photo screen keeps their
 * account instead of losing it.
 *
 * Photo and notifications are then *edits* to a profile that already exists,
 * which is why both can be skipped without leaving anything half-written.
 */

interface ProfileDraftState {
  displayName: string;
  setDisplayName: (name: string) => void;
}

const ProfileSetupContext = createContext<ProfileDraftState | undefined>(undefined);

/** Steps that may be entered without a name already collected. */
const ENTRY_PATHS = ['/setup/name'];

/**
 * Steps that come *after* the profile row exists, so they no longer need the
 * in-memory draft and survive a refresh on their own.
 */
const POST_CREATE_PATHS = ['/setup/photo', '/setup/permissions'];

export function ProfileSetupFlow() {
  const [displayName, setDisplayName] = useState('');
  const location = useLocation();

  const value = useMemo<ProfileDraftState>(
    () => ({ displayName, setDisplayName }),
    [displayName],
  );

  const needsDraft =
    !ENTRY_PATHS.includes(location.pathname) && !POST_CREATE_PATHS.includes(location.pathname);

  if (needsDraft && displayName === '') {
    return <Navigate to="/setup/name" replace />;
  }

  return (
    <ProfileSetupContext.Provider value={value}>
      <Outlet />
    </ProfileSetupContext.Provider>
  );
}

export function useProfileSetup(): ProfileDraftState {
  const context = useContext(ProfileSetupContext);
  if (!context) throw new Error('useProfileSetup must be used inside a <ProfileSetupFlow> route');
  return context;
}
