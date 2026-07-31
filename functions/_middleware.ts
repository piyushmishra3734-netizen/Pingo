/**
 * Google Search Console HTML-file verification.
 *
 * ## Why a Function, not public/*.html
 *
 * Cloudflare Pages always pretty-URL redirects static `*.html` assets:
 * `/file.html` → 308 → `/file`. Our earlier `_redirects` rewrite of `/file` back
 * to `/file.html` closed a loop (ERR_TOO_MANY_REDIRECTS). Static assets also
 * take precedence over Functions, so the token cannot ship as a public HTML
 * asset if we need a non-redirecting `.html` URL.
 *
 * This middleware returns HTTP 200 with the exact token body for the
 * verification path only. Every other request falls through to static assets /
 * the SPA `_redirects` rule. Scoped further by `public/_routes.json` so the
 * Function is not invoked for normal page traffic.
 *
 * Canonical token text is also kept at `gsc/google9eb59f0b9fa61b45.html`
 * (not deployed as a static asset). Do not change the body string.
 */

const VERIFICATION_PATH = '/google9eb59f0b9fa61b45.html';

/** Exact token Google expects. Keep identical to gsc/google9eb59f0b9fa61b45.html. */
const VERIFICATION_BODY = 'google-site-verification: google9eb59f0b9fa61b45.html\n';

export const onRequest = async (context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> => {
  const { pathname } = new URL(context.request.url);

  if (pathname === VERIFICATION_PATH) {
    return new Response(VERIFICATION_BODY, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return context.next();
};
