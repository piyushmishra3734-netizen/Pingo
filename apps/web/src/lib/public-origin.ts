/**
 * Canonical public origin for shareable links.
 *
 * Group invites, profile links and story shares must work for anyone who
 * receives them — not only on the device that copied them. On localhost,
 * Capacitor (`capacitor://` / `https://localhost`) and LAN preview hosts,
 * `window.location.origin` is useless to the recipient.
 *
 * Prefer `VITE_PUBLIC_APP_URL` when set - it is set on the Production branch in
 * Cloudflare Pages and deliberately *not* on Preview, so preview deploys still
 * share their own URL while production always speaks in the branded domain.
 *
 * Otherwise fall back to the canonical origin when the current one is not a
 * real public web host, and keep the live origin when it is.
 *
 * ## Both domains stay live
 *
 * `pingochat.pages.dev` is not being retired and is not redirected. It serves
 * the same app, it is in Supabase's redirect allow-list, and every link ever
 * shared from it keeps working. This constant only decides which domain *new*
 * links are written with.
 */

const PRODUCTION_ORIGIN = 'https://pingochat.xyz';

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** True when this origin must never appear in a shared link. */
function isNonPublicOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'capacitor:' || url.protocol === 'ionic:') return true;
    if (url.protocol === 'file:') return true;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
    if (host === 'android' || host.endsWith('.android') || host === '10.0.2.2') return true;
    // Private LAN — common for Vite `--host` previews on a phone.
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Origin to put in invite / profile / story share URLs.
 * Safe to call from the browser only (uses `window`).
 */
export function publicAppOrigin(): string {
  /*
   * `import.meta.env` itself can be missing, not just the key.
   *
   * Vite defines it at build time, and the verification scripts run this module
   * through plain Node where it does not exist - reading a property off it
   * threw, which is how this was found rather than shipped. A share helper that
   * cannot be imported outside the bundle is a helper nothing can test.
   */
  const env = typeof import.meta.env === 'undefined' ? undefined : import.meta.env;
  const fromEnv = env?.VITE_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    try {
      return stripTrailingSlash(new URL(fromEnv).origin);
    } catch {
      // fall through
    }
  }

  if (typeof window === 'undefined') return PRODUCTION_ORIGIN;

  const origin = window.location.origin;
  if (!origin || isNonPublicOrigin(origin)) return PRODUCTION_ORIGIN;
  return stripTrailingSlash(origin);
}

/** Absolute public URL for a path that always starts with `/`. */
export function publicAppUrl(path: string): string {
  const base = publicAppOrigin();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}
