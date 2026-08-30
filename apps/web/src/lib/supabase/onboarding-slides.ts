/**
 * Pre-login intro slide assets (desktop + mobile per slide).
 *
 * Public bucket so anonymous users can load them after splash. Operator
 * uploads keep original bytes (no re-encode) via Settings → Controlling.
 */

import { Capacitor } from '@capacitor/core';

import { STORE, localGet, localSet } from '../local/db.js';
import { getSupabaseClient } from './client.js';

export const ONBOARDING_BUCKET = 'onboarding';
export const SLIDE_COUNT = 5 as const;
export type SlideVariant = 'desktop' | 'mobile';

export interface OnboardingSlideRow {
  slide_index: number;
  variant: SlideVariant;
  storage_path: string;
  content_type: string | null;
  updated_at: string;
}

export function publicObjectUrl(path: string, updatedAt?: string): string {
  const client = getSupabaseClient();
  const { data } = client.storage.from(ONBOARDING_BUCKET).getPublicUrl(path);
  const base = data.publicUrl;
  if (!updatedAt) return base;
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) ? `${base}?v=${t}` : base;
}

/**
 * The bundled copy of a slide, served by Cloudflare rather than Supabase.
 *
 * These used to be an empty directory, so the rows below always won and every
 * new account downloaded **17.8 MB of PNGs from Supabase** to look at five
 * pictures once. The same five, re-encoded as WebP at the size they are
 * actually drawn, are 1.18 MB and ship with the app - which is to say they cost
 * nothing, because Pages egress is not metered and the browser caches them.
 *
 * Not precached by the service worker (`globPatterns` covers js/css/html/woff2
 * only), so they are fetched the first time somebody sees the intro rather than
 * by every install of the app.
 */
export function localFallbackUrl(slide: number, variant: SlideVariant): string {
  return `/onboarding/${variant}/${slide}.webp`;
}

/**
 * When the bundled slides were last regenerated.
 *
 * An operator upload only wins if it is newer than this. That is what keeps
 * Settings → Controlling working - upload a new slide and it appears, exactly
 * as before - while the ones nobody has changed come from the bundle instead of
 * costing 17.8 MB of metered egress per account.
 *
 * Bump this whenever the files in `public/onboarding/` are replaced.
 */
const BUNDLED_AT = Date.parse('2026-08-14T00:00:00Z');

/**
 * Resolves the five pairs of URLs for the carousel.
 * Prefers remote operator uploads; falls back to `/public/onboarding/...`.
 */
export async function loadIntroSlideUrls(): Promise<{
  desktop: string[];
  mobile: string[];
}> {
  const desktop = Array.from({ length: SLIDE_COUNT }, (_, i) =>
    localFallbackUrl(i + 1, 'desktop'),
  );
  const mobile = Array.from({ length: SLIDE_COUNT }, (_, i) =>
    localFallbackUrl(i + 1, 'mobile'),
  );

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('onboarding_slides')
      .select('slide_index, variant, storage_path, content_type, updated_at');

    if (error || !data) return { desktop, mobile };

    for (const row of data as OnboardingSlideRow[]) {
      const i = row.slide_index - 1;
      if (i < 0 || i >= SLIDE_COUNT) continue;

      /*
       * The bundle wins unless an operator has since replaced this slide.
       *
       * The rows still describe every slide, because that is what the
       * Controlling screen writes and reads. What changed is that a row which
       * merely repeats what already ships is no longer worth 1.8 MB of egress
       * per person to fetch.
       */
      const uploadedAt = Date.parse(row.updated_at);
      if (Number.isFinite(uploadedAt) && uploadedAt <= BUNDLED_AT) continue;

      const url = publicObjectUrl(row.storage_path, row.updated_at);
      if (row.variant === 'desktop') desktop[i] = url;
      else mobile[i] = url;
    }
  } catch {
    // Pre-auth offline / misconfig: local fallbacks only.
  }

  return { desktop, mobile };
}

export async function listOnboardingSlideRows(): Promise<OnboardingSlideRow[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('onboarding_slides')
    .select('slide_index, variant, storage_path, content_type, updated_at')
    .order('slide_index', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OnboardingSlideRow[];
}

export function extensionFor(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  };
  return map[file.type] ?? 'bin';
}

/**
 * Upload original file bytes for one slide variant (no recompression).
 * Path is stable per slot so public URLs stay predictable; `updated_at` busts cache.
 */
