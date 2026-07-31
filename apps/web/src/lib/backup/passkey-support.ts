/**
 * What this browser can do with passkeys, without making one.
 *
 * Stage 2 measures and nothing else. The tempting way to learn whether PRF
 * works is to create a credential with the extension and read `prf.enabled`
 * back - but that enrols a passkey on the user's account, which is exactly what
 * this stage is not allowed to do. So this asks the platform instead of
 * experimenting on it.
 *
 * `PublicKeyCredential.getClientCapabilities()` is the honest source: it
 * reports extension support directly and creates nothing. Where it is missing
 * the answer is genuinely unknown rather than false, and this says so - an
 * unknown recorded as "no" would quietly remove passkeys from platforms that
 * support them, and an unknown recorded as "yes" would promise recovery that
 * cannot happen.
 */

/** Three-valued on purpose: a browser that cannot tell us is not a browser that said no. */
export type Support = 'yes' | 'no' | 'unknown';

export interface PasskeyCapabilities {
  /** The API exists at all. */
  webauthn: Support;
  /** A built-in authenticator - Touch ID, Windows Hello, Android screen lock. */
  platformAuthenticator: Support;
  /** Passkeys the platform can offer without being told which one. */
  discoverableCredentials: Support;
  /** Autofill-style sign-in; a good proxy for a modern passkey stack. */
  conditionalMediation: Support;
  /** The extension the whole design depends on. */
  prf: Support;
  /** Raw capability map, when the browser provides one. */
  raw?: Record<string, boolean>;
  /** For the matrix: what reported this. */
  userAgent: string;
}

interface CapabilityCapable {
  getClientCapabilities?: () => Promise<Record<string, boolean>>;
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  isConditionalMediationAvailable?: () => Promise<boolean>;
}

const bool = (value: boolean | undefined): Support =>
  value === undefined ? 'unknown' : value ? 'yes' : 'no';

export async function measurePasskeySupport(): Promise<PasskeyCapabilities> {
  const ua = typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent;

  if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) {
    return {
      webauthn: 'no',
      platformAuthenticator: 'no',
      discoverableCredentials: 'no',
      conditionalMediation: 'no',
      prf: 'no',
      userAgent: ua,
    };
  }

  const api = (window as unknown as { PublicKeyCredential: CapabilityCapable }).PublicKeyCredential;

  const platform = await api
    .isUserVerifyingPlatformAuthenticatorAvailable?.()
    .catch(() => undefined);
  const conditional = await api.isConditionalMediationAvailable?.().catch(() => undefined);
  const caps = await api.getClientCapabilities?.().catch(() => undefined);

  /*
   * Capability names are prefixed for extensions. Both spellings are checked
   * because implementations have shipped each at different times, and guessing
   * wrong here would report a supported browser as unsupported.
   */
  const prfFromCaps = caps
    ? (caps['extension:prf'] ?? caps.prf)
    : undefined;

  return {
    webauthn: 'yes',
    platformAuthenticator: bool(platform),
    /*
     * No direct probe exists for discoverability without creating one. A
     * platform authenticator that supports conditional mediation is offering
     * discoverable credentials in practice, so that is reported as the
     * inference it is rather than as a measurement.
     */
    discoverableCredentials:
      caps?.['passkeyPlatformAuthenticator'] !== undefined
        ? bool(caps['passkeyPlatformAuthenticator'])
        : conditional === true
          ? 'yes'
          : 'unknown',
    conditionalMediation: bool(conditional),
    prf: bool(prfFromCaps),
    raw: caps,
    userAgent: ua,
  };
}

/**
 * Can this browser carry the effortless design as specified?
 *
 * Deliberately strict: anything short of a definite yes on PRF means the
 * passkey path cannot be offered silently, because the fallback is asking for
 * a password and that is a different promise.
 */
export function canCarryEffortlessBackup(caps: PasskeyCapabilities): boolean {
  return caps.webauthn === 'yes' && caps.platformAuthenticator === 'yes' && caps.prf === 'yes';
}
