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
  let correction = { top: 0, height: 0 };

  const apply = (height: number, pan: number) => {
    if (Math.abs(height - last) > 1) {
      last = height;
      root.style.setProperty('--app-height', `${height}px`);
    }
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
    if (!keyboard) {
      correction = { top: 0, height: 0 };
      apply(Math.round(window.innerHeight), 0);
      return;
    }
    // Safari scrolls the whole page up to show the field. Put it back - but only
    // while a keyboard is actually up, never in the middle of an ordinary scroll.
    if (window.scrollY > 0) window.scrollTo(0, 0);

    // The size of the visible part, and where it pans to. See the note at the top.
    apply(Math.round(view.height) + correction.height, Math.max(0, Math.round(view.offsetTop)) + correction.top);
  };

  /*
   * Closed loop: look at where the app really is and fix what is off.
   *
   * What Safari reports while a keyboard opens does not always agree with where
   * it has put the page - the numbers arrive before the keyboard has settled, or
   * the accessory bar above it appears after the last event - and a band of
   * empty page between the composer and the keyboard is what a wrong guess looks
   * like. So after the numbers are applied the body is measured, and any
   * difference from the visible part is added to what is applied, which makes the
   * result right whichever of the numbers was wrong. Two passes at most, so it
   * cannot chase itself.
   */
  const reconcile = (pass = 0) => {
    if (view.scale > 1.01 || window.innerHeight - view.height <= 80 || pass > 1) return;
    const rect = document.body.getBoundingClientRect();
    const dTop = Math.round(view.offsetTop - rect.top);
    const dHeight = Math.round(view.height - rect.height);
    if (Math.abs(dTop) <= 2 && Math.abs(dHeight) <= 2) return;
    correction = {
      top: Math.max(-lastPan, correction.top + dTop),
      height: correction.height + dHeight,
    };
    update();
    requestAnimationFrame(() => reconcile(pass + 1));
  };

  // The keyboard animates and its accessory bar arrives late, so look again as it settles.
  const timers: number[] = [];
  const settle = () => {
    timers.splice(0).forEach((t) => window.clearTimeout(t));
    for (const delay of [0, 80, 200, 420, 800]) {
      timers.push(
        window.setTimeout(() => {
          update();
          reconcile();
        }, delay),
      );
    }
  };

  update();
  view.addEventListener('resize', settle);
  view.addEventListener('scroll', update);
  document.addEventListener('focusin', settle);
  document.addEventListener('focusout', settle);
  window.addEventListener('orientationchange', settle);
  return () => {
    timers.forEach((t) => window.clearTimeout(t));
    view.removeEventListener('resize', settle);
    view.removeEventListener('scroll', update);
    document.removeEventListener('focusin', settle);
    document.removeEventListener('focusout', settle);
    window.removeEventListener('orientationchange', settle);
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--app-top');
    root.removeAttribute('data-keyboard-pan');
  };
}
