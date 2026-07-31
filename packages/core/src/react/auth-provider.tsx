/**
 * AuthProvider - the composition root for identity.
 *
 * Sits above `ChatProvider` and knows nothing about it. The two boundaries stay
 * separate on purpose: auth answers *who is signed in*, `ChatService` answers
 * *what they can see*. Wiring the session into chat data is a later phase, and
 * keeping them uncoupled now is what makes that a wiring change rather than an
 * unpicking.
 *
 * Unlike `ChatProvider`, `service` is required. There is no `MockAuthService` to
 * fall back to, and defaulting to one would let a missing wire-up look like a
 * signed-out user instead of failing loudly.
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

import type { AuthService, AuthSession } from '../auth-service.js';

/**
 * `loading` is a real third state, not a detail.
 *
 * Restoring a persisted session is asynchronous, and a guard that treats
 * "not known yet" as "signed out" bounces the user to Log In on every refresh.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  service: AuthService;
  session: AuthSession | undefined;
  status: AuthStatus;
  /** Shorthand for `status === 'authenticated'`. */
  signedIn: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  service: AuthService;
  /**
   * Called the first time a session appears.
   *
   * The app uses it to record that this device has completed onboarding, which
   * decides where the splash routes next time
   * ([docs/01 § 3](../../../../docs/01-onboarding-auth.md#3-splash)). A callback
   * rather than a `localStorage` write in here, because core carries no platform
   * assumptions.
   */
  onAuthenticated?: (session: AuthSession) => void;
}

export function AuthProvider({ children, service, onAuthenticated }: AuthProviderProps) {
  const [session, setSession] = useState<AuthSession | undefined>();
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let active = true;

    const apply = (next: AuthSession | null) => {
      if (!active) return;
      setSession(next ?? undefined);
      setStatus(next ? 'authenticated' : 'anonymous');
      if (next) onAuthenticated?.(next);
    };

    /*
     * Subscribe before the first read. The other order has a window where a
     * session established between the read and the subscription is missed  - 
     * rare, but it presents as a sign-in that silently does nothing.
     */
    const unsubscribe = service.onSessionChange(apply);

    void service
      .getSession()
      .then(apply)
      .catch(() => {
        // A failed restore is a signed-out user, not a crash. The screens that
        // need the network will surface their own errors.
        if (active) setStatus('anonymous');
      });

    return () => {
      active = false;
      unsubscribe();
    };
    // `onAuthenticated` is intentionally not a dependency: callers pass an
    // inline function, and re-subscribing on every render would thrash the
    // backend's listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  const signOut = useCallback(async () => {
    await service.signOut();
    // Not set optimistically - `onSessionChange` is the single source of truth,
    // so every tab transitions on the same event.
  }, [service]);

  const value = useMemo<AuthContextValue>(
    () => ({
      service,
      session,
      status,
      signedIn: status === 'authenticated',
      signOut,
    }),
    [service, session, status, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an <AuthProvider>');
  return context;
}
