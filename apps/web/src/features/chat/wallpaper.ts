/**
 * What sits behind a conversation.
 *
 * ## Why this exists at all
 *
 * Glass shows what is behind it, and behind PINGO's chrome was the page
 * colour - one step off white. Measured on the deployed build: at the
 * strongest setting, 48px of blur over a 45% panel, the header was
 * indistinguishable from the page. The material was correct and had nothing to
 * work on. A backdrop is not decoration here; it is the thing that makes every
 * other surface in the app visible as a surface.
 *
 * ## Per chat, not whole app
 *
 * A direct (or AI) wallpaper is personal: yours for that person, on this
 * device. Changing Ali's chat must not repaint every other thread. A group
 * wallpaper is the room - one choice, visible to every member - so groups read
 * from the conversation row the server ships, not from localStorage.
 *
 * ## Presets are CSS, the custom one is a photograph
 *
 * A preset is a few hundred bytes of gradient, so all of them together cost
 * less than one icon. The custom one is the person's own file. For DMs it stays
 * on device (IndexedDB original + localStorage preview). For groups the photo
 * is uploaded and its public URL lives on the conversation so everyone sees it.
 *
 * ## Two copies for local custom photos, and why
 *
 * The original goes into IndexedDB as a `Blob`, untouched. Beside it, in
 * `localStorage`, sits a small downscaled preview so the first frame is not
 * blank while IndexedDB opens.
 */

import { STORE, localGet, localSet } from '../../lib/local/db.js';

export interface Wallpaper {
  id: string;
  name: string;
  /** A `background-image` value. Absent on `custom`, which carries a photo. */
  css?: string;
  /** True where the picture is dark enough that the thread should invert. */
  dark?: boolean;
  /** Drawn by a canvas rather than by CSS. Rain is the only one so far. */
  live?: boolean;
}

/*
 * The stops are low on purpose. A wallpaper you notice is a wallpaper you will
 * be asked to turn off - these are meant to read as light in the room rather
 * than as a pattern behind the words.
 */
export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'default',
    name: 'PINGO light',
    css:
      'radial-gradient(72% 44% at 6% 2%, rgb(17 17 19 / 0.05), transparent 62%),' +
      'radial-gradient(60% 40% at 96% 14%, rgb(60 70 90 / 0.06), transparent 64%),' +
      'radial-gradient(70% 46% at 82% 98%, rgb(245 148 80 / 0.07), transparent 62%),' +
      'radial-gradient(52% 36% at 10% 88%, rgb(40 180 140 / 0.06), transparent 68%)',
  },
  {
    id: 'dawn',
    name: 'Dawn',
    css:
      'radial-gradient(80% 50% at 50% 0%, rgb(255 176 120 / 0.2), transparent 62%),' +
      'radial-gradient(70% 46% at 12% 96%, rgb(17 17 19 / 0.05), transparent 64%),' +
      'radial-gradient(60% 40% at 92% 78%, rgb(60 70 90 / 0.06), transparent 66%)',
  },
  {
    id: 'sea',
    name: 'Sea glass',
    css:
      'radial-gradient(76% 48% at 8% 6%, rgb(40 200 200 / 0.16), transparent 62%),' +
      'radial-gradient(64% 42% at 94% 24%, rgb(50 80 120 / 0.08), transparent 64%),' +
      'radial-gradient(66% 44% at 78% 96%, rgb(40 220 150 / 0.12), transparent 64%)',
  },
  {
    id: 'ink',
    name: 'Ink',
    dark: true,
    css:
      'radial-gradient(78% 48% at 8% 2%, rgb(120 90 220 / 0.4), transparent 62%),' +
      'radial-gradient(66% 44% at 94% 20%, rgb(60 80 200 / 0.36), transparent 64%),' +
      'radial-gradient(70% 46% at 80% 98%, rgb(40 60 140 / 0.3), transparent 62%),' +
      'linear-gradient(#14151d, #14151d)',
  },
  {
    id: 'plain',
    name: 'None',
    css: '',
  },
  /*
   * Live, and the only one that is.
   *
   * It rains over whatever else is chosen - your photo if you have set one,
   * the default light if you have not - because rain is weather on a window,
   * and a window has to be looking at something.
   */
  { id: 'rain', name: 'Rain', live: true },
  { id: 'custom', name: 'Your photo' },
];

/** Legacy whole-app key - still read as the fallback when a chat has no override. */
const GLOBAL_KEY = 'pingo:wallpaper';
const GLOBAL_PHOTO_KEY = 'pingo:wallpaper-photo';
const GLOBAL_ORIGINAL = 'wallpaper';

