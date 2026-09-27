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
