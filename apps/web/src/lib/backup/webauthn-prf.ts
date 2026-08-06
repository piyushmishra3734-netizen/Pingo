/**
 * A passkey, used as a key rather than as a login.
 *
 * WebAuthn normally answers "is this the right person?" and hands back a
 * signature. The PRF extension answers something more useful here: it hands
 * back **32 bytes that only this authenticator can produce**, deterministically,
 * for a salt we choose. That is a key — one that lives in the secure element of
 * a phone or laptop and cannot be copied out of it.
 *
 * So Face ID does not "unlock a screen" in PINGO. It produces the bytes that
 * open the backup, and without the authenticator those bytes do not exist.
 *
 * ## Nothing here is a login
 *
 * No credential is sent anywhere, no assertion is verified by a server, and the
 * account is not identified by it. The passkey exists on this device to derive
 * one secret. PINGO never sees it.
 *
 * ## Where it will not work
 *
 * PRF is not universal — see `passkey-support.ts`, which measures without
 * creating anything. Where it is missing the user picks a passcode instead, and
 * the rest of the system cannot tell the difference.
 */

import {
  nativePasskeyAvailable,
  nativePasskeyCreate,
  nativePasskeyGet,
} from '../../features/native/passkey.js';

/** The salt is fixed and public: PRF's secrecy comes from the authenticator. */
const PRF_SALT = new TextEncoder().encode('pingo/backup-lock/v1');

/**
 * The relying party the app registers passkeys against.
 *
 * In a browser this is simply the host you are on. In the app it cannot be:
 * the WebView is served from `https://localhost`, and a relying party has to be
 * a domain the app can prove it owns - which it does through the asset links
 * file served at this one.
 *
 * Both paths therefore name the same relying party, which is what makes a
 * passkey created on the website work in the app and the other way round. If
 * PINGO ever moves to another domain, this and `assetlinks.json` move together
 * or every existing passkey stops opening its backup.
 */
const NATIVE_RP_ID = 'pingochat.pages.dev';

export class PasskeyError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported' | 'no-prf' | 'cancelled' | 'failed',
  ) {
    super(message);
    this.name = 'PasskeyError';
  }
}

interface PrfResult {
  results?: { first?: ArrayBuffer };
}

const prfFrom = (credential: PublicKeyCredential): Uint8Array | undefined => {
  const extensions = credential.getClientExtensionResults() as { prf?: PrfResult };
  const first = extensions.prf?.results?.first;
  return first ? new Uint8Array(first) : undefined;
};

const randomId = () => crypto.getRandomValues(new Uint8Array(32));

/**
 * The PRF output inside a WebAuthn JSON response.
 *
 * The app path gets JSON rather than a credential object, because that is what
 * Credential Manager speaks. Same field, same meaning, encoded as base64url
 * instead of an ArrayBuffer.
 */
function prfFromJson(json: string): { credentialId: string; prf?: Uint8Array } {
  const parsed = JSON.parse(json) as {
    id?: string;
    rawId?: string;
    clientExtensionResults?: { prf?: { results?: { first?: string } } };
  };
  const first = parsed.clientExtensionResults?.prf?.results?.first;
  return {
    credentialId: parsed.id ?? parsed.rawId ?? '',
    ...(first ? { prf: fromBase64Url(first) } : {}),
  };
}

/** Turns a native failure code into the error the rest of the flow expects. */
function nativeFailure(code: string, detail: string): PasskeyError {
  return code === 'cancelled'
    ? new PasskeyError('The passkey prompt was dismissed.', 'cancelled')
    : new PasskeyError(detail || 'That passkey could not be used.', 'failed');
}

/**
 * Creates a passkey for this account and returns its first PRF output.
 *
 * The credential is discoverable and platform-bound: it must be *this* device's
 * built-in authenticator, because a roaming key in a drawer is not what
 * somebody means when they say "my fingerprint".
 */
