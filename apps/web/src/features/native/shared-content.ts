/**
 * Things shared into PINGO from another app.
 *
 * Android hands a share to the activity, not to the page, so `MainActivity`
 * catches it and calls the functions registered here. Text arrives as a string;
 * an image arrives on the same channel a keyboard GIF uses, becomes a `File`,
 * and joins the paste path - one way in rather than two.
 *
 * ## Held, not pushed
 *
 * A share usually *starts* the app, so it exists before the WebView has
 * finished loading. The native side keeps it and hands it over when asked,
 * which is why `askNativeForShare` exists: whichever of the two is ready second
 * is the one that delivers, and neither has to know about the other's timing.
 */

declare global {
  interface Window {
    __pingoSharedText?: (text: string) => void;
    /** Capacitor exposes the activity's `@JavascriptInterface` methods here. */
    AndroidShare?: { flushShare?: () => void };
  }
}

/**
 * Registers a receiver for shared text.
 *
 * @returns the function that removes it, so a screen that has gone cannot
 * receive a share meant for the one that replaced it.
 */
export function receiveSharedText(onText: (text: string) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  window.__pingoSharedText = onText;
  askNativeForShare();

  return () => {
    delete window.__pingoSharedText;
  };
}

/**
 * Tells the native side a receiver is ready.
 *
 * Safe to call when there is nothing waiting, and safe on the web where the
 * interface does not exist - both are the ordinary case rather than an error.
 */
export function askNativeForShare(): void {
  try {
    window.AndroidShare?.flushShare?.();
  } catch {
    // Not running in the app, or the bridge is not up yet. Either way there is
    // nothing to collect and nothing to report.
  }
}
