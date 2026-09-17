/**
 * Graphics quality: one setting that scales how the world is drawn, so it can
 * be built for capable devices and still be developed and played on weak ones.
 *
 * Nothing about the art changes between levels - the same world, the same
 * palette, the same composition. What scales is how much of it the GPU is
 * asked to do: render resolution, antialiasing, how smooth the islands and
 * leaves are, how many clouds, how far the sea's painted detail reaches.
 *
 * Picked once at boot (the renderer's antialiasing cannot change later):
 *   `?quality=low|medium|high|ultra`  >  saved choice  >  a guess from the device.
 */

export const LEVELS = {
  /** Development and weak phones: under-resolution and the lightest detail. */
  low: { pixelRatio: 1, renderScale: 0.6, antialias: false, detail: 0.6, clouds: 0.6, leaf: 0, octaves: 3, sleeperEvery: 3, fogFar: 1100 },
  /** Most phones. */
  medium: { pixelRatio: 1.2, renderScale: 1, antialias: false, detail: 1, clouds: 1, leaf: 1, octaves: 4, sleeperEvery: 2.2, fogFar: 1300 },
  /** Good phones, laptops. */
  high: { pixelRatio: 1.75, renderScale: 1, antialias: true, detail: 1.5, clouds: 1.4, leaf: 2, octaves: 5, sleeperEvery: 1.6, fogFar: 1600 },
  /** Desktops with a real GPU. */
  ultra: { pixelRatio: 2, renderScale: 1, antialias: true, detail: 2, clouds: 1.8, leaf: 2, octaves: 5, sleeperEvery: 1.2, fogFar: 2000 },
};

const KEY = 'pingo-world-quality';

/** A cautious guess: phones get medium, desktops with plenty of cores and memory get high. */
function guess() {
  const phone = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = navigator.deviceMemory ?? 4;
  if (phone) return cores >= 8 && memory >= 6 ? 'high' : 'medium';
  return cores >= 8 && memory >= 8 ? 'high' : 'medium';
}

export function pickQuality(search = location.search) {
  const asked = new URLSearchParams(search).get('quality');
  let saved;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* private window */
  }
  const name = [asked, saved].find((n) => n && LEVELS[n]) ?? guess();
  return { name, ...LEVELS[name] };
}

/** Saves a choice and reloads, since antialiasing is fixed when the renderer is made. */
export function setQuality(name) {
  if (!LEVELS[name]) return;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* private window: it lasts this visit through the URL instead */
  }
  const url = new URL(location.href);
  url.searchParams.set('quality', name);
  location.replace(url);
}
