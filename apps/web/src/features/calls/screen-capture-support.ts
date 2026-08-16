import { canCaptureScreen } from './screen-share-rules.js';

/**
 * Whether this device can share a screen, asked of the real environment.
 *
 * The rule itself lives in `screen-share-rules` so it can be asserted without a
 * browser. This is the part that reads the browser, and it is deliberately the
 * only place that does.
 */

/**
 * A mobile browser, as well as this can be known.
 *
 * `userAgentData.mobile` is the answer where it exists - it is a real boolean
 * the browser maintains rather than a string we are guessing at. Everywhere
 * else falls back to the user-agent string, which is exactly as unreliable as
 * its reputation and is still the only thing on offer in Safari and Firefox.
 *
 * Over-reporting mobile costs somebody a control they could have used;
 * under-reporting gives somebody a button that can never work and a retry that
 * will never succeed. The second is worse, so the test is deliberately broad.
 */
function isMobileBrowser(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData;
  if (typeof data?.mobile === 'boolean') return data.mobile;

  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; the touch points are what give it away.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || iPadOS;
}

/**
 * Whether the native shell can capture the screen for us.
 *
 * Nothing sets this yet. It is the hook the Android side will fill in -
 * `MediaProjection` behind a Capacitor plugin - and it is here now so the rule
 * has somewhere to read it from rather than being rewritten later.
 */
function hasNativeCapture(): boolean {
  return Boolean(
    (globalThis as { Capacitor?: { isPluginAvailable?: (name: string) => boolean } }).Capacitor
      ?.isPluginAvailable?.('ScreenCapture'),
  );
}

export function screenCaptureAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;

  return canCaptureScreen({
    hasDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    mobile: isMobileBrowser(),
    native: hasNativeCapture(),
  });
}
