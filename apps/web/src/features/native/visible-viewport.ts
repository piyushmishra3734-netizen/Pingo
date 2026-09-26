/**
 * Keeps the app the height of what is actually visible, so the composer stays
 * above the on-screen keyboard in a mobile browser.
 *
 * ## Why the composer used to vanish
 *
 * The app is a full-height flex column with the composer at the bottom, and
 * that is only right if "full height" shrinks when the keyboard opens. In a
 * mobile browser it does not by default: Android Chrome overlays the keyboard
 * on the page, and iOS Safari keeps the page tall and scrolls it up instead. So
 * the bottom of the column - the field being typed into - sat under the
 * keyboard, and people typed blind.
 *
 * Two halves, one per engine:
 *
 * - `interactive-widget=resizes-content` in the viewport meta (index.html) asks
 *   Chromium to shrink the layout itself. The flex column then does the rest.
 * - Safari ignores that, so this measures `visualViewport` - the part of the
 *   page that is really on screen - publishes it as `--app-height` for the root
 *   to use, and puts back the scroll Safari adds when it opens the keyboard.
 *
 * Not in the Android app: its WebView resizes natively (capacitor.config.ts),
 * and measuring on top of that would fight it.
 */
export function trackVisibleViewport(): () => void {
  const view = window.visualViewport;
  if (!view) return () => undefined;
  const root = document.documentElement;

  let last = 0;
  const update = () => {
    // Pinch-zoom also shrinks the visual viewport; that is not a keyboard.
    if (view.scale > 1.01) return;
    /*
     * Never taller than the layout viewport.
     *
     * While a list scrolls, Chrome slides its address bar away and the visual
     * viewport grows past the page by up to fifty pixels - every frame. Taking
     * that as the app's height resized the whole layout on every frame of every
     * scroll, which is the jiggle. Only something *shorter* than the page is a
     * keyboard, and that is the only case this is for.
     */
    const height = Math.round(Math.min(view.height, window.innerHeight));
    if (Math.abs(height - last) > 1) {
      last = height;
      root.style.setProperty('--app-height', `${height}px`);
    }
    // Safari scrolls the whole page up to show the field. Put it back - but only
    // while a keyboard is actually up, never in the middle of an ordinary scroll.
    const keyboard = window.innerHeight - view.height > 80;
    if (keyboard && (view.offsetTop > 0 || window.scrollY > 0)) window.scrollTo(0, 0);
  };

  update();
  view.addEventListener('resize', update);
  view.addEventListener('scroll', update);
  return () => {
    view.removeEventListener('resize', update);
    view.removeEventListener('scroll', update);
    root.style.removeProperty('--app-height');
  };
}
