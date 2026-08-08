import { useAuth } from '@pingo/core';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ONBOARDED_KEY } from '../features/auth/onboarded.js';
import {
  loadSplashUrls,
  localSplashUrl,
  preloadImage,
  readSplashCache,
  type SplashUrls,
} from '../lib/supabase/onboarding-slides.js';

/**
 * Splash.
 *
 * Full-screen art (PC + mobile). Operator art from Controlling; built-in only
 * when nothing custom is published.
 *
 * ## Why dwell starts *after* the image is visible
 *
 * A slow network or device used to lose the race: mount → 1.8s timer → leave
 * while art was still loading → user never saw the splash. Dwell is now a
 * minimum time **on screen**, not from mount. A load budget + hard ceiling
 * still prevent hanging forever on a dead connection
 * ([11 § 1.1](../../../../docs/11-performance-budget.md#11-the-splash-is-a-ceiling-not-a-spinner)).
 *
 * | Condition | Destination |
 * | --- | --- |
 * | Valid session | Home |
 * | Anonymous | Intro slides |
 */

/** Minimum time the splash art stays visible once painted. */
const DWELL_MS = 1800;

/** Max wait for remote art before falling back to cache / built-in. */
const LOAD_BUDGET_MS = 2000;

/** Absolute max time on this route from mount (load + dwell, worst case). */
const HARD_CEILING_MS = 5000;

const SPLASH_GROUND = '#EDECFB';

function builtInSplash(): SplashUrls {
  return {
    desktop: localSplashUrl('desktop'),
    mobile: localSplashUrl('mobile'),
    fromRemote: false,
  };
}

/**
 * Resolve art with a budget: prefer live operator URLs, then cache, then built-in.
 * Always preloads so the first paint is a complete frame.
 */
async function resolveSplashArt(): Promise<SplashUrls> {
  const load = (async (): Promise<SplashUrls> => {
    const next = await loadSplashUrls();
    await Promise.all([preloadImage(next.desktop), preloadImage(next.mobile)]);
    return next;
  })();

  const raced = await Promise.race([
    load.then((u) => ({ kind: 'ok' as const, u })),
    new Promise<{ kind: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'timeout' }), LOAD_BUDGET_MS);
    }),
  ]);

  if (raced.kind === 'ok') return raced.u;

  // Budget spent — still show *something* so splash is never skipped.
  const cache = readSplashCache();
  if (cache) {
    await Promise.all([preloadImage(cache.desktop), preloadImage(cache.mobile)]);
    return cache;
  }

  const fallback = builtInSplash();
  await Promise.all([preloadImage(fallback.desktop), preloadImage(fallback.mobile)]);
  return fallback;
}

export function SplashScreen() {
  const navigate = useNavigate();
  const { status } = useAuth();

  const [urls, setUrls] = useState<SplashUrls | null>(null);
  const [visible, setVisible] = useState(false);

  const statusRef = useRef(status);
  statusRef.current = status;

  const leftRef = useRef(false);

  useEffect(() => {
    leftRef.current = false;
    let dwellTimer: ReturnType<typeof setTimeout> | undefined;
    let ceilingTimer: ReturnType<typeof setTimeout> | undefined;

    const leave = () => {
      if (leftRef.current) return;
      leftRef.current = true;
      if (dwellTimer) clearTimeout(dwellTimer);
      if (ceilingTimer) clearTimeout(ceilingTimer);

      const current = statusRef.current;
      if (current === 'anonymous') {
        navigate('/intro', { replace: true });
        return;
      }
      navigate('/chats', { replace: true });
    };

    // Never stuck on this route if load + dwell misbehave.
    ceilingTimer = setTimeout(leave, HARD_CEILING_MS);

    void (async () => {
      const next = await resolveSplashArt();
      if (leftRef.current) return;

      setUrls(next);
      setVisible(true);

      // Dwell starts only once art is actually on screen.
      dwellTimer = setTimeout(leave, DWELL_MS);
    })();

    return () => {
      leftRef.current = true;
      if (dwellTimer) clearTimeout(dwellTimer);
      if (ceilingTimer) clearTimeout(ceilingTimer);
    };
  }, [navigate]);

  return (
    <div
      className="grid h-full w-full place-items-center overflow-hidden"
      style={{ backgroundColor: SPLASH_GROUND }}
    >
      {/*
        Solid ground while resolving. Image mounts only when ready — no old-art
        flash, and navigation cannot fire before this paint + DWELL_MS.
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
