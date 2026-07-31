/**
 * Google Drive AppData, over plain HTTPS.
 *
 * Identical in the Android WebView and in a browser - only the token above it
 * differs - so there is one implementation of the part that can be wrong in
 * interesting ways: resuming a half-finished upload, telling a dead token from
 * a dead network, and never overwriting something newer.
 *
 * `appDataFolder` is a per-application folder the user cannot see or delete by
 * accident, and its contents count against their Drive quota rather than ours.
 * Nothing outside it is ever touched: `drive.appdata` cannot reach the user's
 * own files even if this code asked it to.
 */
import { DriveAuthError, isExpired, type DriveAuth } from './auth.js';

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES = 'https://www.googleapis.com/drive/v3/files';

/** Injectable so verification can drive the resume and 401 paths deterministically. */
export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export interface DriveFile {
  id: string;
  name: string;
  size?: number;
  modifiedTime?: string;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly code: 'auth' | 'network' | 'not-found' | 'conflict' | 'failed',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

/** 512 KiB. Google requires resumable chunks to be a multiple of 256 KiB. */
export const UPLOAD_CHUNK = 512 * 1024;

export class DriveClient {
  /*
   * `fetch` is bound, not passed bare.
   *
   * `http: Http = fetch` detaches the function from `window`, so calling
   * `this.http(...)` invokes it with `this` set to the client and the browser
   * refuses: "Failed to execute 'fetch' on 'Window': Illegal invocation". Every
   * verification suite injected its own transport, so the default was never
   * once executed and no test could have caught it - the first real backup did,
   * immediately.
   */
  constructor(
    private readonly auth: DriveAuth,
    private readonly http: Http = (url, init) => fetch(url, init),
  ) {}

  /**
   * A token that is valid now, asked for each time.
   *
   * Deliberately not cached on this object. An earlier version held the last
   * good token and reused it while it had not expired, which meant
   * disconnecting Drive did not stop uploads: the grant was gone and the cache
   * did not know. `auth` is the only thing that knows whether access still
   * exists, so it is asked every time rather than remembered.
   *
   * The cost is one call per request into a layer that does its own caching  - 
   * Android's returns a cached grant, the web's returns a stored token. The
   * benefit is that revocation takes effect immediately, which is the whole
   * point of a disconnect button.
   */
  async #accessToken(): Promise<string> {
    const silent = await this.auth.silent();
    if (silent && !isExpired(silent)) return silent.accessToken;

    throw new DriveAuthError('Google Drive access has expired. Reconnect to continue.', 'expired');
  }

  async #send(url: string, init: RequestInit, retryOn401 = true): Promise<Response> {
    const token = await this.#accessToken();
    const response = await this.http(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });

    /*
     * One retry, with a forced refresh. A token can expire between the check
     * and the call, and failing the whole backup for a race that a single
     * retry fixes would be its own bug. Twice would be a loop.
     */
    if (response.status === 401 && retryOn401) {
      return this.#send(url, init, false);
    }

    return response;
  }

  async find(name: string): Promise<DriveFile | undefined> {
    const query = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}'`);
    const url = `${FILES}?spaces=appDataFolder&q=${query}&fields=files(id,name,size,modifiedTime)`;
    const response = await this.#send(url, { method: 'GET' });

    if (response.status === 401) throw new DriveError('Not authorised for Drive.', 'auth', 401);
    if (!response.ok) throw new DriveError(`Drive list failed (${response.status}).`, 'failed', response.status);

    const body = (await response.json()) as { files?: DriveFile[] };
    return body.files?.[0];
  }

  async list(prefix: string): Promise<DriveFile[]> {
    const query = encodeURIComponent(`name contains '${prefix.replace(/'/g, "\\'")}'`);
    const url = `${FILES}?spaces=appDataFolder&q=${query}&fields=files(id,name,size,modifiedTime)`;
    const response = await this.#send(url, { method: 'GET' });
    if (!response.ok) throw new DriveError(`Drive list failed (${response.status}).`, 'failed', response.status);
    const body = (await response.json()) as { files?: DriveFile[] };
    return body.files ?? [];
  }

  /**
   * Begin a resumable upload and return the session URI.
   *
   * Kept separate from the transfer so an interrupted upload can be continued
   * against the same session rather than started again, which is the whole
   * point of resumable for a multi-megabyte archive on a phone.
   */
  async beginUpload(name: string, size: number, mimeType = 'application/octet-stream'): Promise<string> {
    const response = await this.#send(`${UPLOAD}?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({ name, parents: ['appDataFolder'] }),
    });

    if (!response.ok) {
      throw new DriveError(`Could not start upload (${response.status}).`, 'failed', response.status);
    }

    const location = response.headers.get('location') ?? response.headers.get('Location');
    if (!location) throw new DriveError('Drive did not return an upload session.', 'failed');
    return location;
  }

  /** How many bytes Drive already has for this session. */
  async uploadedSoFar(session: string, size: number): Promise<number> {
    const response = await this.http(session, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${size}` },
    });

    if (response.status === 200 || response.status === 201) return size;
    if (response.status !== 308) return 0;

    const range = response.headers.get('range') ?? response.headers.get('Range');
    if (!range) return 0;
    const end = Number(range.split('-')[1]);
    return Number.isFinite(end) ? end + 1 : 0;
  }

  /**
   * Transfer the body, continuing from whatever Drive already has.
   *
   * Resuming is the default rather than an error path: a phone that loses
   * signal mid-archive is the ordinary case, not the exception.
   */
  async transfer(
    session: string,
    bytes: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<DriveFile> {
    let offset = await this.uploadedSoFar(session, bytes.length);

    while (offset < bytes.length) {
      const end = Math.min(offset + UPLOAD_CHUNK, bytes.length);
      const slice = bytes.subarray(offset, end);

      const response = await this.http(session, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}`,
          'Content-Length': String(slice.length),
        },
        body: slice as unknown as BodyInit,
      });

      if (response.status === 308) {
        const range = response.headers.get('range') ?? response.headers.get('Range');
        const next = range ? Number(range.split('-')[1]) + 1 : end;
        offset = Number.isFinite(next) ? next : end;
        onProgress?.(offset, bytes.length);
        continue;
      }

      if (response.status === 200 || response.status === 201) {
        onProgress?.(bytes.length, bytes.length);
        return (await response.json()) as DriveFile;
      }

      throw new DriveError(`Upload failed (${response.status}).`, 'failed', response.status);
    }

    throw new DriveError('Upload ended without Drive confirming the file.', 'failed');
  }

  async upload(
    name: string,
    bytes: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<DriveFile> {
    const session = await this.beginUpload(name, bytes.length);
    return this.transfer(session, bytes, onProgress);
  }

  async download(fileId: string): Promise<Uint8Array> {
    const response = await this.#send(`${FILES}/${fileId}?alt=media`, { method: 'GET' });
    if (response.status === 404) throw new DriveError('That backup is no longer in Drive.', 'not-found', 404);
    if (!response.ok) throw new DriveError(`Download failed (${response.status}).`, 'failed', response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  async remove(fileId: string): Promise<void> {
    const response = await this.#send(`${FILES}/${fileId}`, { method: 'DELETE' });
    // Already gone is the desired state, not a failure.
    if (response.status === 404) return;
    if (!response.ok) throw new DriveError(`Delete failed (${response.status}).`, 'failed', response.status);
  }
}
