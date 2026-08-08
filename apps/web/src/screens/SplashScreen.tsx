import { useAuth } from '@pingo/core';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ONBOARDED_KEY } from '../features/auth/onboarded.js';
import {
  loadSplashUrls,
  localSplashUrl,
} from '../lib/supabase/onboarding-slides.js';

/**
 * Splash.
 *
 * Full-screen art only — PC and mobile variants. Defaults to shipped files
 * (`/pingo-splash.jpg` / `/pingo-splash-mobile.png`); `@piuxxh` can replace
 * them from Settings → Controlling without a redesign pass.
 *
 * ## The dwell is a ceiling
 *
 * It never waits for the session check. If auth has not resolved by the time
 * the timer fires, this routes to Home and lets Home show its own loading
 * state - a splash that waits for the network is a splash that hangs on a bad
 * connection ([11 § 1.1](../../../../docs/11-performance-budget.md#11-the-splash-is-a-ceiling-not-a-spinner)).
 *
 * | Condition | Destination |
 * | --- | --- |
 * | Valid session | Home |
 * | Anonymous | Intro slides (Skip only if this device has seen them / had an account) |
 */

/** Comfortably inside the 2s ceiling, and long enough for the mark to register. */
const DWELL_MS = 1800;

/** Sampled from the default artwork's edges, so letterbox bands stay seamless. */
const SPLASH_GROUND = '#EDECFB';

export function SplashScreen() {
  const navigate = useNavigate();
  const { status } = useAuth();

  const [desktopSrc, setDesktopSrc] = useState(() => localSplashUrl('desktop'));
  const [mobileSrc, setMobileSrc] = useState(() => localSplashUrl('mobile'));

  /*
   * Read through a ref so the timer sees the latest status without restarting
   * every time it changes - a `status` dependency would reset the dwell on each
   * transition and make the splash outstay its ceiling.
   */
  const statusRef = useRef(status);
  statusRef.current = status;

  // Operator uploads win when present; fail open to shipped art.
  useEffect(() => {
    let cancelled = false;
    void loadSplashUrls().then((urls) => {
      if (cancelled) return;
      setDesktopSrc(urls.desktop);
      setMobileSrc(urls.mobile);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const current = statusRef.current;

      if (current === 'anonymous') {
        // Always open the five intro slides after splash for signed-out users.
        // First-time: no Skip. Returning / logged-out: Skip is available on that screen.
        navigate('/intro', { replace: true });
        return;
      }

      // Authenticated, or still resolving. Either way Home is correct: the
      // route guard finishes the check and redirects if it has to.
      navigate('/chats', { replace: true });
    }, DWELL_MS);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div
      className="grid h-full w-full place-items-center overflow-hidden"
      style={{ backgroundColor: SPLASH_GROUND }}
    >
      {/*
        Two artworks, one per shape of screen. Remote operator uploads (when
        set) replace the shipped files; neither is stretched across the wrong
        form factor — `picture` picks mobile vs desktop.
      */}
      <picture className="h-full w-full">
        <source media="(orientation: portrait)" srcSet={mobileSrc} />
        <img
          src={desktopSrc}
          alt="PINGO. Connect. Privately."
          width={1600}
          height={900}
          decoding="async"
          fetchPriority="high"
          draggable={false}
          className="h-full w-full select-none object-cover animate-fade-in"
        />
      </picture>
    </div>
  );
}

/**
 * Re-exported from its new home in `features/auth/onboarded.ts`.
 *
 * The flag outgrew this screen - the guards and the auth provider both need it  - 
 * but it is still exported here so nothing that imported it has to change.
 */
export { ONBOARDED_KEY };
