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
  /*
   * A versionCode, not any number - and this check is the whole reason it
   * exists.
   *
   * Someone typed 4664. Every phone in the world is above that, so every device
   * was judged "already up to date", the card showed once and recorded itself
   * as read, and it never came back. Nothing failed: the row was written, the
   * image uploaded, the upload said it had worked. The notice was simply
   * addressed to nobody, and there was no way to see that from the screen.
   *
   * The scheme is YYWWBB, so a real one is seven digits. Anything shorter is a
   * typo, and refusing it here costs a sentence where accepting it costs a
   * silent no-op nobody can diagnose.
   */
  if (!Number.isInteger(minBuild) || minBuild < 1_000_000) {
    throw new Error(
      `${minBuild || 'That'} is not a build number. They look like 2603508 — ` +
        'year, ISO week, then the build within that week.',
    );
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
