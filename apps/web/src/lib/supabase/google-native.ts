import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import type { OAuthAuth } from '@pingo/core';

import type { PingoSupabaseClient } from './client.js';

/**
 * Google, natively, on Android.
 *
 * ## Why this exists alongside the redirect flow rather than replacing it
 *
 * On the web, `signInWithOAuth` sends the browser to Google and Supabase
 * handles the return. That is correct there and impossible here: the app has no
 * address bar, and a redirect out to a browser and back is exactly the seam
 * that makes a wrapped website feel like one. Android has its own account
 * picker, and using it is most of what "sign in like WhatsApp" means.
 *
 * The web keeps its flow untouched. `App.tsx` picks between them once, on
 * platform, and every screen above is unaware there are two.
 *
 * ## The audience problem, which is the whole reason this is subtle
 *
 * The Android OAuth client authorises *this app* — it is matched on package
 * name and signing certificate and holds no secret. But the ID token it
 * produces has to be accepted by Supabase, and Supabase only trusts tokens
 * issued for **its own** client. So the native sign-in is told a
 * `serverClientId`: the *Web* client ID from the same Google Cloud project.
 *
 * Google then issues a token whose `aud` is the web client, delivered to an app
 * proven to be ours. Without it the token is minted for the Android client,
 * Supabase rejects it as a wrong audience, and the error says nothing useful
 * about why.
 *
 * ## `signInWithIdToken`, not a session we assemble
 *
 * The plugin hands back an ID token and nothing more. Supabase verifies it
 * against Google's keys and issues its own session — so the account, its RLS
 * identity and its refresh cycle are produced exactly as they are on the web.
 * Nothing here fabricates a session, and the token never becomes one client
 * side.
 *
 * The result arrives through `onSessionChange` like every other sign-in, which
 * is why `start()` still returns nothing and why no screen had to change.
 */

/** The *Web* client ID. See the audience note above — not the Android one. */
const SERVER_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim();

export class SupabaseNativeGoogleAuth implements OAuthAuth {
  #ready = false;

  constructor(private readonly client: PingoSupabaseClient) {}

  /**
   * Initialised on first use, not at construction.
   *
   * `GoogleAuth.initialize` touches native code, and doing it while the app is
   * still starting delays first paint to prepare something most launches never
   * use — nobody signs in twice.
   */
  #init(): void {
    if (this.#ready) return;

    GoogleAuth.initialize({
      clientId: SERVER_CLIENT_ID,
      /*
       * The same three as the web flow. A scope we do not need is a scope we do
       * not ask for, and the two doors must not differ in what they request —
       * a person signing in on a phone should not grant more than on a laptop.
       */
      scopes: ['openid', 'email', 'profile'],
      /*
       * We want an ID token, not an access token to call Google APIs with. This
       * asks for the offline/server flow, which is what produces one addressed
       * to `serverClientId`.
       */
      grantOfflineAccess: false,
    });

    this.#ready = true;
  }

  async start(): Promise<void> {
    if (!SERVER_CLIENT_ID) {
      /*
       * Failing here, loudly, rather than opening a picker that cannot succeed.
       *
       * Without the web client ID every sign-in ends in an audience mismatch
       * from Supabase, whose message describes a token problem rather than a
       * missing configuration value. This says which one.
       */
      throw new Error(
        'Google sign-in is not configured on this build: VITE_GOOGLE_WEB_CLIENT_ID is missing.',
      );
    }

    this.#init();

    const user = await GoogleAuth.signIn();
    const token = user.authentication?.idToken;

    if (!token) {
      /*
       * Reachable when the picker is dismissed, and when Google declines to
       * issue a token because the app's certificate does not match the Android
       * client. The two are indistinguishable from here.
       */
      throw new Error('Google did not return an ID token.');
    }

    const { error } = await this.client.auth.signInWithIdToken({
      provider: 'google',
      token,
    });

    if (error) throw error;

    // No return value, exactly as the web flow: the session arrives through
    // `onSessionChange`, and everything above this layer is unchanged.
  }
}
