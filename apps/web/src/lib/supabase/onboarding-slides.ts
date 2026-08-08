/**
 * Pre-login intro slide assets (desktop + mobile per slide).
 *
 * Public bucket so anonymous users can load them after splash. Operator
 * uploads keep original bytes (no re-encode) via Settings → Controlling.
 */

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

function publicObjectUrl(path: string, updatedAt?: string): string {
  const client = getSupabaseClient();
  const { data } = client.storage.from(ONBOARDING_BUCKET).getPublicUrl(path);
  const base = data.publicUrl;
  if (!updatedAt) return base;
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) ? `${base}?v=${t}` : base;
}

/** Local fallback when nothing is uploaded yet (optional static files). */
export function localFallbackUrl(slide: number, variant: SlideVariant): string {
  return `/onboarding/${variant}/${slide}.png`;
}

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

function extensionFor(file: File): string {
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
  return variant === 'mobile' ? '/pingo-splash-mobile.png' : '/pingo-splash.jpg';
}

export async function loadSplashUrls(): Promise<{ desktop: string; mobile: string }> {
  const desktop = localSplashUrl('desktop');
  const mobile = localSplashUrl('mobile');

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('app_splash')
      .select('variant, storage_path, content_type, updated_at');

    if (error || !data) return { desktop, mobile };

    let d = desktop;
    let m = mobile;
    for (const row of data as AppSplashRow[]) {
      const url = publicObjectUrl(row.storage_path, row.updated_at);
      if (row.variant === 'desktop') d = url;
      else m = url;
    }
    return { desktop: d, mobile: m };
  } catch {
    return { desktop, mobile };
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
