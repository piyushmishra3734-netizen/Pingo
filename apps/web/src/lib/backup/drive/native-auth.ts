/**
 * Drive authorisation on Android, through the native account picker.
 *
 * No browser, no address bar, no tab switch - the same sheet WhatsApp shows.
 * This reuses the plugin already wired for sign-in (`google-native.ts`), asking
 * it for the Drive scope at the moment Drive backup is enabled rather than at
 * sign-in, so a user who never turns backup on is never asked for their Drive.
 *
 * ## This should eventually move to AuthorizationClient
 *
 * `@codetrix-studio/capacitor-google-auth` sits on the legacy Google Sign-In
 * SDK, which Google has deprecated in favour of Credential Manager for identity
 * and `AuthorizationClient` (Google Identity Services) for scoped access.
 * `AuthorizationClient` is the right long-term home for this file: it presents
 * a native consent sheet and can re-authorise silently once granted, which is
 * what makes unattended background backup possible.
 *
 * It is not used today because there is no maintained Capacitor plugin for it
 * and writing one would delay shipping. The migration is recorded in
 * docs/e2ee-relay-and-backup-plan.md § 6.2 rather than left to be rediscovered
 * when the legacy SDK is withdrawn.
 */
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';

import { DRIVE_APPDATA_SCOPE, DriveAuthError, type DriveAuth, type DriveToken } from './auth.js';

const SERVER_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim();

/** Tokens from this SDK do not carry an expiry, so one is assumed conservatively. */
const ASSUMED_LIFETIME_MS = 45 * 60 * 1000;

interface NativeUser {
  authentication?: { accessToken?: string };
}

export class NativeDriveAuth implements DriveAuth {
  #ready = false;
  #token: DriveToken | undefined;

  /**
   * Initialised with the Drive scope, separately from sign-in.
   *
   * Sign-in initialises the same plugin with `openid email profile` and no
   * offline access. Re-initialising here with the Drive scope is what makes
   * the authorisation incremental: the consent sheet appears now, for this
   * scope, because the user just asked for Drive backup.
   */
  #init(): void {
    if (this.#ready) return;
    if (!SERVER_CLIENT_ID) {
      throw new DriveAuthError(
        'Google Drive backup is not configured on this build: VITE_GOOGLE_WEB_CLIENT_ID is missing.',
        'unconfigured',
      );
    }

    GoogleAuth.initialize({
      clientId: SERVER_CLIENT_ID,
      scopes: ['openid', 'email', 'profile', DRIVE_APPDATA_SCOPE],
      grantOfflineAccess: true,
    });

    this.#ready = true;
  }

  async authorize(): Promise<DriveToken> {
    this.#init();

    let user: NativeUser;
    try {
      user = (await GoogleAuth.signIn()) as NativeUser;
    } catch (cause) {
      /*
       * A dismissed picker and a certificate mismatch are indistinguishable
       * from here - the SDK reports both as a generic failure - so this says
       * what the user can act on rather than guessing.
       */
      throw new DriveAuthError(
        cause instanceof Error && /cancel/i.test(cause.message)
          ? 'Google Drive was not connected.'
          : 'Google did not grant Drive access. Check that this build is registered with Google.',
        'cancelled',
      );
    }

    const accessToken = user.authentication?.accessToken;
    if (!accessToken) {
      throw new DriveAuthError('Google did not return a Drive token.', 'denied');
    }

    this.#token = { accessToken, expiresAt: Date.now() + ASSUMED_LIFETIME_MS };
    return this.#token;
  }

  /**
   * Refreshed without a prompt, which is what background backup depends on.
   *
   * `refresh` returns a new access token for the account already chosen, so a
   * backup that starts while the app is in the background does not need the
   * user present.
   */
  async silent(): Promise<DriveToken | undefined> {
    if (!this.#ready) return this.#token;

    try {
      const refreshed = (await GoogleAuth.refresh()) as { accessToken?: string };
      if (refreshed.accessToken) {
        this.#token = {
          accessToken: refreshed.accessToken,
          expiresAt: Date.now() + ASSUMED_LIFETIME_MS,
        };
      }
    } catch {
      // Keep whatever is held; the caller decides whether it is still usable.
    }

    return this.#token;
  }

  async disconnect(): Promise<void> {
    this.#token = undefined;
    this.#ready = false;
    try {
      await GoogleAuth.signOut();
    } catch {
      /* Already signed out of the picker, or never initialised. */
    }
  }
}

/** Whichever door this platform has. Chosen once, at the call site. */
export async function driveAuthForPlatform(): Promise<DriveAuth> {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) return new NativeDriveAuth();
  const { WebDriveAuth } = await import('./web-auth.js');
  return new WebDriveAuth();
}
