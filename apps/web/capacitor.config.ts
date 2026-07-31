import type { CapacitorConfig } from '@capacitor/cli';

/**
 * PINGO as a real installed application.
 *
 * ## One codebase, five targets
 *
 * Capacitor does not port the app - it hosts it. The same `dist` that
 * Cloudflare serves is loaded by a native shell on Android and iOS, so there is
 * no second UI, no platform-specific screen and nothing to keep in sync. A
 * change to a React component is a change to every platform at once, which is
 * the whole requirement.
 *
 * What the shell adds is the part a browser cannot: a real icon, a splash
 * screen, no address bar, native permission dialogs, deep links, push, and the
 * OS treating PINGO as an application rather than a tab.
 *
 * ## `webDir` points at the same build
 *
 * `pnpm build` produces one directory. `npx cap sync` copies it into the native
 * projects. There is deliberately no separate mobile build step, because a
 * separate build is where two platforms start to drift.
 */
const config: CapacitorConfig = {
  appId: 'chat.pingo.app',
  appName: 'PINGO',
  webDir: 'dist',

  /*
   * The scheme the app is served from inside the shell.
   *
   * This matters more than it looks. Supabase auth, WebRTC and the service
   * worker all key off the origin, and Capacitor's default on Android is
   * `http://localhost`, which is a *non-secure* origin - `getUserMedia` and
   * therefore the entire camera and calling stack simply do not exist there.
   * `https` makes the WebView treat it as a secure context, which is the
   * difference between a working camera and an API that returns undefined.
   */
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },

  android: {
    /*
     * Mixed content stays off. The app talks to Supabase and Cloudflare over
     * HTTPS and nothing else, so allowing it would only ever permit a mistake.
     */
    allowMixedContent: false,
    // Debuggable builds only in development; the release build must not be.
    webContentsDebuggingEnabled: false,
  },

  ios: {
    /*
     * PINGO draws its own safe-area padding already - every screen uses
     * `env(safe-area-inset-*)`. Letting the WebView inset as well would double
     * it, which on a notched phone is a visibly wrong header.
     */
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: true,
  },

  plugins: {
    /*
     * Google Sign-In, on Android.
     *
     * `serverClientId` is the **Web** OAuth client ID, and putting the Android
     * one here is the mistake that costs an afternoon. The Android client
     * authorises the app - Google matches it on package name and signing
     * certificate, and it holds no secret, which is why it is never named in
     * code at all. What Supabase will accept is a token issued for *its*
     * client, so Google is asked for one addressed to the web client and hands
     * it to an app already proven to be ours.
     *
     * Read from the environment rather than written here: the value differs
     * between a personal build and anything shared, and a client ID committed
     * to a repository is a value nobody can rotate.
     */
    GoogleAuth: {
      serverClientId: process.env.VITE_GOOGLE_WEB_CLIENT_ID ?? '',
      forceCodeForRefreshToken: false,
    },

    SplashScreen: {
      /*
       * Hidden by the app, not by a timer.
       *
       * A fixed duration is either too short - the splash disappears onto a
       * blank screen while React mounts - or too long, which is dead time on
       * every launch. The app calls `hide()` when it has something to show.
       */
      launchAutoHide: false,
      backgroundColor: '#FBFBFE',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },

    Keyboard: {
      /*
       * The composer sits against the keyboard by design, and the layout is a
       * flex column with one scroll region - so the web layout already handles
       * this correctly. Resizing the native WebView on top of that fights it.
       */
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
