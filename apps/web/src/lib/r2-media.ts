import { getSupabaseClient } from './supabase/client.js';

/**
 * Pictures, video, voice and documents on Cloudflare R2: stories, posts, profile
 * pictures and covers, and the media in chats (photos, voice notes, documents
 * - where video arrives - and Pings).
 *
 * Every view used to be Supabase egress. R2 charges nothing to read, so these
 * now go to the `pingo-media` Worker (workers/media). Only the chat's text and
 * rows stay in the database.
 *
 * ## Paths
 *
 * A row keeps a path as it always has. One that starts `r2:` is here; anything
 * else is an older file still on Supabase and is read the old way, so nothing
 * posted before the move breaks.
 *
 * ## Before the Worker is deployed
 *
 * An upload that cannot reach the Worker returns `null`, and the caller puts
 * the file on Supabase as before. So the app works the same whether or not
 * the Worker is up, and moves over on its own the day it is.
 */

const ENDPOINT = ((import.meta.env.VITE_MEDIA_URL as string | undefined) ?? 'https://pingo-media.dubesminecraft.workers.dev').replace(/\/$/, '');

export type R2Kind = 'avatar' | 'cover' | 'story' | 'post' | 'photo' | 'voice' | 'doc' | 'snap';

export const isR2Path = (path: string | null | undefined): path is string => typeof path === 'string' && path.startsWith('r2:');

/** Set after a failed reach, so one session does not keep trying a Worker that is not there. */
let unreachableUntil = 0;

async function bearer(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Puts a file on R2. Resolves to its stored path (and, for a face or cover,
 * its permanent link), or `null` when the Worker cannot take it, in which case
 * the caller uses Supabase.
 */
export async function r2Upload(kind: R2Kind, blob: Blob, contentType: string): Promise<{ path: string; url?: string } | null> {
  if (Date.now() < unreachableUntil) return null;
  const token = await bearer();
  if (!token) return null;
  try {
    const res = await fetch(`${ENDPOINT}/upload?kind=${kind}&type=${encodeURIComponent(contentType)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      body: blob,
    });
    if (!res.ok) {
      // Not deployed (or not configured): leave it alone for a while.
      if (res.status === 404 || res.status >= 500) unreachableUntil = Date.now() + 10 * 60 * 1000;
      return null;
    }
    const out = (await res.json()) as { path?: string; url?: string };
    return isR2Path(out.path) ? { path: out.path, ...(out.url ? { url: out.url } : {}) } : null;
  } catch {
    unreachableUntil = Date.now() + 10 * 60 * 1000;
    return null;
  }
}

/** The stored path behind a signed R2 link (chat media, stories, posts), or nothing if it is not one. */
export function r2PathFromSignedUrl(url: string | null | undefined): string | undefined {
  if (!url || !url.startsWith(`${ENDPOINT}/s/`)) return undefined;
  const rest = url.slice(`${ENDPOINT}/s/`.length).split('?')[0] ?? '';
  return rest ? `r2:${rest}` : undefined;
}

/** Link remembered per path until shortly before it expires. */
const signed = new Map<string, { url: string; expiresAt: number }>();
const SKEW_MS = 10 * 60 * 1000;

/**
 * Links for story and post files the signed-in person may see. A path they
 * may not see, or one the Worker could not sign, is simply absent.
 */
export async function r2Sign(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const missing = [...new Set(paths.filter(isR2Path))].filter((path) => {
    const hit = signed.get(path);
    if (hit && hit.expiresAt - now > SKEW_MS) {
      out.set(path, hit.url);
      return false;
    }
    return true;
  });
  if (missing.length === 0) return out;
  const token = await bearer();
  if (!token) return out;
  for (let i = 0; i < missing.length; i += 200) {
    try {
      const res = await fetch(`${ENDPOINT}/sign`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ paths: missing.slice(i, i + 200) }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { urls?: Record<string, string>; expiresAt?: number };
      const expiresAt = body.expiresAt ?? now + 60 * 60 * 1000;
      for (const [path, url] of Object.entries(body.urls ?? {})) {
        signed.set(path, { url, expiresAt });
        out.set(path, url);
      }
    } catch {
      // Unsigned paths stay absent; the screen shows what it can.
    }
  }
  return out;
}

/**
 * A link that is only good for a couple of minutes, for a Ping. Never
 * remembered: a link kept past the Ping's last look is the thing this avoids.
 * Resolves to nothing when the Worker will not sign it (not yours to see).
 */
export async function r2SignShort(path: string): Promise<string | undefined> {
  if (!isR2Path(path)) return undefined;
  const token = await bearer();
  if (!token) return undefined;
  const res = await fetch(`${ENDPOINT}/sign`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ paths: [path], short: true }),
  });
  // A failed request is not "not allowed": the caller decides what an error means.
  if (!res.ok) throw new Error(`Could not sign (${res.status}).`);
  const body = (await res.json()) as { urls?: Record<string, string> };
  return body.urls?.[path];
}

/** Best effort: removes your own files. A leftover is waste, never an error. */
export async function r2Remove(paths: string[]): Promise<void> {
  const mine = paths.filter(isR2Path);
  if (mine.length === 0) return;
  const token = await bearer();
  if (!token) return;
  await fetch(`${ENDPOINT}/delete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ paths: mine }),
  }).catch(() => undefined);
}

/**
 * Removes your own files and says whether they are gone. For the sweeper that
 * clears a pointer only once the bytes are: a file already gone is a success,
 * and so is nothing to remove; a Worker that did not answer is not.
 */
export async function r2RemoveConfirmed(paths: string[]): Promise<boolean> {
  const mine = paths.filter(isR2Path);
  if (mine.length === 0) return true;
  const token = await bearer();
  if (!token) return false;
  try {
    const res = await fetch(`${ENDPOINT}/delete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ paths: mine }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The stored path behind a public R2 link, for deleting a replaced face or cover. */
export function r2PathFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(`${ENDPOINT}/p/`)) return null;
  const rest = url.slice(`${ENDPOINT}/p/`.length).split('?')[0] ?? '';
  return rest ? `r2:${rest}` : null;
}
