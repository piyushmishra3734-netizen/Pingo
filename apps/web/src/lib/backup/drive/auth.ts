/**
 * Getting a Drive token, and nothing else.
 *
 * This is the only part of Drive backup that differs by platform. Everything
 * downstream — chunking, encryption, upload, integrity, restore — is plain
 * HTTPS and identical inside the Android WebView and a browser, so it lives in
 * one implementation that cannot drift between them.
 *
 * ## Never at sign-in
 *
 * Sign-in asks for `openid email profile` and wants an *ID token* to hand to
 * `signInWithIdToken`. Drive needs an *access token* carrying `drive.appdata`,
 * which is a different artefact for a different purpose. Bundling them would
 * ask every user for access to their Drive at signup even if they never turn
 * backup on, and the sign-in code already argues against exactly that:
 *
 *   "A scope we do not need is a scope we do not ask for, and the two doors
 *    must not differ in what they request."
 *
 * So authorisation is incremental: requested the moment Google Drive backup is
 * switched on, and never before.
 */

/** The narrowest scope that can do the job. */
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export class DriveAuthError extends Error {
  constructor(
    message: string,
    readonly code: 'cancelled' | 'unconfigured' | 'denied' | 'expired' | 'failed',
  ) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

export interface DriveToken {
  accessToken: string;
  /** Epoch millis. Absent when the platform does not say. */
  expiresAt?: number;
}

export interface DriveAuth {
  /**
   * Ask for Drive access, showing whatever consent UI the platform provides.
   *
   * Called from a user gesture — enabling Drive backup — never on a timer.
   */
  authorize(): Promise<DriveToken>;

  /**
   * Get a usable token without prompting, if the platform can.
   *
   * Android can re-authorise silently once granted, which is what makes
   * background backup possible. The web cannot without a server-side refresh
   * exchange, so it returns undefined and the caller asks the user again.
   */
  silent(): Promise<DriveToken | undefined>;

  /** Forget the grant locally. Does not revoke it at Google. */
  disconnect(): Promise<void>;
}

/**
 * A token that knows when it is stale.
 *
 * Access tokens last about an hour, and an upload that starts at minute
 * fifty-nine fails halfway through with a 401 that looks like corruption. This
 * treats anything inside the skew as already expired so the refresh happens
 * before the work rather than during it.
 */
export function isExpired(token: DriveToken, skewMs = 120_000): boolean {
  if (token.expiresAt === undefined) return false;
  return Date.now() + skewMs >= token.expiresAt;
}