export async function uploadOnboardingSlide(
  slideIndex: number,
  variant: SlideVariant,
  file: File,
): Promise<OnboardingSlideRow> {
  if (slideIndex < 1 || slideIndex > SLIDE_COUNT) {
    throw new Error('Slide must be 1–5');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are allowed');
  }

  const ext = extensionFor(file);
  const storage_path = `${variant}/slide-${slideIndex}.${ext}`;
  const client = getSupabaseClient();

  // Remove sibling extensions so old jpg doesn't shadow new png, etc.
  const siblings = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bin']
    .map((e) => `${variant}/slide-${slideIndex}.${e}`)
    .filter((p) => p !== storage_path);
  try {
    await client.storage.from(ONBOARDING_BUCKET).remove(siblings);
  } catch {
    // Best-effort cleanup.
  }

  const { error: upErr } = await client.storage.from(ONBOARDING_BUCKET).upload(storage_path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
    cacheControl: '31536000',
  });
  if (upErr) throw upErr;

  const row = {
    slide_index: slideIndex,
    variant,
    storage_path,
    content_type: file.type || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('onboarding_slides')
    .upsert(row, { onConflict: 'slide_index,variant' })
    .select('slide_index, variant, storage_path, content_type, updated_at')
    .single();
  if (error) throw error;
  return data as OnboardingSlideRow;
}

export function previewUrlFor(row: OnboardingSlideRow | undefined, slide: number, variant: SlideVariant): string {
  if (row) return publicObjectUrl(row.storage_path, row.updated_at);
  return localFallbackUrl(slide, variant);
}

// ---------------------------------------------------------------------------
// Splash (desktop + mobile) — same bucket, separate table
// ---------------------------------------------------------------------------

export interface AppSplashRow {
  variant: SlideVariant;
  storage_path: string;
  content_type: string | null;
  updated_at: string;
}

/** Built-in splash files shipped with the app (used until operator uploads). */
export function localSplashUrl(variant: SlideVariant): string {
  /*
   * The shipped copy of the *current* art, not an ancestor of it.
   *
   * This is what a device paints before the operator's upload has arrived -
   * first launch, cleared storage, or a network slower than the load budget -
   * and it was still the lavender artwork from before the rebrand. So the app
   * flashed the old identity at exactly the people seeing it for the first
   * time. Both files are now the same pictures Controlling serves; they are
   * re-exported from `apps/web/assets/splash-mobile.png` whenever that changes.
   */
  return variant === 'mobile' ? '/pingo-splash-mobile.png' : '/pingo-splash.png';
}

/** Last known *operator* splash URLs — never store built-in paths here. */
const SPLASH_CACHE_KEY = 'pingo:splash_urls_v1';

export interface SplashUrls {
  desktop: string;
  mobile: string;
  /** True when at least one variant came from Controlling upload. */
  fromRemote: boolean;
}

