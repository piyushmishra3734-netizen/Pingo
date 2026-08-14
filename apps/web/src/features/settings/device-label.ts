/**
 * What this device calls itself, for the owner's own list.
 *
 * ## Read off the user agent, and that is fine here
 *
 * User-agent sniffing is the wrong way to decide what a browser can do and the
 * right way to answer "which of these three rows is my laptop?". Nothing
 * branches on this string - it is shown to one person, who already knows the
 * answer and only needs reminding.
 *
 * ## Deliberately vague
 *
 * "Chrome on Windows", not a version, not a screen size, not a model number. A
 * device list needs to be recognisable, not identifying: this row is readable
 * by nobody else, but the less of a fingerprint it is, the less there is to
 * leak the day that stops being true.
 */

/** Best-effort name for the current browser and platform. Never throws. */
export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';

  const ua = navigator.userAgent || '';
  const browser = browserName(ua);
  const platform = platformName(ua);

  if (browser && platform) return `${browser} on ${platform}`;
  return browser || platform || 'Unknown device';
}

function browserName(ua: string): string {
  // Order matters: every one of these also says "Safari", and most also say
  // "Chrome", so the most specific claim has to be tested first.
  if (/\bEdgA?\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera';
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return 'Firefox';
  if (/\bCriOS\//.test(ua)) return 'Chrome';
  if (/\bChrome\//.test(ua)) return 'Chrome';
  if (/\bSafari\//.test(ua)) return 'Safari';
  return '';
}

function platformName(ua: string): string {
  if (/\bAndroid\b/.test(ua)) return 'Android';
  // An iPad reporting desktop Safari is the normal case, not the exception.
  if (/\biPhone\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'Mac';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return '';
}
