/**
 * ProfileProvider - the composition root for display identity.
 *
 * Sits inside `AuthProvider`, because a profile only exists for a signed-in
 * user. It loads once the session appears and clears when it goes, so a
 * sign-out cannot leave the previous person's name on screen.
 *
 * `profile === null` after loading is meaningful, not an error: it is a user who
 * has an account but has not finished sign-up. That is exactly the state the
 * name / username / photo steps exist to resolve, and the route guard reads it
 * to decide whether to send someone there.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Profile, ProfileDraft, ProfileService } from '../profile-service.js';
import { useAuth } from './auth-provider.js';

interface ProfileContextValue {
  service: ProfileService;
  /** `undefined` while loading, `null` when sign-up has not created one yet. */
  profile: Profile | null | undefined;
  /** False until the first load settles for the current session. */
  ready: boolean;
  /** Writes the profile and puts it in context in one step. */
  create: (draft: ProfileDraft) => Promise<Profile>;
  update: (changes: Partial<ProfileDraft>) => Promise<Profile>;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

export function ProfileProvider({
  children,
  service,
}: {
  children: ReactNode;
  service: ProfileService;
}) {
  const { signedIn, session } = useAuth();
  const [profile, setProfile] = useState<Profile | null | undefined>();
  const [ready, setReady] = useState(false);

  const userId = session?.user.id;

  useEffect(() => {
    if (!signedIn) {
      setProfile(undefined);
      setReady(true);
      return;
    }

    let active = true;
    setReady(false);

    void service
      .getMine()
      .then((next) => {
        if (active) setProfile(next);
      })
      .catch(() => {
        // A failed read is not "no profile" - saying so would push a complete
        // user back through sign-up. Left undefined so the guard waits instead.
        if (active) setProfile(undefined);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
    // Keyed on the user, so switching accounts reloads rather than reusing.
  }, [service, signedIn, userId]);

  const create = useCallback(
    async (draft: ProfileDraft) => {
      const next = await service.create(draft);
      setProfile(next);
      return next;
    },
    [service],
  );

  const update = useCallback(
    async (changes: Partial<ProfileDraft>) => {
      const next = await service.update(changes);
      setProfile(next);
      return next;
    },
    [service],
  );

  const refresh = useCallback(async () => {
    setProfile(await service.getMine());
  }, [service]);

  const value = useMemo<ProfileContextValue>(
    () => ({ service, profile, ready, create, update, refresh }),
    [service, profile, ready, create, update, refresh],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfile must be used inside a <ProfileProvider>');
  return context;
}
