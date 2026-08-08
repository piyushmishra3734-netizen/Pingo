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
 * ## Presets are CSS, the custom one is a photograph
 *
 * A preset is a few hundred bytes of gradient, so all of them together cost
 * less than one icon. The custom one is the person's own file, and it is kept
 * exactly as they chose it.
 *
 * ## Two copies, and why
 *
 * The original goes into IndexedDB as a `Blob`, untouched - not resized, not
 * re-encoded, not even read. That is the copy you actually see. It never
 * leaves the device, so there is no storage to be careful with beyond the
 * browser's own quota, and being careful was costing the two things that
 * matter: the quality the picture was picked for, and - on an animated GIF -
 * the animation itself. A canvas can only ever hand back one frame, so
 * anything that goes through one arrives as a poster.
 *
 * Beside it, in `localStorage`, sits a small downscaled preview.
 *
 * That is not a hedge, it is the first frame. IndexedDB has to be opened
 * asynchronously, and a conversation that starts plain and gains a wallpaper a
 * moment later is worse than one that never had it. So the preview - a few
 * hundred kilobytes, synchronous, always there - paints immediately, and the
 * original replaces it through `onWallpaperChange` as soon as the store
 * answers. On a still picture the swap is invisible; on a GIF it is the moment
 * it starts moving.
 *
 * The preview is also what the brightness test is run against, since deciding
 * whether a thread needs light text only needs one frame of it.
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
      'radial-gradient(72% 44% at 6% 2%, rgb(139 93 255 / 0.14), transparent 62%),' +
      'radial-gradient(60% 40% at 96% 14%, rgb(92 108 255 / 0.13), transparent 64%),' +
      'radial-gradient(70% 46% at 82% 98%, rgb(245 148 80 / 0.1), transparent 62%),' +
      'radial-gradient(52% 36% at 10% 88%, rgb(40 220 150 / 0.08), transparent 68%)',
  },
  {
    id: 'dawn',
    name: 'Dawn',
    css:
      'radial-gradient(80% 50% at 50% 0%, rgb(255 176 120 / 0.2), transparent 62%),' +
      'radial-gradient(70% 46% at 12% 96%, rgb(139 93 255 / 0.14), transparent 64%),' +
      'radial-gradient(60% 40% at 92% 78%, rgb(92 108 255 / 0.12), transparent 66%)',
  },
  {
    id: 'sea',
    name: 'Sea glass',
    css:
      'radial-gradient(76% 48% at 8% 6%, rgb(40 200 200 / 0.16), transparent 62%),' +
      'radial-gradient(64% 42% at 94% 24%, rgb(92 108 255 / 0.13), transparent 64%),' +
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

const KEY = 'pingo:wallpaper';
/** The synchronous preview. The original lives in `STORE.media`. */
const PHOTO_KEY = 'pingo:wallpaper-photo';
/** Key of the original inside `STORE.media`. */
const ORIGINAL = 'wallpaper';

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

type Listener = () => void;
const listeners = new Set<Listener>();

export function chosenWallpaperId(): string {
  try {
    return window.localStorage.getItem(KEY) ?? 'default';
  } catch {
    return 'default';
  }
}

/**
 * The original, once IndexedDB has answered. An object URL, or nothing yet.
 *
 * Module-level rather than passed around because every reader of this file is
 * synchronous by design - see the note at the top - and they all need to get
 * the better copy the moment it exists without any of them knowing it arrived.
 */
let originalUrl: string | undefined;

/** The best copy available right now: the original if it has loaded, else the preview. */
export function customWallpaperPhoto(): string | undefined {
  if (originalUrl) return originalUrl;
  try {
    return window.localStorage.getItem(PHOTO_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Points `originalUrl` at a blob, and releases whatever it pointed at before. */
function adoptOriginal(blob: Blob | undefined): void {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = blob ? URL.createObjectURL(blob) : undefined;
}

/**
 * Fetches the original in the background and tells everyone when it lands.
 *
 * Runs on import rather than being wired into a screen: the wallpaper is read
 * by plain functions with no lifecycle of their own, and a chat opened in the
 * first second should not have to wait for a component to remember to ask.
 * Nothing depends on it having finished - until it does, the preview is what
 * `customWallpaperPhoto` returns.
 */
async function hydrateOriginal(): Promise<void> {
  const blob = await localGet<Blob>(STORE.media, ORIGINAL);
  // A picture may have been chosen while this was in flight, and that one is
  // newer than what the store had when this started.
  if (!blob || originalUrl) return;
  adoptOriginal(blob);
  for (const listen of listeners) listen();
}

if (typeof window !== 'undefined') void hydrateOriginal();

/**
 * The `background-image` for whatever is currently chosen.
 *
 * Falls back to the default when `custom` is selected and no photo has been
 * stored - a person who picked "your photo" and then cleared their browser
 * data should see a wallpaper, not a blank rectangle.
 */
export function wallpaperCss(): string {
  const id = chosenWallpaperId();
  if (id === 'custom') {
    const photo = customWallpaperPhoto();
    return photo ? `url(${JSON.stringify(photo)})` : (WALLPAPERS[0]?.css ?? '');
  }
  return WALLPAPERS.find((w) => w.id === id)?.css ?? WALLPAPERS[0]?.css ?? '';
}

/** True when the current choice needs light text over it. */
export function wallpaperIsDark(): boolean {
  const id = chosenWallpaperId();
  if (id === 'custom') return window.localStorage.getItem(PHOTO_KEY + ':dark') === '1';
  /*
   * Rain darkens whatever it falls on - a wet blurred pane loses a lot of its
   * brightness - so the thread takes light text under it regardless of what is
   * behind the water.
   */
  if (id === 'rain') return true;
  return WALLPAPERS.find((w) => w.id === id)?.dark === true;
}

/** True when the choice needs a canvas rather than a CSS background. */
export function wallpaperIsLive(): boolean {
  return chosenWallpaperId() === 'rain';
}

/**
 * What the rain should fall in front of.
 *
 * Your photograph if you have one, and otherwise a scene of its own - rain on
 * a window with nothing behind it is just a grey rectangle with dots.
 */
export function rainScene(): string {
  return customWallpaperPhoto() ?? '/pingo-splash.jpg';
}

export function setWallpaper(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // A full or blocked store is not a reason to fail the tap; the choice just
    // does not survive the session.
  }
  for (const listen of listeners) listen();
}

/**
 * Stores a picture as the custom wallpaper, at the size and quality it came in.
 *
 * The file itself is written to IndexedDB untouched. Everything below that is
 * about the preview and the brightness test, neither of which the person ever
 * looks at directly.
 *
 * @returns false when the picture could not be read or the store refused it,
 * so the caller can say so rather than leaving somebody looking at the old one
 * and wondering.
 */
export async function setWallpaperPhoto(file: Blob): Promise<boolean> {
  try {
    /*
     * The original first, and byte for byte.
     *
     * `localSet` resolves to the key it wrote and to `undefined` on failure,
     * which is how a quota refusal is caught - the alternative is a silent
     * success where the wallpaper simply never comes back after a reload.
     */
    const stored = await localSet(STORE.media, ORIGINAL, file);
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
      if (url && url.length <= MAX_PREVIEW) window.localStorage.setItem(PHOTO_KEY, url);
      else window.localStorage.removeItem(PHOTO_KEY);
      window.localStorage.setItem(PHOTO_KEY + ':dark', luminance < 128 ? '1' : '0');
    } catch {
      // A full store costs the first frame and nothing else.
    }

    // Straight onto the real thing - this path has the file in hand and does
    // not need to wait for `hydrateOriginal` to come round again.
    adoptOriginal(file);
    setWallpaper('custom');
    return true;
  } catch {
    return false;
  }
}

/** Subscribes to changes, so an open conversation repaints without a reload. */
export function onWallpaperChange(listen: Listener): () => void {
  listeners.add(listen);
  return () => listeners.delete(listen);
}
