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

/** The salt is fixed and public: PRF's secrecy comes from the authenticator. */
const PRF_SALT = new TextEncoder().encode('pingo/backup-lock/v1');

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
  if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) {
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
   * Some platforms create the credential but return no PRF output until the
   * first assertion. Asking straight away is the honest way to find out whether
   * this passkey can actually carry a backup — before anything is sealed to it.
   */
  const immediate = prfFrom(credential);
  const credentialId = toBase64Url(new Uint8Array(credential.rawId));
  if (immediate) return { credentialId, prf: immediate };

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
  if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) {
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
