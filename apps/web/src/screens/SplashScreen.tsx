import { useAuth } from '@pingo/core';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ONBOARDED_KEY } from '../features/auth/onboarded.js';
import {
  loadSplashUrls,
  preloadImage,
  type SplashUrls,
} from '../lib/supabase/onboarding-slides.js';

/**
 * Splash.
 *
 * Full-screen art only — PC and mobile variants. `@piuxxh` publishes art from
 * Settings → Controlling. Once a custom splash is live, the built-in files are
 * never painted first (that caused a millisecond flash of the old art).
 *
 * Paint order:
 *   1. Solid brand ground (or last known *custom* URLs from localStorage)
 *   2. Fetch current splash rows + preload image bytes
 *   3. Reveal only the final pair — no swap from built-in → remote
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

  /*
   * No initial image. Solid ground only until we know the final pair — never
   * mount built-in art first (that was the old-splash flash). Cache is used
   * inside `loadSplashUrls` only when the network fails after a custom upload.
   */
  const [urls, setUrls] = useState<SplashUrls | null>(null);
  const [visible, setVisible] = useState(false);

  /*
   * Read through a ref so the timer sees the latest status without restarting
   * every time it changes - a `status` dependency would reset the dwell on each
   * transition and make the splash outstay its ceiling.
   */
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const next = await loadSplashUrls();
      if (cancelled) return;

      // Decode before paint so we never flash a half-loaded or previous frame.
      await Promise.all([preloadImage(next.desktop), preloadImage(next.mobile)]);
      if (cancelled) return;

      setUrls(next);
      setVisible(true);
    })();

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
        Ground only until we know the final art. Never mount the built-in
        files as a placeholder — that was the old-art flash.
      */}
      {visible && urls ? (
        <picture className="h-full w-full">
          <source media="(orientation: portrait)" srcSet={urls.mobile} />
          <img
            key={`${urls.desktop}|${urls.mobile}`}
            src={urls.desktop}
            alt="PINGO. Connect. Privately."
            width={1600}
            height={900}
            decoding="async"
            fetchPriority="high"
            draggable={false}
            className="h-full w-full select-none object-cover animate-fade-in"
          />
        </picture>
      ) : null}
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