export async function createBackupPasskey(input: {
  userId: string;
  userName: string;
  displayName: string;
}): Promise<{ credentialId: string; prf: Uint8Array }> {
  if (typeof window === 'undefined') {
    throw new PasskeyError('This browser does not support passkeys.', 'unsupported');
  }

  if (nativePasskeyAvailable()) {
    const result = await nativePasskeyCreate(
      JSON.stringify({
        challenge: toBase64Url(randomId()),
        rp: { id: NATIVE_RP_ID, name: 'PINGO' },
        user: {
          id: toBase64Url(new TextEncoder().encode(input.userId)),
          name: input.userName,
          displayName: input.displayName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 60_000,
        extensions: { prf: { eval: { first: toBase64Url(PRF_SALT) } } },
      }),
    );

    if (!result.ok) throw nativeFailure(result.code, result.payload);

    const made = prfFromJson(result.payload);

    /*
     * The bytes that are sealed are the bytes unlock will ask for.
     *
     * Registration may hand back a PRF output of its own, and it is tempting to
     * take it: one prompt instead of two. But unlock never sees that value - it
     * can only ever perform an assertion - so sealing to the registration
     * output means trusting a provider to make the two identical. Where one
     * does not, the failure is total and permanent: the lock is set, and every
     * attempt to open it produces different bytes, so the prompt comes back for
     * ever with nothing to say what is wrong.
     *
     * So the assertion is always performed, and what it returns is what the
     * backup is sealed to. It costs a second prompt once, at setup, to make the
     * every-time path the one that was actually tested.
     */
    const prf = await passkeyPrf(made.credentialId).catch(() => undefined);
    if (!prf) {
      throw new PasskeyError(
        'This device made a passkey but cannot use it to protect a backup.',
        'no-prf',
      );
    }
    return { credentialId: made.credentialId, prf };
  }

  if (!('PublicKeyCredential' in window)) {
    throw new PasskeyError('This browser does not support passkeys.', 'unsupported');
  }

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomId(),
        rp: { name: 'PINGO', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(input.userId),
          name: input.userName,
          displayName: input.displayName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 60_000,
        extensions: { prf: { eval: { first: PRF_SALT } } },
      } as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;
  } catch (cause) {
    throw new PasskeyError(
      cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'The passkey prompt was dismissed.'
        : 'That passkey could not be created.',
      cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'cancelled' : 'failed',
    );
  }

  if (!credential) throw new PasskeyError('No passkey was created.', 'failed');

  /*
   * The assertion is always performed, and its output is what gets sealed.
   *
   * Registration can return a PRF output of its own and taking it saves a
   * prompt, but unlock can only ever assert - so sealing to the registration
   * value means trusting the two to be identical. Where a platform gets that
   * wrong the lock is set and can never be opened, and the only symptom is a
   * prompt that keeps coming back. See the native path, which has the same
   * note for the same reason.
   */
  const credentialId = toBase64Url(new Uint8Array(credential.rawId));

  const prf = await passkeyPrf(credentialId).catch(() => undefined);
  if (!prf) {
    throw new PasskeyError(
      'This device made a passkey but cannot use it to protect a backup.',
      'no-prf',
    );
  }
  return { credentialId, prf };
}

/** Asks the authenticator to produce the same 32 bytes again. */
export async function passkeyPrf(credentialId?: string): Promise<Uint8Array> {
  if (typeof window === 'undefined') {
    throw new PasskeyError('This browser does not support passkeys.', 'unsupported');
  }

  if (nativePasskeyAvailable()) {
    const result = await nativePasskeyGet(
      JSON.stringify({
        challenge: toBase64Url(randomId()),
        rpId: NATIVE_RP_ID,
        userVerification: 'required',
        timeout: 60_000,
        ...(credentialId
          ? { allowCredentials: [{ type: 'public-key', id: credentialId }] }
          : {}),
        extensions: { prf: { eval: { first: toBase64Url(PRF_SALT) } } },
      }),
    );

    if (!result.ok) throw nativeFailure(result.code, result.payload);

    const prf = prfFromJson(result.payload).prf;
    if (!prf) {
      throw new PasskeyError('This passkey cannot produce a backup key on this device.', 'no-prf');
    }
    return prf;
  }

  if (!('PublicKeyCredential' in window)) {
    throw new PasskeyError('This browser does not support passkeys.', 'unsupported');
  }

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomId(),
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 60_000,
        ...(credentialId
          ? { allowCredentials: [{ type: 'public-key', id: fromBase64Url(credentialId) as BufferSource }] }
          : {}),
        extensions: { prf: { eval: { first: PRF_SALT } } },
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;
  } catch (cause) {
    throw new PasskeyError(
      cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'The passkey prompt was dismissed.'
        : 'That passkey could not be used.',
      cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'cancelled' : 'failed',
    );
  }

  if (!assertion) throw new PasskeyError('No passkey answered.', 'failed');

  const prf = prfFrom(assertion);
  if (!prf) {
    throw new PasskeyError('This passkey cannot produce a backup key on this device.', 'no-prf');
  }
  return prf;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
