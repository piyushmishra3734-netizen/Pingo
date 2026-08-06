/**
 * The app's passkey bridge, as the page sees it.
 *
 * A transport and nothing else: WebAuthn JSON goes out, WebAuthn JSON comes
 * back. Everything that knows what a passkey *is* stays in `webauthn-prf.ts`,
 * so the browser path and the app path are the same code with a different
 * courier, rather than two implementations that will drift.
 *
 * ## Why the app asks at all
 *
 * See `PasskeyBridge.java`. Short version: a relying party has to be a real
 * domain associated with the app, and the WebView is served from
 * `https://localhost`. When the app asks, the page's origin is not part of the
 * question - so the passkey works without moving the app to another origin and
 * signing everybody out.
 */

declare global {
  interface Window {
    AndroidPasskey?: {
      available?: () => boolean;
      create?: (requestJson: string, callId: string) => void;
      get?: (requestJson: string, callId: string) => void;
    };
    __pingoPasskeyResult?: (callId: string, result: NativeResult) => void;
  }
}

interface NativeResult {
  ok: boolean;
  /** `ok`, `cancelled`, or `failed`. */
  code: string;
  /** The WebAuthn response JSON when `ok`; a message when not. */
  payload: string;
}

/** Calls still waiting for the native side to come back. */
const waiting = new Map<string, (result: NativeResult) => void>();

/**
 * How long a prompt may stay open before the page stops waiting.
 *
 * Slightly past the 60s WebAuthn timeout the request itself carries, so the
 * native side normally answers first and this only catches the case where it
 * never answers at all - a bridge that dies mid-prompt would otherwise leave
 * the screen busy for ever with no way back.
 */
const TIMEOUT_MS = 70_000;

export function nativePasskeyAvailable(): boolean {
  try {
    return window.AndroidPasskey?.available?.() === true;
  } catch {
    return false;
  }
}

function call(kind: 'create' | 'get', requestJson: string): Promise<NativeResult> {
  const bridge = window.AndroidPasskey;
  const method = bridge?.[kind];
  if (!bridge || !method) {
    return Promise.resolve({ ok: false, code: 'failed', payload: 'No passkey support here.' });
  }

  const callId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise<NativeResult>((resolve) => {
    let settled = false;
    const finish = (result: NativeResult) => {
      if (settled) return;
      settled = true;
      waiting.delete(callId);
      window.clearTimeout(timer);
      resolve(result);
    };

    const timer = window.setTimeout(
      () => finish({ ok: false, code: 'failed', payload: 'The passkey prompt did not answer.' }),
      TIMEOUT_MS,
    );

    waiting.set(callId, finish);

    // Registered once and left in place: several calls can be outstanding, and
    // each is routed by its own id rather than by whoever asked last.
    window.__pingoPasskeyResult = (id, result) => waiting.get(id)?.(result);

    try {
      method.call(bridge, requestJson, callId);
    } catch {
      finish({ ok: false, code: 'failed', payload: 'The passkey prompt could not be opened.' });
    }
  });
}

export const nativePasskeyCreate = (requestJson: string) => call('create', requestJson);
export const nativePasskeyGet = (requestJson: string) => call('get', requestJson);
