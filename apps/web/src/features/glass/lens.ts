/**
 * The part of liquid glass that CSS alone cannot do.
 *
 * A blurred panel is a blurred area. What makes Apple's read as a *slab* is
 * that the backdrop visibly bends near the edge - in their own screenshots the
 * terrace lines and the folds of a pair of jeans do not continue straight into
 * a panel, they pinch. That is refraction, and no combination of blur,
 * saturation and gradients produces it.
 *
 * `backdrop-filter` accepts an SVG filter by url, so it can be done: a
 * displacement map whose red channel says how far to move each pixel
 * horizontally and whose green channel says vertically, with 128 meaning "leave
 * this alone". Zero through the middle, ramping up hard towards the rim, which
 * is how a slab with a rounded edge actually behaves - the flat centre passes
 * light straight through and only the curve bends it.
 *
 * ## Why this is a module and not a line in the stylesheet
 *
 * A displacement map has to be the size of the thing it displaces, so there is
 * one filter per panel size rather than one for the product. That means
 * measuring elements, which is a thing only JavaScript can do.
 *
 * ## Chrome only, deliberately
 *
 * Each lens is a second backdrop sample. On the header, the composer and a
 * sheet - three surfaces - that is free. On a thread of fifty bubbles it is
 * not, and `backdrop-filter` on a scrolling list is the one effect that
 * reliably drops frames on cheap Android. So panels below a minimum size are
 * left with the plain material, which is what they had before and what they
 * look perfectly good with.
 */

/**
 * Below this, a panel is a pill and gets no lens.
 *
 * Area, not the shorter edge. The first version gated on `min(width, height)`
 * and excluded exactly the surfaces it was written for: chrome is wide and
 * shallow - the header measures 1520 by 69 - so its short edge is smaller than
 * a chip's. Measured on the deployed build: five glass surfaces on the chat
 * screen, four of them under the threshold, no filters generated at all.
 */
const MIN_AREA = 24_000;

/** And a floor on height, so a hairline strip never gets one either. */
const MIN_HEIGHT = 40;

/** Displacement maps, keyed by the size they were built for. */
const maps = new Map<string, string>();

/** Which filter id is serving which size, so the same one is reused. */
const filters = new Map<string, string>();

let defs: SVGDefsElement | undefined;
let nextId = 0;

function ensureDefs(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;pointer-events:none';
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.append(node);
  document.body.append(svg);
  defs = node;
  return node;
}

/**
 * A lens normal map for one panel size.
 *
 * Cubed falloff rather than linear: a linear ramp bends the whole panel
 * slightly, which reads as a smeared rectangle. The eye wants the middle
 * untouched and the last few pixels to move a lot.
 */
function lensMap(w: number, h: number, edge: number): string {
  const key = `${w}x${h}x${edge}`;
  const cached = maps.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = Math.min(x, w - 1 - x);
      const dy = Math.min(y, h - 1 - y);

      // Push outward, away from whichever edge is nearest, and only near it.
      const px = dx < edge ? (x < w / 2 ? -1 : 1) * (1 - dx / edge) ** 3 : 0;
      const py = dy < edge ? (y < h / 2 ? -1 : 1) * (1 - dy / edge) ** 3 : 0;

      const i = (y * w + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, 128 + px * 127));
      image.data[i + 1] = Math.max(0, Math.min(255, 128 + py * 127));
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const url = canvas.toDataURL();
  maps.set(key, url);
  return url;
}

function filterFor(w: number, h: number): string | undefined {
  // Follows the shorter side, which on chrome is the height - that is the
  // dimension whose curve you actually see.
  const small = Math.min(w, h);
  const edge = Math.max(8, Math.min(26, small * 0.45));
  const scale = Math.max(10, Math.min(34, small * 0.55));
  const key = `${w}x${h}`;

  const existing = filters.get(key);
  if (existing) return existing;

  const href = lensMap(w, h, edge);
  if (!href) return undefined;

  const id = `pingo-lens-${nextId++}`;
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('x', '0%');
  filter.setAttribute('y', '0%');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  filter.innerHTML =
    `<feImage href="${href}" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="m" scale="${scale}" ` +
    `xChannelSelector="R" yChannelSelector="G"/>`;

  ensureDefs().append(filter);
  filters.set(key, id);
  return id;
}

/** Whether the platform can do any of this at all. */
function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof CSS !== 'undefined' &&
    CSS.supports('backdrop-filter', 'url(#x)')
  );
}

function applyTo(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);

  if (w * h < MIN_AREA || h < MIN_HEIGHT) {
    // Too small to be chrome. Anything left over from a previous size goes,
    // so a panel that shrank does not keep a lens built for its old shape.
    el.style.removeProperty('backdrop-filter');
    el.style.removeProperty('-webkit-backdrop-filter');
    return;
  }

  const id = filterFor(w, h);
  if (!id) return;

  /*
   * The lens comes first, then the blur. That is the order light goes through
   * glass - bent at the surface, scattered inside - and reversing it blurs the
   * displacement into mush.
   *
   * The blur and saturation are repeated here rather than inherited, because
   * setting `backdrop-filter` inline replaces the stylesheet's value outright.
   */
  const blur = getComputedStyle(document.documentElement)
    .getPropertyValue('--glass-blur')
    .trim();
  const rest = ` blur(${blur || '16px'}) saturate(175%)`;
  el.style.setProperty('backdrop-filter', `url(#${id})${rest}`);
  el.style.setProperty('-webkit-backdrop-filter', `url(#${id})${rest}`);
}

let frame = 0;

/** Re-lenses every glass surface on the page. Cheap enough to call on resize. */
export function refreshLenses(): void {
  if (!supported()) return;
  if (document.documentElement.getAttribute('data-glass') === '0') return;

  window.cancelAnimationFrame(frame);
  frame = window.requestAnimationFrame(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[class*="glass-surface"]')) {
      applyTo(el);
    }
  });
}

/**
 * Starts watching for glass surfaces.
 *
 * A mutation observer rather than a hook per component: glass is applied by a
 * class from the stylesheet, so nothing in React knows which elements have it,
 * and asking every one of them to call a hook is a rule somebody will forget
 * on the day they add the next sheet.
 */
export function startLensing(): () => void {
  if (!supported()) return () => undefined;

  refreshLenses();

  const observer = new MutationObserver(() => refreshLenses());
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  const onResize = () => refreshLenses();
  window.addEventListener('resize', onResize);

  return () => {
    observer.disconnect();
    window.removeEventListener('resize', onResize);
  };
}
