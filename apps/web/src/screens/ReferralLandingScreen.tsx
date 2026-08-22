import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { rememberReferralCode } from '../features/referrals/referral-code.js';

/**
 * Where a referral link lands, and the only thing it does.
 *
 * ## Why there is no screen here
 *
 * The obvious version of this page welcomes you by name: "Piyush invited you to
 * PINGO". That needs the server to hand a display name to somebody with no
 * account, from nothing but a code - which turns every code into a lookup for
 * whoever holds it, and codes are short enough to be worth guessing at that
 * point. The invitation is not worth an endpoint that returns strangers' names
 * to strangers.
 *
 * So this records who invited you and steps out of the way. The splash already
 * knows where a visitor belongs - Home with a session, Log In if this device has
 * onboarded before, Welcome if it has not - and duplicating that decision here
 * would be a second router to keep in step with the first.
 *
 * ## Before authentication, deliberately
 *
 * The route is public. A referral link is for somebody who does not have an
 * account yet, and putting it behind the auth guard would send exactly the
 * person it is for to a login screen with the code already thrown away.
 *
 * `/r/` rather than `/join/`: `/join/:code` is group invitations and has been
 * since groups shipped. Two meanings for one path is a bug waiting for the
 * first person who is invited to both.
 */
export function ReferralLandingScreen() {
  const { code } = useParams<{ code: string }>();

  /*
   * Written in an effect rather than during render: storing is a side effect,
   * and React may render this twice before it commits. Writing twice is
   * harmless here - the first code wins either way - but a component that
   * writes to storage while rendering is a habit that stops being harmless
   * somewhere else.
   */
  useEffect(() => {
    rememberReferralCode(code);
  }, [code]);

  return <Navigate to="/" replace />;
}

export default ReferralLandingScreen;