function idKey(conversationId: string): string {
  return `pingo:wallpaper:${conversationId}`;
}
function photoKey(conversationId: string): string {
  return `pingo:wallpaper-photo:${conversationId}`;
}
function darkKey(conversationId: string): string {
  return `pingo:wallpaper-photo:${conversationId}:dark`;
}
function originalKey(conversationId: string): string {
  return `wallpaper:${conversationId}`;
}

/**
 * The preview's long edge, in real device pixels.
 *
 * Deliberately modest. This is only ever on screen for as long as IndexedDB
 * takes to answer, and it has to fit in `localStorage` next to everything else
 * the app keeps there - so it is sized to be unobjectionable for a few hundred
 * milliseconds rather than to be the wallpaper. The original, which is what
 * you look at, is not resized at all.
 */
const PREVIEW_EDGE = 900;

/** Tried in order until the preview fits. See `setWallpaperPhoto`. */
const QUALITIES = [0.82, 0.7, 0.6];

/**
 * Roughly what `localStorage` will take, allowing for everything else in it.
 *
 * Browsers give an origin about 5MB and base64 costs a third on top of the
 * bytes. The preview is nowhere near this; the ladder above exists so that a
 * very wide picture still lands under it rather than failing the whole upload.
 */
const MAX_PREVIEW = 900_000;

type Listener = (conversationId?: string) => void;
const listeners = new Set<Listener>();

function notify(conversationId?: string): void {
  for (const listen of listeners) listen(conversationId);
}

/**
 * Resolved wallpaper choice for a thread.
 *
 * For groups, pass the server fields so every member sees the same room.
 * For DMs/AI, omit them and the local per-chat (or legacy global) choice wins.
 */
export interface WallpaperScope {
  conversationId: string;
  /** Group/community: server is the source of truth. */
  shared?: boolean;
  serverWallpaperId?: string;
  serverWallpaperPhotoUrl?: string;
}

/** Object URLs for local custom originals, keyed by conversation id. */
const originalUrls = new Map<string, string>();
/** Migrated global original, used only as fallback for chats with no own photo. */
let globalOriginalUrl: string | undefined;

export function chosenWallpaperId(scope: string | WallpaperScope): string {
  const conversationId = typeof scope === 'string' ? scope : scope.conversationId;
  const shared = typeof scope === 'string' ? false : Boolean(scope.shared);
  const serverId = typeof scope === 'string' ? undefined : scope.serverWallpaperId;

  if (shared) {
    return serverId && WALLPAPERS.some((w) => w.id === serverId) ? serverId : 'default';
  }

  try {
    return (
      window.localStorage.getItem(idKey(conversationId)) ??
      window.localStorage.getItem(GLOBAL_KEY) ??
      'default'
    );
  } catch {
    return 'default';
  }
}

/**
 * The best local custom photo available: original object URL if loaded, else
 * the synchronous preview. For shared custom wallpapers the server URL is used
 * instead - see `customWallpaperPhoto`.
 */
