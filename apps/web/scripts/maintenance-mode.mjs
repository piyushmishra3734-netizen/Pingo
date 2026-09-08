/**
 * Puts the maintenance page in front of everybody, or does nothing.
 *
 * ## The switch
 *
 * `MAINTENANCE` below. `true` serves the maintenance page for every URL;
 * `false` is a normal deploy and this script copies nothing. It is a constant
 * in the repository rather than an environment variable because the person who
 * needs to flip it is the person with the repository, and a Cloudflare
 * dashboard toggle is a second place to remember.
 *
 * ## Why this and not `_redirects`, and not a Function
 *
 * Cloudflare Pages looks for a static asset before it consults `_redirects` -
 * that is exactly why `/*  /index.html  200` can sit in that file without
 * breaking `/assets/*.js`. So a redirect cannot mask `/`, because `index.html`
 * is a real file and wins.
 *
 * A Function cannot either. `functions/_middleware.ts` says so in its own
 * comment, from experience: static assets take precedence over Functions too,
 * which is why the Search Console token had to be served *by* the middleware
 * rather than shipped as a file beside it.
 *
 * What cannot lose is being the file. `index.html` is what `/` serves and what
 * every SPA route rewrites to, so replacing it after the build puts the
 * maintenance page on every address there is. The application's JavaScript is
 * still sitting in `/assets`, and nothing references it, so nothing loads it.
 *
 * ## Turning it off
 *
 * Set `MAINTENANCE` to `false` and deploy. Nothing else changes - the real
 * `index.html` is rebuilt from source every time, so there is no copy to
 * restore and nothing to forget.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MAINTENANCE = false;

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'index.html');
const page = join(here, '..', 'public', 'maintenance.html');

if (!MAINTENANCE) {
  console.log('maintenance-mode: off, serving the app');
  process.exit(0);
}

if (!existsSync(page)) {
  // Loud, because a maintenance window with no maintenance page would deploy
  // the app to people who were told it was down.
  console.error(`maintenance-mode: ${page} is missing, refusing to deploy`);
  process.exit(1);
}

copyFileSync(page, dist);
console.log('maintenance-mode: ON - every route now serves maintenance.html');
