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
 * less than one icon. A photograph is the person's own and is kept as a data
 * URL in `localStorage` - which is a deliberate choice over IndexedDB: the
 * wallpaper has to be on screen in the first frame, and a store that has to be
 * opened asynchronously means a conversation that starts plain and changes
 * under you a moment later.
 *
 * The picture is downscaled before it is stored. A modern phone camera
 * produces four megabytes; nothing behind a chat needs more than a screen's
 * worth, and `localStorage` would refuse the original anyway.
 */

export interface Wallpaper {
  id: string;
  name: string;
  /** A `background-image` value. Absent on `custom`, which carries a photo. */
  css?: string;
  /** True where the picture is dark enough that the thread should invert. */
  dark?: boolean;
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
  { id: 'custom', name: 'Your photo' },
];

const KEY = 'pingo:wallpaper';
const PHOTO_KEY = 'pingo:wallpaper-photo';

/** Longest edge of a stored photo. A screen's worth, and nothing more. */
const MAX_EDGE = 1400;

type Listener = () => void;
const listeners = new Set<Listener>();

export function chosenWallpaperId(): string {
  try {
    return window.localStorage.getItem(KEY) ?? 'default';
  } catch {
    return 'default';
  }
}

export function customWallpaperPhoto(): string | undefined {
  try {
    return window.localStorage.getItem(PHOTO_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

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
  return WALLPAPERS.find((w) => w.id === id)?.dark === true;
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
 * Stores a photograph as the custom wallpaper.
 *
 * @returns false when the picture could not be read or would not fit, so the
 * caller can say so rather than leaving somebody looking at the old one and
 * wondering.
 */
export async function setWallpaperPhoto(file: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    /*
     * How bright the picture is, so the thread knows whether to use light text.
     * Sampled off the downscaled copy, which is the one that will be shown.
     */
    const sample = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < sample.length; i += 4) {
      sum += 0.2126 * sample[i]! + 0.7152 * sample[i + 1]! + 0.0722 * sample[i + 2]!;
    }
    const luminance = sum / (sample.length / 4);

    const url = canvas.toDataURL('image/jpeg', 0.72);
    window.localStorage.setItem(PHOTO_KEY, url);
    window.localStorage.setItem(PHOTO_KEY + ':dark', luminance < 128 ? '1' : '0');
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