export function customWallpaperPhoto(scope: string | WallpaperScope): string | undefined {
  const conversationId = typeof scope === 'string' ? scope : scope.conversationId;
  const shared = typeof scope === 'string' ? false : Boolean(scope.shared);
  const serverPhoto =
    typeof scope === 'string' ? undefined : scope.serverWallpaperPhotoUrl;

  if (shared) {
    return serverPhoto || undefined;
  }

  const own = originalUrls.get(conversationId);
  if (own) return own;
  try {
    const preview = window.localStorage.getItem(photoKey(conversationId));
    if (preview) return preview;
    // Legacy whole-app photo until the chat gets its own.
    if (globalOriginalUrl) return globalOriginalUrl;
    return window.localStorage.getItem(GLOBAL_PHOTO_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function adoptOriginal(conversationId: string, blob: Blob | undefined): void {
  const previous = originalUrls.get(conversationId);
  if (previous) URL.revokeObjectURL(previous);
  if (blob) originalUrls.set(conversationId, URL.createObjectURL(blob));
  else originalUrls.delete(conversationId);
}

async function hydrateConversation(conversationId: string): Promise<void> {
  const blob = await localGet<Blob>(STORE.media, originalKey(conversationId));
  if (!blob || originalUrls.has(conversationId)) return;
  adoptOriginal(conversationId, blob);
  notify(conversationId);
}

async function hydrateGlobalLegacy(): Promise<void> {
  const blob = await localGet<Blob>(STORE.media, GLOBAL_ORIGINAL);
  if (!blob || globalOriginalUrl) return;
  globalOriginalUrl = URL.createObjectURL(blob);
  notify();
}

/** Kick off background loads for a chat the user just opened. */
export function hydrateWallpaper(conversationId: string): void {
  if (typeof window === 'undefined') return;
  void hydrateConversation(conversationId);
}

if (typeof window !== 'undefined') void hydrateGlobalLegacy();

/**
 * The `background-image` for whatever is currently chosen for this scope.
 *
 * Falls back to the default when `custom` is selected and no photo has been
 * stored - a person who picked "your photo" and then cleared their browser
 * data should see a wallpaper, not a blank rectangle.
 */
export function wallpaperCss(scope: string | WallpaperScope): string {
  const id = chosenWallpaperId(scope);
  if (id === 'custom') {
    const photo = customWallpaperPhoto(scope);
    return photo ? `url(${JSON.stringify(photo)})` : (WALLPAPERS[0]?.css ?? '');
  }
  return WALLPAPERS.find((w) => w.id === id)?.css ?? WALLPAPERS[0]?.css ?? '';
}

/** True when the current choice needs light text over it. */
export function wallpaperIsDark(scope: string | WallpaperScope): boolean {
  const id = chosenWallpaperId(scope);
  if (id === 'custom') {
    const conversationId = typeof scope === 'string' ? scope : scope.conversationId;
    const shared = typeof scope === 'string' ? false : Boolean(scope.shared);
    if (shared) {
      // Server custom photos: assume dark-friendly text until we sample remote.
      // Light text on a light photo is worse than dark text on a dark one for
      // readability of glass chrome, so prefer dark=true for unknown custom.
      return true;
    }
    try {
      if (window.localStorage.getItem(darkKey(conversationId)) === '1') return true;
      if (window.localStorage.getItem(darkKey(conversationId)) === '0') return false;
      return window.localStorage.getItem(GLOBAL_PHOTO_KEY + ':dark') === '1';
    } catch {
      return false;
    }
  }
  /*
   * Rain darkens whatever it falls on - a wet blurred pane loses a lot of its
   * brightness - so the thread takes light text under it regardless of what is
   * behind the water.
   */
  if (id === 'rain') return true;
  return WALLPAPERS.find((w) => w.id === id)?.dark === true;
}

/** True when the choice needs a canvas rather than a CSS background. */
export function wallpaperIsLive(scope: string | WallpaperScope): boolean {
  return chosenWallpaperId(scope) === 'rain';
}

/**
 * What the rain should fall in front of.
 *
 * Your photograph if you have one, and otherwise a scene of its own - rain on
 * a window with nothing behind it is just a grey rectangle with dots.
 */
export function rainScene(scope: string | WallpaperScope): string {
  return customWallpaperPhoto(scope) ?? '/pingo-splash.jpg';
}

/** Local (DM/AI) wallpaper pick. Groups use `setGroupWallpaper` on the service. */
export function setWallpaper(conversationId: string, id: string): void {
  try {
    window.localStorage.setItem(idKey(conversationId), id);
  } catch {
    // A full or blocked store is not a reason to fail the tap; the choice just
    // does not survive the session.
  }
  notify(conversationId);
}

/**
 * Legacy / settings-only global default used when a chat has never been
 * personalised. Still written from the settings page with no `?c=` param.
 */
export function setGlobalWallpaper(id: string): void {
  try {
    window.localStorage.setItem(GLOBAL_KEY, id);
  } catch {
    // same as setWallpaper
  }
  notify();
}

export function chosenGlobalWallpaperId(): string {
  try {
    return window.localStorage.getItem(GLOBAL_KEY) ?? 'default';
  } catch {
    return 'default';
  }
}

/** Synchronous preview (or original) for the global default custom photo. */
export function globalCustomWallpaperPhoto(): string | undefined {
  if (globalOriginalUrl) return globalOriginalUrl;
  try {
    return window.localStorage.getItem(GLOBAL_PHOTO_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stores a custom photo as the whole-app default (settings page, no chat id).
 * Uses the legacy keys so every unpersonalised chat falls back to the same image.
 */
export async function setGlobalWallpaperPhoto(file: Blob): Promise<boolean> {
  try {
    const stored = await localSet(STORE.media, GLOBAL_ORIGINAL, file);
    if (stored === undefined) return false;

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const sample = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < sample.length; i += 4) {
      sum += 0.2126 * sample[i]! + 0.7152 * sample[i + 1]! + 0.0722 * sample[i + 2]!;
    }
    const luminance = sum / (sample.length / 4);

    let url = '';
    for (const quality of QUALITIES) {
      url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_PREVIEW) break;
    }

    try {
      if (url && url.length <= MAX_PREVIEW) window.localStorage.setItem(GLOBAL_PHOTO_KEY, url);
      else window.localStorage.removeItem(GLOBAL_PHOTO_KEY);
      window.localStorage.setItem(GLOBAL_PHOTO_KEY + ':dark', luminance < 128 ? '1' : '0');
    } catch {
      // first frame only
    }

    if (globalOriginalUrl) URL.revokeObjectURL(globalOriginalUrl);
    globalOriginalUrl = URL.createObjectURL(file);
    setGlobalWallpaper('custom');
    return true;
  } catch {
    return false;
  }
}

/**
 * Stores a picture as the custom wallpaper for one chat, at the size and
 * quality it came in.
 *
 * The file itself is written to IndexedDB untouched. Everything below that is
 * about the preview and the brightness test, neither of which the person ever
 * looks at directly.
 *
 * @returns false when the picture could not be read or the store refused it.
 */
export async function setWallpaperPhoto(
  conversationId: string,
  file: Blob,
): Promise<boolean> {
  try {
    /*
     * The original first, and byte for byte.
     *
     * `localSet` resolves to the key it wrote and to `undefined` on failure,
     * which is how a quota refusal is caught - the alternative is a silent
     * success where the wallpaper simply never comes back after a reload.
     */
    const stored = await localSet(STORE.media, originalKey(conversationId), file);
    if (stored === undefined) return false;

    /*
     * Then the preview, which is a separate picture made for a separate job:
     * something to paint in the first frame while the store is opening.
     *
     * `createImageBitmap` hands back a single frame, so on a GIF this is the
     * poster - correct here, and exactly the reason the original above does
     * not go anywhere near a canvas.
     */
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // How bright it is, so the thread knows whether to use light text.
    const sample = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < sample.length; i += 4) {
      sum += 0.2126 * sample[i]! + 0.7152 * sample[i + 1]! + 0.0722 * sample[i + 2]!;
    }
    const luminance = sum / (sample.length / 4);

    let url = '';
    for (const quality of QUALITIES) {
      url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_PREVIEW) break;
    }

    /*
     * A preview that will not fit is survivable, and losing the wallpaper over
     * it would not be. The original is already stored; without a preview the
     * thread simply starts on the default and swaps when IndexedDB answers,
     * which is the behaviour on any second visit anyway.
     */
    try {
      if (url && url.length <= MAX_PREVIEW) {
        window.localStorage.setItem(photoKey(conversationId), url);
      } else {
        window.localStorage.removeItem(photoKey(conversationId));
      }
      window.localStorage.setItem(darkKey(conversationId), luminance < 128 ? '1' : '0');
    } catch {
      // A full store costs the first frame and nothing else.
    }

    // Straight onto the real thing - this path has the file in hand and does
    // not need to wait for hydrate to come round again.
    adoptOriginal(conversationId, file);
    setWallpaper(conversationId, 'custom');
    return true;
  } catch {
    return false;
  }
}

/**
 * What a shared (group) custom wallpaper needs on the wire.
 *
 * Still photos are re-encoded to a modest JPEG so members are not downloading
 * multi‑MB backdrops. Animated files (GIF / animated WebP / APNG) must keep
 * their original bytes — a canvas holds one frame, so re-encoding turns a GIF
 * into a still poster of its first moment.
 */
export interface SharedWallpaperPhoto {
  blob: Blob;
  contentType: string;
  /** Filename extension without the dot, e.g. `gif` or `jpg`. */
  ext: string;
}

/** Hard ceiling for animated wallpapers (original bytes, no re-encode). */
const MAX_ANIMATED_SHARED = 6 * 1024 * 1024;

function extForContentType(type: string): string {
  if (type === 'image/gif') return 'gif';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  return 'bin';
}

/**
 * Prepare a file for group wallpaper upload.
 *
 * Animated media is uploaded as-is (within size limits). Everything else is
 * scaled to a long edge of 1600px and encoded as JPEG.
 */
export async function prepareSharedWallpaperPhoto(
  file: Blob,
): Promise<SharedWallpaperPhoto | undefined> {
  try {
    const { isAnimatedImage } = await import('./animated-image.js');
    if (await isAnimatedImage(file)) {
      if (file.size > MAX_ANIMATED_SHARED) return undefined;
      // Prefer the browser's type; GIF headers are the usual case when type is empty.
      const contentType =
        file.type && file.type.startsWith('image/')
          ? file.type
          : 'image/gif';
      return {
        blob: file,
        contentType,
        ext: extForContentType(contentType),
      };
    }

    const bitmap = await createImageBitmap(file);
    const edge = 1600;
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return undefined;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
    );
    if (!blob) return undefined;
    return { blob, contentType: 'image/jpeg', ext: 'jpg' };
  } catch {
    return undefined;
  }
}

/** Subscribes to changes, so an open conversation repaints without a reload. */
export function onWallpaperChange(listen: Listener): () => void {
  listeners.add(listen);
  return () => listeners.delete(listen);
}
