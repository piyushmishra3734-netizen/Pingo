import { useAuth, useChat } from '@pingo/core';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { ONBOARDED_KEY } from '../features/auth/onboarded.js';
import { useSplashHold } from '../features/loading/splash.js';

/**
 * `/` - the route that decides where opening the app takes you.
 *
 * It draws nothing of its own. The splash is index.html's: the PINGO mark,
 * painted in the first frame, and this screen only holds it up
 * (`useSplashHold`) until it knows the answer - the intro for somebody signed
 * out, the chats once they are ready for somebody signed in.
 *
 * ## What this replaced
 *
 * A full-screen image, the operator's splash artwork, with a 2.2 second minimum
 * and a 600ms hold after its pixels arrived. On a slow connection the image was
 * the slowest thing on the page, so the screen either waited for it or left
 * before it had shown anything; and on a fast one every launch paid 2.2 seconds
 * for nothing. The mark needs no download, so neither clock is needed: this
 * stays exactly as long as the app takes to open.
 */

/** Never stay longer than this: a chat service that never becomes ready must not trap anybody here. */
const HARD_MAX_MS = 7000;

export function SplashScreen() {
  const navigate = useNavigate();
  /*
   * `ChatProvider` wraps this route, so whether the app behind it has finished
   * opening is simply readable. Leaving before it had would hand over to
   * `AppShell`'s own loader - two waits for one.
   */
  const { ready: chatReady } = useChat();
  const { status } = useAuth();
  const left = useRef(false);
  useSplashHold();

  const where = status === 'anonymous' ? '/intro' : '/chats';
  const ready = status === 'anonymous' || (status !== 'loading' && chatReady);
  const whereRef = useRef(where);
  whereRef.current = where;

  useEffect(() => {
    if (!ready || left.current) return;
    left.current = true;
    navigate(where, { replace: true });
  }, [navigate, ready, where]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (left.current) return;
      left.current = true;
      navigate(whereRef.current, { replace: true });
    }, HARD_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [navigate]);

  return <div className="h-full w-full bg-page" aria-hidden />;
}

/**
 * Re-exported from its new home in `features/auth/onboarded.ts`.
 *
 * The flag outgrew this screen - the guards and the auth provider both need it  - 
 * but it is still exported here so nothing that imported it has to change.
 */
export { ONBOARDED_KEY };
