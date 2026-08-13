import { useAuth } from '@pingo/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ONBOARDED_KEY } from '../features/auth/onboarded.js';
import {
  keepSplash,
  loadSplashUrls,
  localSplashUrl,
  preloadImage,
  readSplashCache,
  splashVariant,
  storedSplash,
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

/**
 * The live artwork for this device, or nothing.
 *
 * Nothing is a real answer and the caller keeps what is already on screen. This
 * used to fall back through the URL cache to the bundled file and hand that
 * back as the result - which read as thorough and was a downgrade: the screen
 * had *already* started from those, so the fallbacks could only ever replace
 * the art with itself, or, with the network off, replace working art with a URL
 * that does not load.
 *
 * There is no longer a load budget either. The old one existed to decide how
 * long to wait before settling for the cache, and nothing waits any more - the
 * first frame is painted from the device, this runs behind it, and how long it
 * takes only decides whether it arrives before the splash is over.
 *
 * Only this device's variant is fetched. Downloading the desktop artwork onto a
 * phone to satisfy a `<picture>` element was work no phone ever used.
 */
async function liveSplashArt(variant: 'desktop' | 'mobile'): Promise<string | undefined> {
  const url = (await loadSplashUrls())[variant];
  if (!(await preloadImage(url))) return undefined;

  // Now that it is known to load, keep the bytes for the launches that have no
  // network. Not awaited: this is for next time, not this time.
  void keepSplash(variant, url);
  return url;
}

export function SplashScreen() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const statusRef = useRef(status);
  statusRef.current = status;

  /*
   * Which of the two configured assets this machine shows. Read once: a window
   * being resized mid-splash is not a device changing into another one.
   */
  const variant = useMemo(() => splashVariant(), []);

  // Always have pixels on the first frame — blank ground was reading as "skip".
  const [src, setSrc] = useState<string>(() => initialSplash()[variant]);

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

    /*
     * The device's own copy of the configured artwork, ahead of any network.
     *
     * One IndexedDB read, so it lands within a frame or two of mount - before
     * the URL in the first frame has had time to fail, on a launch with no
     * connection. This is what makes the operator's splash the thing that
     * appears offline instead of the bundled fallback or a blank ground.
     */
    let objectUrl: string | undefined;
    void storedSplash(variant).then((blob) => {
      if (cancelled || leftRef.current || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    });

    void (async () => {
      try {
        const next = await liveSplashArt(variant);
        if (!next || cancelled || leftRef.current) return;
        // Only swap when different — avoids re-flicker when cache already correct.
        setSrc((prev) => (prev === next ? prev : next));
      } catch {
        // Keep whatever is on screen.
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(hardTimer);
      // An object URL pins the whole blob in memory until it is let go.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Do NOT set leftRef here — that poisoned remounts / concurrent loads.
    };
  }, [armLeave, leave, markPainted, variant]);

  return (
    <div
      className="grid h-full w-full place-items-center overflow-hidden"
      style={{ backgroundColor: SPLASH_GROUND }}
    >
      {/*
        One image, chosen by device rather than by the viewport.

        The `<picture>` this replaces let the browser re-decide from
        `(orientation: portrait)` on every resize and rotate, which is how a
        desktop window in portrait ended up showing the mobile asset. The
        variant is settled in JavaScript now, once, and the element renders what
        it is given.
      */}
      <div className="h-full w-full">
        <img
          ref={imgRef}
          key={src}
          src={src}
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
      </div>
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
