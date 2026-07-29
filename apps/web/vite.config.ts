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
 * works on this machine over plain HTTP — but a phone reaching
 * `http://192.168.x.x:5173` is not localhost, so `navigator.mediaDevices` is
 * simply `undefined` there. Not a permission prompt, not an error: the API does
 * not exist. Serving over HTTPS is the only thing that fixes it.
 *
 * The certificate is self-signed, so the phone will warn once and needs
 * "Advanced → Proceed". That is expected and safe on your own network; it is a
 * warning about identity, not about encryption.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
    /*
     * What makes PINGO installable at all.
     *
     * Before this there was no manifest and no service worker, which meant
     * `beforeinstallprompt` never fired anywhere — no browser on any platform
     * offered to install it. A page with an apple-mobile-web-app meta tag and
     * nothing else is not a PWA; it is a website that has read about them.
     */
    VitePWA({
      /*
       * The service worker updates itself and takes over immediately.
       *
       * The alternative — waiting for every tab to close — means somebody who
       * keeps PINGO open for days runs an old build indefinitely, and a chat
       * app is exactly the kind of thing people never close. `autoUpdate` plus
       * `skipWaiting` costs a reload at an awkward moment; the alternative
       * costs correctness.
       */
      registerType: 'autoUpdate',
      includeAssets: ['pingo-icon.png', 'pingo-maskable.png', 'pingo-wordmark.png'],

      manifest: {
        name: 'PINGO — Connect. Privately.',
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
         * The app shell, precached, which is what makes a cold launch instant
         * and what makes "works offline" true rather than aspirational.
         */
        globPatterns: ['**/*.{js,css,html,woff2}'],
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
         * `runtimeCaching`. So the NetworkFirst navigation route below — added
         * precisely to stop stale HTML — never ran once: every navigation was
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
             * Navigations go to the network first, and this is what makes a
             * deploy land on the next load rather than the one after.
             *
             * Measured, not assumed: with the shell served from precache, a
             * browser that already had PINGO open loaded the *previous*
             * bundle even though the new one was live — the HTML came from
             * disk, so it referenced the old hashed assets, and the fresh
             * service worker could only take effect the load after that. For
             * ordinary features a visit of lag is invisible. For a fix to the
             * encryption path it means the build that is wrong is the build
             * people are running.
             *
             * Three seconds, then fall back to the cached shell. Long enough
             * that a slow connection still gets the current build, short
             * enough that a dead one still opens — which is the offline
             * guarantee, kept.
             */
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pingo-shell',
              networkTimeoutSeconds: 3,
              /*
               * Every route stores under one key, because every route is the
               * same document — this is a single-page app and the server hands
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
             * Supabase is deliberately never cached.
             *
             * Messages, stories and Pings are the whole product and they are
             * *supposed* to expire — a cached Ping is a Ping that outlived its
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
     * the connection — which reads as "the server is down" from the phone.
     */
    host: true,
  },
});
