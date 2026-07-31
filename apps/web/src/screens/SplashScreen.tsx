import { useAuth } from '@pingo/core';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { ONBOARDED_KEY, hasOnboarded } from '../features/auth/onboarded.js';

/**
 * Splash.
 *
 * The supplied artwork, shown full screen. Nothing is drawn on top of it and
 * nothing is reconstructed - `public/pingo-splash.jpg` is the screen.
 *
 * ## Why the image is contained, not cropped
 *
 * The artwork is 16:9 with the wordmark running across its middle third. Under
 * `object-fit: cover` a portrait phone would keep only a narrow vertical band  - 
 * about 500px of the 1600px width - which slices the wordmark down to "NG".
 * So it is `contain`, on a ground sampled from the artwork's own edges, and the
 * mark survives at every aspect ratio.
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
 * | Onboarded, no session | Log In |
 * | Never onboarded | Welcome |
 */

/** Comfortably inside the 2s ceiling, and long enough for the mark to register. */
const DWELL_MS = 1800;

/** Sampled from the artwork's edges, so the letterbox bands are seamless. */
const SPLASH_GROUND = '#EDECFB';

export function SplashScreen() {
  const navigate = useNavigate();
  const { status } = useAuth();

  /*
   * Read through a ref so the timer sees the latest status without restarting
   * every time it changes - a `status` dependency would reset the dwell on each
   * transition and make the splash outstay its ceiling.
   */
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const timer = setTimeout(() => {
      const current = statusRef.current;

      if (current === 'anonymous') {
        navigate(hasOnboarded() ? '/login' : '/welcome', { replace: true });
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
        Two pieces of artwork, one per shape of screen.

        The landscape image is 16:9 and was the only one, so a portrait phone
        got it letterboxed with empty bands above and below - the desktop
        splash, on mobile. The official mobile artwork is portrait and is used
        as drawn; neither file is recomposed here, they are simply chosen
        between.

        `object-cover` rather than `contain`, now that the aspect ratio roughly
        matches the screen in both cases. Contain guarantees empty bands
        whenever the fit is not exact, and both images carry a wide soft margin
        around the logo, so filling the screen crops only gradient.
      */}
      <picture className="h-full w-full">
        <source media="(orientation: portrait)" srcSet="/pingo-splash-mobile.png" />
        <img
          src="/pingo-splash.jpg"
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
