import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Screenshots off while a view-once photo is open.
 *
 * Android's `FLAG_SECURE` refuses screenshots and screen recording for as long
 * as it is set. It is set when a picture meant to be seen once is on screen and
 * cleared the moment it closes - never for the whole app, because that would
 * take the screenshot of an ordinary conversation away from everybody, black
 * the app out in the recents switcher, and send black frames into a call the
 * moment somebody shared their screen. See `SecureScreenPlugin`.
 *
 * ## What this is not
 *
 * Nothing on the web. No browser has an API for this, so a view-once photo
 * opened at pingochat.pages.dev can still be captured and nothing here changes
 * that - the calls below are no-ops there rather than a promise that quietly
 * does not hold.
 *
 * And nothing at all about a second phone pointed at the screen. This closes
 * the one-button copy the platform was offering; it does not pretend to close
 * the rest, and the product should not say otherwise.
 */

interface SecureScreenPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
}

const plugin = registerPlugin<SecureScreenPlugin>('SecureScreen');

const native = (): boolean => Capacitor.isNativePlatform();

/**
 * Never throws, in either direction.
 *
 * Failing to set the flag means a photo that could be screenshotted, which is
 * exactly where the web already is. Failing to clear it would be worse - an app
 * that refuses screenshots for ever afterwards - so the clearing call is the
 * one that matters, and it is made from a cleanup that runs whether the viewer
 * closed or the screen simply went away.
 */
export async function secureScreen(on: boolean): Promise<void> {
  if (!native()) return;
  try {
    await (on ? plugin.enable() : plugin.disable());
  } catch {
    // A screenshot is what the web build allows anyway.
  }
}
