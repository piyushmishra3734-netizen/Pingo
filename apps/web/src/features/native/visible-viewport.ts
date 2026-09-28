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
 * ## Why the composer then floated far above the keyboard on iPhone
 *
 * Shrinking the app was half of it. To show the focused field, iOS Safari also
 * *pans* the visible part of the page down (`visualViewport.offsetTop`), and on
 * a page that cannot scroll - which this one cannot, being exactly as tall as
 * what is visible - `scrollTo(0, 0)` does not undo a pan. So the app sat at the
 * top of the page while the screen showed a window starting part-way down it:
 * the composer high up, and below it a keyboard-sized band of empty page.
 *
 * The answer is to go where the window is. While a keyboard is up the body is
 * moved down by exactly the pan (`--app-top`, applied in app.css under
 * `data-keyboard-pan`), so it fills the visible part and the composer sits on
 * the keyboard. The body rather than the app root because sheets and menus are
 * portalled into the body and have to move with it.
 *
 * Not in the Android app: its WebView resizes natively (capacitor.config.ts),
 * and measuring on top of that would fight it.
 */
export function trackVisibleViewport(): () => void {
  const view = window.visualViewport;
  if (!view) return () => undefined;
  const root = document.documentElement;

  let last = 0;
  let lastPan = 0;
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
    const keyboard = window.innerHeight - view.height > 80;
    const height = Math.round(keyboard ? view.height : window.innerHeight);
    if (Math.abs(height - last) > 1) {
      last = height;
      root.style.setProperty('--app-height', `${height}px`);
    }
    // Safari scrolls the whole page up to show the field. Put it back - but only
    // while a keyboard is actually up, never in the middle of an ordinary scroll.
    if (keyboard && window.scrollY > 0) window.scrollTo(0, 0);

    // ...and where it pans instead, follow the pan. See the note at the top.
    const pan = keyboard ? Math.max(0, Math.round(view.offsetTop)) : 0;
    if (pan !== lastPan) {
      lastPan = pan;
      if (pan > 0) {
        root.style.setProperty('--app-top', `${pan}px`);
        root.setAttribute('data-keyboard-pan', '');
      } else {
        root.style.removeProperty('--app-top');
        root.removeAttribute('data-keyboard-pan');
      }
    }
  };

  update();
  view.addEventListener('resize', update);
  view.addEventListener('scroll', update);
  return () => {
    view.removeEventListener('resize', update);
    view.removeEventListener('scroll', update);
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--app-top');
    root.removeAttribute('data-keyboard-pan');
  };
}
