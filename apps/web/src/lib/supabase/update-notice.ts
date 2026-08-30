/**
 * The operator's update card: one image, one build number.
 *
 * Lives in the same public `onboarding` bucket as the splash and intro art, so
 * a device that has not signed in can still load it — which is the case that
 * matters, since somebody stuck on an old build may well be logged out.
 */

import { ONBOARDING_BUCKET, extensionFor, publicObjectUrl } from './onboarding-slides.js';
import { getSupabaseClient } from './client.js';

export interface UpdateNoticeRow {
  storage_path: string;
  content_type: string | null;
  /** Android versionCode; a device below this is behind. */
  min_build: number;
  updated_at: string;
}

const COLUMNS = 'storage_path, content_type, min_build, updated_at';

/** The current notice, or null when the operator has not published one. */
export async function loadUpdateNotice(): Promise<UpdateNoticeRow | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('update_notice')
      .select(COLUMNS)
      .maybeSingle();
    if (error || !data) return null;
    return data as UpdateNoticeRow;
  } catch {
    // Offline, or a client that could not be built. Nothing to show.
    return null;
  }
}

export function updateNoticeUrl(row: UpdateNoticeRow): string {
  return publicObjectUrl(row.storage_path, row.updated_at);
}

/**
 * Publishes (or replaces) the notice.
 *
 * The stored path carries the build number, so replacing a notice cannot be
 * served from a cache keyed on the old one — and `updated_at` busts the rest.
 */
export async function uploadUpdateNotice(file: File, minBuild: number): Promise<UpdateNoticeRow> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files are allowed');
  if (!Number.isInteger(minBuild) || minBuild <= 0) {
    throw new Error('Build number must be a positive integer, e.g. 2603501');
  }

  const client = getSupabaseClient();
  const storage_path = `update/notice-${minBuild}.${extensionFor(file)}`;

  const { error: upErr } = await client.storage.from(ONBOARDING_BUCKET).upload(storage_path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
    cacheControl: '31536000',
  });
  if (upErr) throw upErr;

  const { data, error } = await client
    .from('update_notice')
    .upsert(
      {
        id: true,
        storage_path,
        content_type: file.type || null,
        min_build: minBuild,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as UpdateNoticeRow;
}

/** Takes the notice down. The image is left in the bucket; nothing reads it. */
export async function clearUpdateNotice(): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('update_notice').delete().eq('id', true);
  if (error) throw error;
}
