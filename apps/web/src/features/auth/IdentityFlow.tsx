import { createContext, useContext, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { COUNTRIES } from './countries.js';

/**
 * Carries the identifier across the two steps of one flow.
 *
 * Both credential doors are *identifier → password*, and the password screen
 * needs whatever the first screen collected. A route layout owns it because that
 * gives the value exactly the lifetime of the flow: it survives moving between
 * steps, and it is gone the moment the user leaves for Home or Welcome.
 *
 * One context serves email and phone, which is what lets `CreatePasswordScreen`
 * and `LoginPasswordScreen` each exist once instead of twice. The screens never
 * branch on `kind` for behaviour - only for the label they show back to the user.
 *
 * Not in the URL. `/signup/password?email=…` would put an address or a phone
 * number in browser history, referrers and any analytics that records paths  - 
 * and the privacy rules forbid personal data in query strings.
 *
 * The cost is that a hard refresh mid-flow loses it. That is handled honestly: a
 * step reached without an identifier redirects to the start rather than
 * rendering a screen that cannot work.
 */

export interface Identity {
  /**
   * `username` is a log-in-only kind. Sign-up never produces one - a username
   * is chosen after the account exists - so `CreatePasswordScreen` refuses it
   * rather than pretending there is a `username.signUp` to call.
   */
  kind: 'email' | 'phone' | 'username';
  /** An address, a number in E.164 (`+919876543210`), or a handle. */
  value: string;
}

interface IdentityFlowValue {
  identity: Identity | undefined;
  setIdentity: (identity: Identity) => void;
}

const IdentityFlowContext = createContext<IdentityFlowValue | undefined>(undefined);

export interface IdentityFlowProps {
  /** The steps that collect an identifier, and so may render without one. */
  entryPaths: readonly string[];
  /** Where a later step lands when it is reached with nothing to work on. */
  fallback: string;
}

export function IdentityFlow({ entryPaths, fallback }: IdentityFlowProps) {
  const location = useLocation();

  /*
   * Seeded from router state so one flow can hand an identifier to another. The
   * § 17 collision does exactly that: sign-up discovers the identifier is taken
   * and sends the user to Log In *with it*, rather than making them type it a
   * second time to reach the screen they should have been on.
   *
   * Router state travels in the history entry, not the URL, so this stays off
   * the address bar.
   */
  const handedOver = (location.state as { identity?: Identity } | null)?.identity;
  const [identity, setIdentity] = useState<Identity | undefined>(handedOver);

  const value = useMemo<IdentityFlowValue>(() => ({ identity, setIdentity }), [identity]);

  const atEntry = entryPaths.includes(location.pathname);
  if (!atEntry && !identity) {
    return <Navigate to={fallback} replace />;
  }

  return (
    <IdentityFlowContext.Provider value={value}>
      <Outlet />
    </IdentityFlowContext.Provider>
  );
}

export function useIdentityFlow(): IdentityFlowValue {
  const context = useContext(IdentityFlowContext);
  if (!context) throw new Error('useIdentityFlow must be used inside an <IdentityFlow> route');
  return context;
}

/**
 * How an identifier is shown back to the user - the recap line in § 13.2.
 *
 * Phone numbers get spaced after the country code so a long run of digits is
 * scannable; addresses are shown as typed, because breaking one up would make it
 * harder to confirm, not easier.
 *
 * The dial code is found by matching against `COUNTRIES`, **longest first**.
 * A regex cannot do this: dial codes are a variable-length prefix code, so
 * `+919876543210` reads as `+91` (India) or `+919…` depending only on which
 * codes exist. Guessing with `\d{1,3}` renders `+91 98765 43210` as
 * `+919 87654 3210` - the country wrong and every group shifted by one.
 */
export function formatIdentity(identity: Identity): string {
  if (identity.kind === 'email') return identity.value;
  if (identity.kind === 'username') return `@${identity.value}`;

  const dial = [...COUNTRIES]
    .map((country) => country.dial)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => identity.value.startsWith(candidate));

  if (!dial) return identity.value;

  const national = identity.value.slice(dial.length);
  const grouped = national.replace(/(\d{5})(?=\d)/g, '$1 ');
  return `${dial} ${grouped}`;
}
