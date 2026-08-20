import { readFileSync } from 'node:fs';

import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The one value in this file that comes from outside it.
 *
 * `.env` is Vite's file, not Node's. Vite loads it when it builds the web
 * bundle, so `import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID` is correct inside the
 * app - but this config is evaluated by `cap sync` under plain Node, where
 * `process.env` knows nothing about it. The shipped v2.26.34.1 APK went out
 * with `serverClientId: ""` for exactly that reason: the web half of the build
 * had the id, the native half silently did not, and Google Sign-In on Android
 * fails with no clue as to why.
 *
 * So the file is read here too. Six lines against an entire class of build that
 * looks correct, installs correctly, and cannot back anything up.
 */
function fromEnvFile(name: string): string | undefined {
  /*
   * Both spellings, because this file is read from two places: `cap sync` runs
   * in `apps/web`, and the release script runs it from the repository root.
   *
   * Deliberately not `import.meta.url`, which would be the obvious way to find
   * a file beside this one and is the way that breaks: the Capacitor CLI loads
   * this config through a CommonJS require hook, and any `import.meta` in it
   * fails the parse with "exports is not defined in ES module scope" - which
   * reads like a broken toolchain rather than one unavailable expression.
   */
  for (const path of ['.env', 'apps/web/.env']) {
    try {
      const line = readFileSync(path, 'utf8')
        .split('\n')
        .find((row) => row.trimStart().startsWith(`${name}=`));
      // Quotes are allowed in a dotenv value and are not part of it.
      const value = line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    } catch {
      // Not here; try the other spelling. No file at all is a normal state -
      // CI passes the value in the environment.
    }
  }
  return undefined;
}

const GOOGLE_WEB_CLIENT_ID =
  process.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim() || fromEnvFile('VITE_GOOGLE_WEB_CLIENT_ID') || '';

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
     * to a repository is a value nobody can rotate. See `fromEnvFile` for why
     * the environment alone was not enough.
     */
    GoogleAuth: {
      serverClientId: GOOGLE_WEB_CLIENT_ID,
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
      /*
       * Sampled from the splash artwork, not chosen: this is the solid frame
       * Android shows before the image is ready, and a colour that is not the
       * image's own reads as a flash of something else on every cold launch.
       */
      backgroundColor: '#FAF8F6',
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
