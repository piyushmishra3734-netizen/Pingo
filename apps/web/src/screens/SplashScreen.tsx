import { useAuth } from '@pingo/core';
import { useCallback, useEffect, useRef, useState } from 'react';
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
 * Splash — must be *seen*, not only mounted.
 *
 * Earlier bugs:
 * 1. Dwell ran from mount while art was still loading → leave before paint.
 * 2. Effect cleanup set a shared "left" flag that poisoned remounts / races.
 *
 * Rules now:
 * - Always paint an image as soon as possible (custom cache, else built-in).
 * - Refresh to live operator art in the background (preloaded before swap).
 * - Leave only after BOTH: min time from mount AND image `onLoad` (+ short hold).
 * - Hard ceiling so a dead network never traps the user.
 */

/** Minimum time spent on this route after open. */
const MIN_ROUTE_MS = 2200;

/** Extra hold after the browser has actually loaded the image pixels. */
const AFTER_PAINT_MS = 600;

/** Never stay longer than this (load + hold worst case). */
const HARD_MAX_MS = 7000;

/** How long to wait for operator URLs before accepting cache/built-in as final. */
const LOAD_BUDGET_MS = 1800;

/**
 * The colour under the artwork, sampled from the artwork.
 *
 * It was lavender, left over from the previous identity, and it is painted for
 * the frame or two before the image has pixels - so every launch began with a
 * flash of the old brand colour behind the new picture. Cream is what the
 * current art starts with, which is what makes the image appear to fade up out
 * of the screen rather than replace something.
 */
const SPLASH_GROUND = '#FAF8F6';

function builtInSplash(): SplashUrls {
  return {
    desktop: localSplashUrl('desktop'),
    mobile: localSplashUrl('mobile'),
    fromRemote: false,
  };
}

/** First paint candidate: last custom art if any, else shipped files. */
function initialSplash(): SplashUrls {
  return readSplashCache() ?? builtInSplash();
}

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
  const statusRef = useRef(status);
  statusRef.current = status;

  // Always have pixels on the first frame — blank ground was reading as "skip".
  const [urls, setUrls] = useState<SplashUrls>(() => initialSplash());

  const mountedAtRef = useRef(0);
  const paintedAtRef = useRef<number | null>(null);
  const leftRef = useRef(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    const current = statusRef.current;
    if (current === 'anonymous') {
      navigate('/intro', { replace: true });
      return;
    }
    navigate('/chats', { replace: true });
  }, [navigate]);

  /**
   * Schedule leave when both clocks are satisfied.
   * Re-checks until ready; safe to call many times.
   */
  const armLeave = useCallback(() => {
    if (leftRef.current) return;

    const tick = () => {
      if (leftRef.current) return;
      const now = Date.now();
      const mountedAt = mountedAtRef.current || now;
      const paintedAt = paintedAtRef.current;

      const routeReady = now - mountedAt >= MIN_ROUTE_MS;
      const paintReady =
        paintedAt != null && now - paintedAt >= AFTER_PAINT_MS;

      if (routeReady && paintReady) {
        leave();
        return;
      }

      const waitRoute = Math.max(0, MIN_ROUTE_MS - (now - mountedAt));
      const waitPaint =
        paintedAt == null
          ? AFTER_PAINT_MS
          : Math.max(0, AFTER_PAINT_MS - (now - paintedAt));
      window.setTimeout(tick, Math.max(waitRoute, waitPaint, 32));
    };

    tick();
  }, [leave]);

  const markPainted = useCallback(() => {
    if (paintedAtRef.current != null) return;
    paintedAtRef.current = Date.now();
    armLeave();
  }, [armLeave]);

  useEffect(() => {
    leftRef.current = false;
    paintedAtRef.current = null;
    mountedAtRef.current = Date.now();

    let cancelled = false;
    const hardTimer = window.setTimeout(() => {
      if (!cancelled) leave();
    }, HARD_MAX_MS);

    // Cached / built-in img may already be complete before onLoad binds.
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) {
      markPainted();
    } else {
      // If the image never fires onLoad (rare), still release after route min.
      window.setTimeout(() => {
        if (!cancelled && paintedAtRef.current == null) markPainted();
      }, MIN_ROUTE_MS);
    }

    armLeave();

    void (async () => {
      try {
        const next = await resolveSplashArt();
        if (cancelled || leftRef.current) return;
        // Only swap when different — avoids re-flicker when cache already correct.
        setUrls((prev) => {
          if (prev.desktop === next.desktop && prev.mobile === next.mobile) return prev;
          return next;
        });
      } catch {
        // Keep whatever is on screen.
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(hardTimer);
      // Do NOT set leftRef here — that poisoned remounts / concurrent loads.
    };
  }, [armLeave, leave, markPainted]);

  return (
    <div
      className="grid h-full w-full place-items-center overflow-hidden"
      style={{ backgroundColor: SPLASH_GROUND }}
    >
      <picture className="h-full w-full">
        <source media="(orientation: portrait)" srcSet={urls.mobile} />
        <img
          ref={imgRef}
          key={`${urls.desktop}|${urls.mobile}`}
          src={urls.desktop}
          alt="PINGO. Connect. Privately."
          width={1600}
          height={900}
          decoding="async"
          fetchPriority="high"
          draggable={false}
          onLoad={markPainted}
          onError={markPainted}
          className="h-full w-full select-none object-cover"
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
