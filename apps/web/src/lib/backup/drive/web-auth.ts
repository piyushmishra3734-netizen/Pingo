/**
 * Drive authorisation in a browser.
 *
 * Google Identity Services, token flow, in a popup. Requested when the user
 * enables Drive backup and never at sign-in — the ID token that authenticates
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
import { DRIVE_APPDATA_SCOPE, DriveAuthError, type DriveAuth, type DriveToken } from './auth.js';

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

export class WebDriveAuth implements DriveAuth {
  #token: DriveToken | undefined;

  constructor(private readonly clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim()) {}

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

    this.#token = token;
    return token;
  }

  async silent(): Promise<DriveToken | undefined> {
    return this.#token;
  }

  async disconnect(): Promise<void> {
    const token = this.#token?.accessToken;
    this.#token = undefined;
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
