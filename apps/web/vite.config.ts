import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * HTTPS in development is not optional here.
 *
 * The camera, the microphone and WebRTC all require a *secure context*. The
 * browser grants that to `localhost` as a special case, which is why everything
 * works on this machine over plain HTTP - but a phone reaching
 * `http://192.168.x.x:5173` is not localhost, so `navigator.mediaDevices` is
 * simply `undefined` there. Not a permission prompt, not an error: the API does
 * not exist. Serving over HTTPS is the only thing that fixes it.
 *
 * The certificate is self-signed, so the phone will warn once and needs
 * "Advanced → Proceed". That is expected and safe on your own network; it is a
 * warning about identity, not about encryption.
 */
/**
 * Em/en dashes leak into the product from AI-flavoured copy and from third-party
 * packages (notably @supabase debug strings). They read as synthetic on screen.
 * Strip them from every module at transform time so production never ships one.
 */
function stripEmDashes() {
  const re = /[\u2012\u2013\u2014\u2015\u2212]/g;
  return {
    name: 'strip-em-dashes',
    enforce: 'pre' as const,
    transform(code: string) {
      if (!re.test(code)) return null;
      // reset lastIndex after test()
      re.lastIndex = 0;
      return { code: code.replace(re, '-'), map: null };
    },
  };
}

/**
 * Which build this is, so a running client can say so.
 *
 * Cloudflare Pages sets `CF_PAGES_COMMIT_SHA`; a local build falls back to git,
 * and a checkout without git says `dev`. Seven characters is enough to tell two
 * deploys apart, and a commit hash is not information about anybody.
 *
 * This exists because a deploy was live for fifteen hours while the fleet went
 * on running the previous bundle, and nothing in production could say so.
 */
