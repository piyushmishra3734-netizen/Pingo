/**
 * Images the Android keyboard hands over.
 *
 * ## Why this exists at all
 *
 * Choosing a GIF in Gboard sends it by committing content to the focused input.
 * A WebView refuses that: no paste event, no file, no clipboard entry - the
 * image simply never arrives, and there is nothing the web side can do about
 * it. `MainActivity` catches it in Java and calls the function registered here.
 *
 * ## One entry point, shared with paste
 *
 * The native side produces a `File` and hands it to the same callback that
 * handles a pasted or dropped image. A GIF from the keyboard, a screenshot
 * pasted from the clipboard and a file dragged in are the same event as far as
 * the composer is concerned, and giving the keyboard its own path would mean
 * two places to fix the day sending changes.
 *
 * ## A global, deliberately
 *
 * Java can only reach the page through `evaluateJavascript`, so something has
 * to be on `window`. It is registered by whichever composer is mounted and
 * removed when that composer goes, so an image can never be delivered to a
 * screen that is no longer showing.
 */

declare global {
  interface Window {
    __pingoKeyboardImage?: (base64: string, mime: string) => void;
  }
}

/** `image/gif` to `.gif`. Falls back rather than producing a nameless file. */
function extensionFor(mime: string): string {
  const subtype = mime.split('/')[1] ?? 'png';
  return subtype.split('+')[0] || 'png';
}

function toFile(base64: string, mime: string): File | undefined {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    return new File([bytes], `keyboard-${Date.now()}.${extensionFor(mime)}`, { type: mime });
  } catch {
    return undefined;
  }
}

/**
 * Registers the receiver. Returns the function that removes it.
 *
 * @param onImage called with a real `File`, the same shape a paste produces.
 */
/*
 * A stack, not a single handler.
 *
 * Two things listen: the app, which turns an image into a share, and a
 * composer, which inserts it into the message being written. Both registering
 * on one global would mean the second silently replaces the first, and the
 * first would never come back when the second unmounted - so opening a chat
 * once would break sharing for the rest of the session.
 *
 * Innermost wins, which is the right answer: a composer on screen is somebody
 * already writing to somebody, and they have answered the only question a
 * share asks.
 */
const handlers: ((file: File) => void)[] = [];

export function receiveKeyboardImages(onImage: (file: File) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  handlers.push(onImage);

  window.__pingoKeyboardImage = (base64, mime) => {
    const file = toFile(base64, mime);
    const innermost = handlers[handlers.length - 1];
    if (file && innermost) innermost(file);
  };

  return () => {
    const at = handlers.lastIndexOf(onImage);
    if (at !== -1) handlers.splice(at, 1);
    if (handlers.length === 0) delete window.__pingoKeyboardImage;
  };
}
