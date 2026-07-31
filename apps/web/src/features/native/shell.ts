import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * The seam between PINGO and the operating system.
 *
 * ## Why this is one file and not a pattern
 *
 * The requirement is one UI everywhere, and the fastest way to lose that is to
 * let `if (isNative)` spread through components. Every screen in this app is
 * already correct on a phone; what a native shell changes is not *what* is
 * drawn but how the OS behaves around it - the splash, the status bar, the
 * hardware back button, the keyboard.
 *
 * So all of that lives here, runs once at startup, and no component ever learns
 * which platform it is on.
 *
 * ## On the web this does nothing at all
 *
 * `Capacitor.isNativePlatform()` is false in a browser and every call below is
 * skipped. The web build is unchanged - same bundle, same behaviour - which is
 * what stops "add mobile" from quietly becoming a second product.
 */

/** True inside the Android or iOS shell. False in any browser, including a PWA. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function currentPlatform(): 'android' | 'ios' | 'web' {
  const p = Capacitor.getPlatform();
  return p === 'android' || p === 'ios' ? p : 'web';
}

/**
 * Wires the OS behaviours. Call once, as early as the app has something to show.
 *
 * Returns a teardown for completeness; in practice nothing unmounts the app
 * shell, but a listener that cannot be removed is a listener that leaks in a
 * test.
 */
export async function initNativeShell(onBack: () => boolean): Promise<() => void> {
  if (!isNative()) return () => {};

  const cleanups: (() => void)[] = [];

  /*
   * The splash is dismissed here rather than on a timer.
   *
   * A fixed duration is wrong in both directions: too short and it vanishes
   * onto a blank screen while React is still mounting, too long and every
   * launch has dead time in it. This runs once the app is ready to draw, which
   * is the only moment that is actually correct.
   */
  await SplashScreen.hide().catch(() => undefined);

  /*
   * The status bar joins the app rather than sitting above it.
   *
   * PINGO's headers already pad for `env(safe-area-inset-top)`, so the content
   * is laid out expecting to own that space. Overlaying makes the glass header
   * run under the clock, which is what every native messaging app does and what
   * separates an app from a page with a gap at the top.
   */
  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
  await syncStatusBarToTheme();

  /*
   * The hardware back button, on Android.
   *
   * Without this it exits the app from anywhere - including from inside a
   * conversation, which is the single most jarring thing an Android app can do.
   * The callback returns whether it handled the press; if nothing did and there
   * is no history left, backgrounding is the correct behaviour rather than
   * killing the process, because that is what every other app does.
   */
  const backHandle = await App.addListener('backButton', ({ canGoBack }) => {
    if (onBack()) return;
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
  cleanups.push(() => void backHandle.remove());

  /*
   * The keyboard's height, published as a CSS variable.
   *
   * Android's WebView resize is unreliable across manufacturers, Samsung and
   * Xiaomi in particular report it late or not at all, so the composer cannot
   * rely on the viewport shrinking. A variable the layout can read is the one
   * mechanism that behaves the same on every device.
   */
  if (Capacitor.isPluginAvailable('Keyboard')) {
    const show = await Keyboard.addListener('keyboardWillShow', (info) => {
      document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
    });
    const hide = await Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.style.setProperty('--keyboard-height', '0px');
    });
    cleanups.push(() => void show.remove(), () => void hide.remove());
  }

  return () => {
    for (const off of cleanups) off();
  };
}

/**
 * Matches the status bar's icons to the theme.
 *
 * Called at startup and again whenever the theme changes. Getting this wrong is
 * invisible in light mode and makes the clock unreadable in dark mode, which is
 * exactly the kind of detail that tells somebody they are using a wrapped
 * website.
 */
export async function syncStatusBarToTheme(): Promise<void> {
  if (!isNative()) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
}
