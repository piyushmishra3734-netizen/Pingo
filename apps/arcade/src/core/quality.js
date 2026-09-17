/**
 * Graphics quality: one setting that scales how the world is drawn, so it can
 * be built for capable devices and still be developed and played on weak ones.
 *
 * Nothing about the art changes between levels - the same world, the same
 * palette, the same composition. What scales is how much of it the GPU is
 * asked to do, roughly:
 *
 *   low      ~20k triangles   under-resolution, lightest detail
 *   medium   ~40k             most phones
 *   high     ~100k            good phones, laptops: props, flowers, smooth shapes
 *   ultra    ~200k+           desktops: everything, densest and smoothest
 *
 * Picked once at boot (the renderer's antialiasing cannot change later):
 *   `?quality=low|medium|high|ultra`  >  saved choice  >  a guess from the device.
 *
 * - detail: island smoothness (segment multiplier)
 * - props: 0 none, 1 chimneys and balconies, 2 + flowers, benches, railings, 3 + dense flowers
 * - trees: tree and bush density multiplier
 * - leaf: leaf-blob subdivision
 * - clouds: cloud billboard density
 * - sparkles: glowing motes in the air
 */

export const LEVELS = {
  low: { pixelRatio: 1, renderScale: 0.6, antialias: false, detail: 0.6, props: 0, trees: 0.6, leaf: 0, clouds: 0.6, octaves: 3, sleeperEvery: 3, sparkles: 60, fogFar: 1100 },
  medium: { pixelRatio: 1.2, renderScale: 1, antialias: false, detail: 1, props: 1, trees: 1, leaf: 1, clouds: 1, octaves: 4, sleeperEvery: 2.2, sparkles: 150, fogFar: 1300 },
  high: { pixelRatio: 1.75, renderScale: 1, antialias: true, detail: 2, props: 2, trees: 1.7, leaf: 2, clouds: 1.5, octaves: 5, sleeperEvery: 1.6, sparkles: 350, fogFar: 1700 },
  ultra: { pixelRatio: 2, renderScale: 1, antialias: true, detail: 3, props: 3, trees: 2.6, leaf: 3, clouds: 2.2, octaves: 5, sleeperEvery: 1.2, sparkles: 700, fogFar: 2200 },
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