const BUILD_ID = (() => {
  const fromPages = process.env['CF_PAGES_COMMIT_SHA'];
  if (fromPages) return fromPages.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    stripEmDashes(),
    react(),
    tailwindcss(),
    basicSsl(),
    /*
     * What makes PINGO installable at all.
     *
     * Before this there was no manifest and no service worker, which meant
     * `beforeinstallprompt` never fired anywhere - no browser on any platform
     * offered to install it. A page with an apple-mobile-web-app meta tag and
     * nothing else is not a PWA; it is a website that has read about them.
     */
    VitePWA({
      /*
       * The service worker updates itself and takes over immediately.
       *
       * The alternative - waiting for every tab to close - means somebody who
       * keeps PINGO open for days runs an old build indefinitely, and a chat
       * app is exactly the kind of thing people never close. `autoUpdate` plus
       * `skipWaiting` costs a reload at an awkward moment; the alternative
       * costs correctness.
       */
      registerType: 'autoUpdate',
      /*
       * The images the app itself draws offline. The launcher icons are not
       * here: the browser fetches those from the manifest when it installs,
       * and precaching them too cost a quarter of a megabyte on first launch.
       * The splash needs nothing - it is drawn inside index.html.
       */
      includeAssets: ['pingo-mark.svg', 'pingo-favicon-32.png', 'pingo-avatar.png'],

      manifest: {
        name: 'PINGO. Connect. Privately.',
        // What fits under a home-screen icon. Anything longer is truncated by
        // the launcher, which is worse than choosing the short form yourself.
        short_name: 'PINGO',
        description:
          'Private messaging with disappearing Pings, stories that expire, and a profile that holds three posts.',
        start_url: '/chats',
        /*
         * `/chats` rather than `/`.
         *
         * `/` is the splash, which exists to decide where to send you. Someone
         * opening an installed app has already made that decision, and a splash
         * on every launch is the fastest way to make an installed app feel
         * slower than the website it replaced.
         */
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FBFBFE',
        theme_color: '#FBFBFE',
        categories: ['social', 'communication'],
        icons: [
          { src: '/pingo-icon.png', sizes: '512x512', type: 'image/png' },
          {
            /*
             * Separate from the one above, and it has to be.
             *
             * Android crops an icon to the launcher's own shape. Given the
             * transparent-cornered tile it would crop those corners a second
             * time and leave a small badge in a large empty circle. This one is
             * opaque to every edge so the crop lands where the design intended.
             */
            src: '/pingo-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        /*
         * Throw away the cached shell whenever a new worker takes over.
         *
         * The navigation route below is NetworkFirst with a three-second
         * timeout, and on a slow enough connection that timeout always wins -
         * so the shell comes from `pingo-shell`, and that shell names the
         * hashed assets of whatever build first cached it. A phone on 30 kB/s
         * therefore runs one build forever: the worker updates, the assets
         * update, and the HTML pointing at them does not.
         *
         * It is not a cache the user can clear by reloading either. Every
         * navigation is rewritten to the single key `/index.html` by the plugin
         * below, so a query string - the usual way to sidestep a stale page -
         * lands on exactly the same entry.
         *
         * A new worker activating means a new build exists, which means the
         * shell held here is by definition the previous one. Deleting it costs
         * one navigation's worth of network on the next launch and is the
         * difference between shipping a fix and shipping it to people with good
         * signal.
         */
        importScripts: ['sw-shell-reset.js'],
        /*
         * The app shell, precached, which is what makes a cold launch instant
         * and what makes "works offline" true rather than aspirational.
         */
        globPatterns: ['**/*.{js,css,html,woff2}'],
        /*
         * ...but only the shell. Precaching every chunk meant a first visit
         * downloaded 4 MB in the background - the calls library, the camera,
         * every settings screen, a dozen story fonts - on the same connection
         * the chat list was waiting on. On 2G that is minutes of contention for
         * screens most sessions never open.
         *
         * So the precache keeps what index.html names (the entry script and
         * stylesheet), the pages and workers beside it, and the app's own
         * typeface. Every other chunk is kept the first time it is opened, by
         * the `pingo-chunks` route below, and works offline from then on.
         */
        manifestTransforms: [
          async (entries) => {
            const shell = readFileSync(fileURLToPath(new URL('./dist/index.html', import.meta.url)), 'utf8');
            const manifest = entries.filter(({ url }) => {
              if (url.startsWith('assets/')) return shell.includes(url);
              if (url.startsWith('fonts/')) return url.startsWith('fonts/space-grotesk-latin');
              return true;
            });
            return { manifest, warnings: [] };
          },
        ],
        /*
         * The vision models and their runtime are excluded, all forty
         * megabytes of them. They are only needed by camera effects, most
         * people never open one, and precaching them would make every first
         * load pay for a feature most sessions never touch. They are fetched
         * on demand and cached by the browser normally.
         */
        globIgnores: ['vision/**'],
        // Raised for the app shell itself; the default 2MB would silently drop
        // the main bundle from the precache and quietly break offline start.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        /*
         * `navigateFallback` is deliberately absent, and this is the fix for a
         * bug that wasted real time three separate ways today.
         *
         * Workbox matches routes in registration order and the generated worker
         * registers the navigateFallback route *before* anything in
         * `runtimeCaching`. So the NetworkFirst navigation route below - added
         * precisely to stop stale HTML - never ran once: every navigation was
         * answered from the precache, which meant a deploy could not be seen
         * until the worker updated and the page was loaded again.
         *
         * The symptom was not merely slow rollout. A cached shell names hashed
         * assets, Cloudflare Pages deletes superseded ones, and the result was
         * a white screen; later it made a correct fix look broken because the
         * browser was still executing the previous bundle.
         *
         * Offline deep links are handled by the route below instead, which is
         * where that behaviour should have lived all along.
         *
         * It has to be set to `undefined` rather than simply left out:
         * vite-plugin-pwa fills in `navigateFallback: 'index.html'` as a
         * default, so omitting the key silently keeps the behaviour being
         * removed. Verified by reading the generated worker, which still
         * registered the route after the key was deleted.
         */
        navigateFallback: undefined,
        runtimeCaching: [
          {
            /*
             * Script and style chunks, kept the first time a screen needs them.
             * Their names carry a content hash, so a kept file can never be
             * stale - a new build asks for new names.
             */
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pingo-chunks',
              cacheableResponse: { statuses: [200] },
              /*
               * Never an HTML page under a script's name. A missing file comes
               * back as the app's index.html with a 200, and CacheFirst kept
               * that forever: the entry script was "loaded", never ran, and the
               * app sat on its skeleton on every launch (2026-10-06).
               */
              plugins: [
                {
                  cacheWillUpdate: async ({ response }: { response: Response }) =>
                    response && !(response.headers.get('content-type') ?? '').includes('text/html') ? response : null,
                },
              ],
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true },
            },
          },
          {
            /*
             * Faces, profile posts and intro slides, kept by where they live
             * rather than by the URL that fetched them.
             *
             * Posts are private and reached through signed URLs whose token
             * changes each time one is minted, so the browser saw every post as
             * a new file after each launch and downloaded it again. Keyed on the
             * storage path, a second look costs nothing. Every one of these
             * paths ends in a uuid or a timestamp, so a kept file cannot go
             * stale - a new picture is a new path.
             *
             * Chat photos and voice notes are not here: the media vault already
             * keeps those on the device (see `video-vault.ts`), and a second
             * copy would only double the space. Pings, stories and documents
             * are never kept, and neither is a ranged request, which is how
             * video is streamed.
             *
             * The fetch is made with CORS so the response is readable and can
             * be stored at its true size; an opaque one would be padded to
             * megabytes each in the browser's quota.
             */
            urlPattern: ({ url, request }) => {
              if (request.method !== 'GET' || request.headers.has('range')) return false;
              const match = /\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\//.exec(url.pathname);
              return match !== null && (match[1] === 'avatars' || match[1] === 'posts' || match[1] === 'onboarding');
            },
            handler: 'CacheFirst',
            options: {
              cacheName: 'pingo-media',
              fetchOptions: { mode: 'cors', credentials: 'omit' },
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              plugins: [
                {
                  // The same file whether it was reached signed or public, with any token.
                  cacheKeyWillBeUsed: async ({ request }) => {
                    const url = new URL(request.url);
                    return url.origin + url.pathname.replace('/object/sign/', '/object/public/');
                  },
                },
              ],
            },
          },
          {
            /*
             * Navigations go to the network first, and this is what makes a
             * deploy land on the next load rather than the one after.
             *
             * Measured, not assumed: with the shell served from precache, a
             * browser that already had PINGO open loaded the *previous*
             * bundle even though the new one was live - the HTML came from
             * disk, so it referenced the old hashed assets, and the fresh
             * service worker could only take effect the load after that. For
             * ordinary features a visit of lag is invisible. For a fix to the
             * encryption path it means the build that is wrong is the build
             * people are running.
             *
             * Three seconds, then fall back to the cached shell. Long enough
             * that a slow connection still gets the current build, short
             * enough that a dead one still opens - which is the offline
             * guarantee, kept.
             */
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pingo-shell',
              networkTimeoutSeconds: 3,
              /*
               * Every route stores under one key, because every route is the
               * same document, this is a single-page app and the server hands
               * back the identical shell for `/chats` and for a deep link into
               * a conversation.
               *
               * Without this, the offline copy exists only for URLs already
               * visited, so opening a deep link on a dead connection would
               * fail even though the shell that serves it is sitting in the
               * cache under a different name. One entry, every navigation.
               */
              plugins: [
                {
                  cacheKeyWillBeUsed: async () => '/index.html',
                },
              ],
              expiration: { maxEntries: 1 },
            },
          },
          {
            /*
             * Everything else from Supabase is deliberately never cached.
             *
             * Messages, stories and Pings are the whole product and they are
             * *supposed* to expire, a cached Ping is a Ping that outlived its
             * view limit, which is the one promise this app cannot break. So
             * the network is the only source, and offline means the app opens
             * and shows what it already had in memory, not that it serves
             * yesterday's private media from disk.
             */
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
          {
            // Fonts change never and cost a round trip on every cold start.
            urlPattern: ({ url }) => url.hostname.includes('fonts.'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pingo-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },

      devOptions: {
        // Off in dev: a service worker caching a dev server is how you spend an
        // afternoon wondering why an edit did nothing.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Fails loudly instead of silently moving to another port, which matters
    // when a second dev server would look like the app "not reloading".
    strictPort: true,
    /*
     * Bound to every interface so a phone on the same Wi-Fi can reach it.
     * Without this Vite listens on 127.0.0.1 only and the LAN address refuses
     * the connection - which reads as "the server is down" from the phone.
     */
    host: true,
  },
});