export function readSplashCache(): SplashUrls | null {
  try {
    const raw = localStorage.getItem(SPLASH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SplashUrls;
    if (
      typeof parsed?.desktop === 'string' &&
      typeof parsed?.mobile === 'string' &&
      parsed.fromRemote === true
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSplashCache(urls: SplashUrls): void {
  if (!urls.fromRemote) return;
  try {
    localStorage.setItem(
      SPLASH_CACHE_KEY,
      JSON.stringify({
        desktop: urls.desktop,
        mobile: urls.mobile,
        fromRemote: true,
      }),
    );
  } catch {
    // private mode
  }
}

export function clearSplashCache(): void {
  try {
    localStorage.removeItem(SPLASH_CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Loads an image, and says whether it actually loaded.
 *
 * It used to resolve either way, on the grounds that blank beats hanging. That
 * is right for waiting and wrong for deciding: the caller swaps the splash to
 * whatever this resolves for, so a URL that failed - which is every operator
 * URL with the network off - replaced artwork that was already on screen with a
 * broken image. Reporting the difference costs one boolean.
 */
export function preloadImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(false);
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Which splash this device shows, and how it shows it with the network off
// ---------------------------------------------------------------------------

/**
 * The variant this device is meant to show.
 *
 * Two assets are configured in Controlling, one for mobile and one for
 * PC/desktop, and this decides which of them a given device gets. It is a
 * question about the device, so it is answered from the device.
 *
 * It used to be answered from `(orientation: portrait)` inside a `<picture>`,
 * which is a different question with a different answer: a desktop browser in a
 * tall window served the mobile artwork, and a phone held sideways served the
 * desktop one. Both are the wrong asset for the machine, and neither is
 * something the operator who uploaded them asked for.
 *
 * Native is decisive - a Capacitor build is the Android app. On the web the
 * test is `hover: none` *and* `pointer: coarse`, which is true of phones and
 * tablets and false of a laptop with a touchscreen, because such a laptop still
 * reports a hoverable pointer.
 */
export function splashVariant(): SlideVariant {
  try {
    if (Capacitor.isNativePlatform()) return 'mobile';
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches
      ? 'mobile'
      : 'desktop';
  } catch {
    // No matchMedia is not a phone.
    return 'desktop';
  }
}

/**
 * The operator's artwork, kept on the device as bytes.
 *
 * ## Why the URL cache was not enough
 *
 * What was stored was the *address* of the configured splash, and the address
 * is on Supabase - which the service worker is explicitly told never to cache,
 * because everything else at that hostname is live data. So with no connection
 * there was nothing behind the URL, the image failed, and the one screen that
 * has to paint before any network work is the screen that had nothing to paint.
 *
 * The bundled files are the other half and are now precached, but they are the
 * fallback art, not the operator's. Rendering those to somebody who has
 * configured their own is showing them the wrong picture.
 *
 * ## Stored beside the wallpaper
 *
 * Same store, same reasoning: whole files, unmodified, in the only web storage
 * the platform agrees to keep. The bytes are the ones Controlling serves - they
 * are downloaded, not re-encoded, so what is painted offline is the asset as
 * uploaded and nothing derived from it.
 *
 * The source URL is kept beside the blob and carries `?v=<updated_at>`, so a
 * re-upload in Controlling changes the URL, the comparison fails, and the new
 * bytes replace the old. An unchanged splash is never downloaded twice.
 */
interface StoredSplash {
  url: string;
  blob: Blob;
}

const splashRecordKey = (variant: SlideVariant) => `splash:${variant}`;

export async function storedSplash(variant: SlideVariant): Promise<Blob | undefined> {
  const held = await localGet<StoredSplash>(STORE.media, splashRecordKey(variant));
  return held?.blob instanceof Blob ? held.blob : undefined;
}

export async function keepSplash(variant: SlideVariant, url: string): Promise<void> {
  try {
    const held = await localGet<StoredSplash>(STORE.media, splashRecordKey(variant));
    if (held?.url === url) return;

    const response = await fetch(url);
    if (!response.ok) return;

    const blob = await response.blob();
    // A sign-in page returned as HTML is not artwork. Storing whatever came
    // back would put a broken splash on the device until the next upload.
    if (!blob.type.startsWith('image/')) return;

    await localSet(STORE.media, splashRecordKey(variant), { url, blob });
  } catch {
    // Offline, or storage refused. The splash still has the URL cache and the
    // bundled file, and this is retried on the next launch.
  }
}

/**
 * Resolves splash URLs.
 *
 * Operator uploads win completely when present (both or either). Built-in
 * files are only returned when the table has no rows — never mixed mid-paint.
 */
export async function loadSplashUrls(): Promise<SplashUrls> {
  const fallback: SplashUrls = {
    desktop: localSplashUrl('desktop'),
    mobile: localSplashUrl('mobile'),
    fromRemote: false,
  };

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('app_splash')
      .select('variant, storage_path, content_type, updated_at');

    if (error || !data || data.length === 0) {
      clearSplashCache();
      return fallback;
    }

    let desktop: string | null = null;
    let mobile: string | null = null;
    for (const row of data as AppSplashRow[]) {
      const url = publicObjectUrl(row.storage_path, row.updated_at);
      if (row.variant === 'desktop') desktop = url;
      else if (row.variant === 'mobile') mobile = url;
    }

    // Partial upload: missing side keeps last cache or built-in for that side only.
    const cache = readSplashCache();
    const resolved: SplashUrls = {
      desktop: desktop ?? cache?.desktop ?? fallback.desktop,
      mobile: mobile ?? cache?.mobile ?? fallback.mobile,
      fromRemote: true,
    };
    writeSplashCache(resolved);
    return resolved;
  } catch {
    const cache = readSplashCache();
    if (cache) return cache;
    return fallback;
  }
}

export async function listAppSplashRows(): Promise<AppSplashRow[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('app_splash')
    .select('variant, storage_path, content_type, updated_at');
  if (error) throw error;
  return (data ?? []) as AppSplashRow[];
}

export async function uploadAppSplash(
  variant: SlideVariant,
  file: File,
): Promise<AppSplashRow> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are allowed');
  }

  const ext = extensionFor(file);
  const storage_path = `splash/${variant}.${ext}`;
  const client = getSupabaseClient();

  const siblings = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bin']
    .map((e) => `splash/${variant}.${e}`)
    .filter((p) => p !== storage_path);
  try {
    await client.storage.from(ONBOARDING_BUCKET).remove(siblings);
  } catch {
    // best-effort
  }

  const { error: upErr } = await client.storage.from(ONBOARDING_BUCKET).upload(storage_path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
    cacheControl: '31536000',
  });
  if (upErr) throw upErr;

  const row = {
    variant,
    storage_path,
    content_type: file.type || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('app_splash')
    .upsert(row, { onConflict: 'variant' })
    .select('variant, storage_path, content_type, updated_at')
    .single();
  if (error) throw error;
  return data as AppSplashRow;
}

export function previewSplashUrl(row: AppSplashRow | undefined, variant: SlideVariant): string {
  if (row) return publicObjectUrl(row.storage_path, row.updated_at);
  return localSplashUrl(variant);
}
