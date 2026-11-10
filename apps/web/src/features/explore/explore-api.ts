import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * The Explore tab's catalogue: Pexels photos and GIPHY GIFs and stickers, asked
 * through the `explore` function so the keys never reach the app.
 */

export type ExploreSource = 'photos' | 'gifs' | 'stickers' | 'sounds' | 'clips';

export interface ExploreItem {
  id: string;
  src: 'pexels' | 'giphy' | 'freesound';
  kind: 'photo' | 'gif' | 'sticker' | 'sound' | 'clip';
  /** Length in seconds, for sounds and clips. */
  secs?: number;
  thumb: string;
  /** What is sent. */
  url: string;
  w: number;
  h: number;
  title: string;
  by?: { name: string; url: string };
}

export interface ExplorePage {
  items: ExploreItem[];
  next: number | null;
}

/** Why a page could not be had, in words for the person. */
export class ExploreError extends Error {}

const memory = new Map<string, { at: number; page: ExplorePage }>();
const FRESH_MS = 3 * 60_000;

const https = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : '');

export async function explore(source: ExploreSource, q: string, page: number, signal?: AbortSignal): Promise<ExplorePage> {
  const key = `${source}|${q.trim().toLowerCase()}|${page}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.page;

  const { data, error } = await getSupabaseClient().functions.invoke('explore', {
    body: { src: source === 'photos' ? 'pexels' : source === 'sounds' ? 'freesound' : 'giphy', kind: source === 'stickers' ? 'stickers' : source === 'clips' ? 'clips' : 'gifs', q: q.trim(), page },
    ...(signal ? { signal } : {}),
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const body = data as { items?: unknown[]; next?: unknown; error?: string } | null;
  if (error || !body || !Array.isArray(body.items)) {
    const text = (body as { error?: string } | null)?.error;
    throw new ExploreError(text === 'not_configured' ? (source === 'photos' ? 'Photos are coming soon.' : source === 'sounds' ? 'Sounds are coming soon.' : source === 'clips' ? 'Clips are coming soon.' : 'Explore is not set up yet.') : 'Could not load. Try again.');
  }

  // The answer is read as untrusted: https pictures only, and sizes that are real numbers.
  const items: ExploreItem[] = [];
  for (const raw of body.items as Record<string, unknown>[]) {
    const thumb = https(raw.thumb);
    const url = https(raw.url);
    const sound = raw.kind === 'sound';
    const clipped = raw.kind === 'clip';
    // A sound or a clip may come without a picture (the clip is shown by its own first frame); every other kind needs one.
    if ((!thumb && !sound && !clipped) || !url || typeof raw.id !== 'string') continue;
    const by = raw.by as { name?: unknown; url?: unknown } | undefined;
    items.push({
      id: raw.id.slice(0, 60),
      src: raw.src === 'giphy' ? 'giphy' : raw.src === 'freesound' ? 'freesound' : 'pexels',
      kind: raw.kind === 'gif' ? 'gif' : raw.kind === 'sticker' ? 'sticker' : sound ? 'sound' : clipped ? 'clip' : 'photo',
      ...(sound || clipped ? { secs: Math.min(60, Math.max(0, Number(raw.secs) || 0)) } : {}),
      thumb,
      url,
      w: Math.max(1, Number(raw.w) || 1),
      h: Math.max(1, Number(raw.h) || 1),
      title: typeof raw.title === 'string' ? raw.title.slice(0, 100) : '',
      ...(by && typeof by.name === 'string' && https(by.url) ? { by: { name: by.name.slice(0, 60), url: by.url as string } } : {}),
    });
  }
  const result: ExplorePage = { items, next: typeof body.next === 'number' ? body.next : null };
  memory.set(key, { at: Date.now(), page: result });
  if (memory.size > 60) memory.delete(memory.keys().next().value!);
  return result;
}
