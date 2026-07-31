/**
 * Drive authorisation in a browser.
 *
 * Google Identity Services, token flow, in a popup. Requested when the user
 * enables Drive backup and never at sign-in - the ID token that authenticates
 * the session and the access token that reaches Drive are different artefacts
 * for different purposes, and bundling them would ask every user for their
 * Drive at signup.
 *
 * ## The web cannot refresh silently, and says so
 *
 * A refresh token would have to be exchanged server-side, which means our
 * server holding a credential that can read the user's Drive. That is a worse
 * trade than asking again, so `silent()` returns the token it already has while
 * it is valid and undefined once it is not. The caller then prompts rather than
 * dying halfway through an upload.
 *
 * The practical consequence, stated rather than discovered: on the web, backup
 * happens while the tab is open. Background and periodic backup is Android.
 */
import { DRIVE_APPDATA_SCOPE, DriveAuthError, isExpired, type DriveAuth, type DriveToken } from './auth.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        prompt?: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

function gis(): GoogleIdentity | undefined {
  return (globalThis as unknown as { google?: GoogleIdentity }).google;
}

/** Loaded on demand: a script most sessions never need should not be in the critical path. */
async function loadGis(): Promise<GoogleIdentity> {
  if (gis()) return gis()!;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('load failed')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('load failed'));
    document.head.append(script);
  });

  const loaded = gis();
  if (!loaded) throw new DriveAuthError('Google sign-in could not be loaded.', 'failed');
  return loaded;
}

/**
 * Where the token lives between page loads.
 *
 * Holding it only in memory made connecting useless: the grant survived, the
 * token did not, and the screen went on saying "Connected" from persisted state
 * while every backup failed with "access expired". Measured against real Google
 * - connect succeeded, one reload later Backup Now could not reach Drive at all.
 *
 * Sealed with the device database key like every other record. It is a bearer
 * token for `drive.appdata` and nothing else, it expires within the hour, and
 * the alternative is a feature that cannot be used twice.
 */
const TOKEN_KEY = 'drive-token';

export class WebDriveAuth implements DriveAuth {
  #token: DriveToken | undefined;

  constructor(private readonly clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim()) {}

  async #remember(token: DriveToken): Promise<void> {
    this.#token = token;
    const [{ sealRecord }, { STORE, localSet }] = await Promise.all([
      import('../../crypto/session.js'),
      import('../../local/db.js'),
    ]);
    await localSet(STORE.meta, TOKEN_KEY, await sealRecord(token));
  }

  async #recall(): Promise<DriveToken | undefined> {
    if (this.#token) return this.#token;
    const [{ openRecord }, { STORE, localGet }] = await Promise.all([
      import('../../crypto/session.js'),
      import('../../local/db.js'),
    ]);
    const stored = await openRecord<DriveToken>(await localGet<unknown>(STORE.meta, TOKEN_KEY));
    if (stored) this.#token = stored;
    return stored;
  }

  async #forget(): Promise<void> {
    this.#token = undefined;
    const { STORE, localDelete } = await import('../../local/db.js');
    await localDelete(STORE.meta, TOKEN_KEY);
  }

  async authorize(): Promise<DriveToken> {
    if (!this.clientId) {
      throw new DriveAuthError(
        'Google Drive backup is not configured on this build: VITE_GOOGLE_WEB_CLIENT_ID is missing.',
        'unconfigured',
      );
    }

    const google = await loadGis();

    const token = await new Promise<DriveToken>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId!,
        scope: DRIVE_APPDATA_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new DriveAuthError('Google Drive access was not granted.', 'denied'));
            return;
          }
          resolve({
            accessToken: response.access_token,
            expiresAt: response.expires_in ? Date.now() + response.expires_in * 1000 : undefined,
          });
        },
        error_callback: (error) => {
          // A closed popup is a cancellation, not a failure to report loudly.
          const cancelled = error.type === 'popup_closed' || error.type === 'popup_failed_to_open';
          reject(
            new DriveAuthError(
              cancelled ? 'Google Drive was not connected.' : 'Google Drive authorisation failed.',
              cancelled ? 'cancelled' : 'failed',
            ),
          );
        },
      });

      client.requestAccessToken();
    });

    await this.#remember(token);
    return token;
  }

  /**
   * The stored token, if it is still worth using.
   *
   * An expired one is discarded rather than returned, so the caller is told to
   * reconnect instead of discovering it mid-upload as a 401 that looks like
   * corruption.
   */
  async silent(): Promise<DriveToken | undefined> {
    const token = await this.#recall();
    if (!token) return undefined;
    if (isExpired(token, 0)) {
      await this.#forget();
      return undefined;
    }
    return token;
  }

  async disconnect(): Promise<void> {
    const token = this.#token?.accessToken ?? (await this.#recall())?.accessToken;
    await this.#forget();
    // Best effort: revoking at Google is courteous but the local grant is what
    // this app relies on, and a failed revoke must not leave it connected here.
    if (token) {
      try {
        gis()?.accounts.oauth2.revoke(token);
      } catch {
        /* already gone, or GIS never loaded */
      }
    }
  }
}
