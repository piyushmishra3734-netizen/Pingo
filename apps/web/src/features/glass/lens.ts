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
 *
 * ## And why it came down from 24,000
 *
 * That number was measured on a desktop window, and a phone is the product.
 * A chat header on a 360pt screen is about 360 by 56, which is 20,160 - under
 * the old threshold - and the composer is smaller still. So the effect this
 * module exists for was switched off on every phone, on exactly the screen it
 * was written for, and only ever appeared on a wide desktop window.
 *
 * At 14,000 both of those qualify. A long two-line bubble can now creep over
 * the line as well, which is a change in kind rather than a mistake: a handful
 * of the largest bubbles get a lens, the fifty-bubble case this guard exists to
 * prevent still cannot happen, and a bubble that big is one worth bending the
 * wallpaper through.
 */
const MIN_AREA = 14_000;

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
 * How far, in pixels, the magnification pulls at the very edge of a panel.
 *
 * This is what makes the glass a *lens* rather than a bevel. In the reference
 * images you can read a letter through the glass and it is visibly larger than
 * the same letter beside it - the body of the panel is doing something, not
 * only its rim. Edge distortion alone gives a pane with a moulded border; this
 * is the part that says there is a thickness of glass in front of you.
 *
 * Small on purpose. Past about ten pixels the middle of a header starts to
 * swim when the thread scrolls behind it.
 */
const MAGNIFY_PX = 6;

/**
 * How much of the edge band the rim bend uses, and how sharply it falls off.
 *
 * These two are not free numbers. Sampling position along an axis works out to
 * `d - BEVEL * edge * (1 - d/edge) ** BEVEL_FALLOFF`, and that only stays
 * monotonic - no pixel overtaking its neighbour - while
 * `BEVEL * BEVEL_FALLOFF <= 1`. Past that, a pixel well inside the edge gets
 * pulled all the way out to it, the same content appears twice, and the rim
 * looks *torn* rather than bent.
 *
 * It was 1 and 3, which is 3, and every panel edge in the product was folding.
 * It read as smearing and was easy to mistake for too much blur. 0.45 and 2
 * comes to 0.9: stronger than the old value across most of the band, spread
 * over a wider one, and it cannot fold.
 */
const BEVEL = 0.45;
const BEVEL_FALLOFF = 2;

/**
 * A lens normal map for one panel size.
 *
 * Two effects in one map, added together.
 *
 * **Magnification.** `feDisplacementMap` builds each output pixel by reading
 * the source somewhere else, so sampling *nearer the centre* than you are makes
 * the backdrop look bigger. The pull is proportional to how far out the pixel
 * is - zero in the middle, strongest at the edges - which is a plain uniform
 * magnification, the same thing a thick flat pane does.
 *
 * Normalised per axis rather than radially, so a wide shallow header magnifies
 * by the same visible amount as a square sheet instead of smearing sideways
 * because it happens to be long.
 *
 * **Edge distortion.** On top of that, a hard outward push in the last few
 * pixels, cubed so the middle is untouched and only the curve bends. That is
 * the pinch you see where a line runs into the side of an Apple panel.
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

  const halfW = Math.max(1, w / 2);
  const halfH = Math.max(1, h / 2);

  /*
   * One scale for the whole map, so both effects share the encoding. Whatever
   * the largest displacement either of them asks for is what 255 means.
   */
  const span = MAGNIFY_PX + edge * BEVEL;

  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // -1 at the left/top, 0 in the middle, +1 at the right/bottom.
      const nx = (x - halfW) / halfW;
      const ny = (y - halfH) / halfH;

      // Toward the centre: negative of where you are. This is the magnifying half.
      let vx = -nx * MAGNIFY_PX;
      let vy = -ny * MAGNIFY_PX;

      // Away from the nearest edge, and only within `edge` of it.
      const dx = Math.min(x, w - 1 - x);
      const dy = Math.min(y, h - 1 - y);
      if (dx < edge) {
        vx += (x < halfW ? -1 : 1) * (1 - dx / edge) ** BEVEL_FALLOFF * edge * BEVEL;
      }
      if (dy < edge) {
        vy += (y < halfH ? -1 : 1) * (1 - dy / edge) ** BEVEL_FALLOFF * edge * BEVEL;
      }

      const i = (y * w + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, 128 + (vx / span) * 127));
      image.data[i + 1] = Math.max(0, Math.min(255, 128 + (vy / span) * 127));
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
  /*
   * Follows the shorter side, which on chrome is the height - that is the
   * dimension whose curve you actually see.
   *
   * Held to about a third of it, and capped. At 45% the band reached halfway
   * across a shallow surface, so the backdrop did not refract, it melted.
   */
  const small = Math.min(w, h);
  const edge = Math.max(6, Math.min(20, small * 0.32));

  /*
   * `scale` has to match what the map was drawn against, or the two effects
   * come out at the wrong strength relative to each other. The map encodes
   * displacements over `MAGNIFY_PX + edge`, and feDisplacementMap moves a pixel
   * by `scale * (channel - 0.5)` - so the full range needs twice that span.
   */
  const scale = (MAGNIFY_PX + edge * BEVEL) * 2;
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
   * Which is also why the two materials have to be told apart: writing the
   * slab's sixteen pixels onto a water surface would turn it back into the
   * frosted panel the variant exists to replace.
   */
  const water = el.className.includes('glass-water');
  const blur = getComputedStyle(document.documentElement)
    .getPropertyValue(water ? '--water-blur' : '--glass-blur')
    .trim();
  const fallback = water ? '5px' : '16px';
  const rest = ` blur(${blur || fallback}) saturate(${water ? '160%' : '175%'})`;
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
    const surfaces = document.querySelectorAll<HTMLElement>(
      '[class*="glass-surface"], [class*="glass-water"]',
    );
    for (const el of surfaces) applyTo(el);
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
