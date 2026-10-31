import { Capacitor, CapacitorHttp } from '@capacitor/core';

/**
 * BotGuard attestation — the thing that turns "Sign in to confirm you're not a
 * bot" back into a playable song.
 *
 * ## Why this exists
 *
 * YouTube refuses some tracks with `LOGIN_REQUIRED` / "Sign in to confirm you're
 * not a bot". Measured, that refusal follows the *requesting address*, not the
 * client: ANDROID_VR plays one track and is challenged on another, and TVHTML5
 * is challenged on the same one with the same wording. So no amount of
 * client-swapping fixes it, and the catalogue quietly shrinks.
 *
 * What does fix it is a PO token: proof that this device passed BotGuard. Flow
 * and PipePipe ship exactly this (their credits name "BotGuard/PoToken
 * attestation"), and this file is the same flow in TypeScript:
 *
 *   1. ask Google's Web Anti-Abuse API for a BotGuard challenge
 *   2. run its interpreter in this WebView and take a snapshot
 *   3. mint a PO token bound to the visitor id
 *   4. hand that token to the player request
 *
 * ## Why the network calls go through Capacitor, not fetch
 *
 * Steps 1 and 4 talk to Google. A browser tab cannot, because of CORS; the app
 * can, because `CapacitorHttp` makes the request natively. The interpreter and
 * the minting are pure JavaScript and need no network, so they stay here.
 *
 * ## Why nothing here is allowed to be load-bearing
 *
 * BotGuard changes. If any step fails, `poToken()` returns null and the caller
 * plays on exactly as it did before — a missing token is a worse picture, never
 * a broken screen.
 */

export interface PoToken {
  visitorData: string;
  poToken: string;
  at: number;
  /** The id the token is bound to — the short visitor id, not the blob. */
  binding?: string;
  /** False when the mint kept coming back cold. */
  trusted?: boolean;
}

const KEY = 'pingo:ytm-pot:v2';
/** Google's own number for how long one of these is good for. Conservative. */
const TTL_MS = 4 * 60 * 60_000;

/** The web player's request key. It is public and appears in every YouTube page. */
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const WAA = 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/Create';
const WAA_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
const VISITOR_API = 'https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false';

const WEB_CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.01.00', hl: 'en', gl: 'IN' };

let cached: PoToken | null = null;
let inFlight: Promise<PoToken | null> | null = null;
/** Why the last attempt failed, for the settings self-check. */
let lastError: string | null = null;

export const poTokenSupported = (): boolean => Capacitor.isNativePlatform();
/** The last attestation failure in plain words, or null if the last attempt worked. */
export const poTokenError = (): string | null => lastError;

function restore(): PoToken | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PoToken;
    if (!parsed.poToken || !parsed.visitorData) return null;
    return Date.now() - parsed.at < TTL_MS ? parsed : null;
  } catch {
    return null;
  }
}

function remember(token: PoToken) {
  cached = token;
  try {
    localStorage.setItem(KEY, JSON.stringify(token));
  } catch {
    // Storage blocked: the token still holds for this session.
  }
}

/** A native POST that returns parsed JSON, with no CORS in the way. */
async function nativeJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await CapacitorHttp.post({
    url,
    headers: { 'content-type': 'application/json', ...headers },
    data: body,
    connectTimeout: 12_000,
    readTimeout: 20_000,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

/**
 * BotGuard hands back its integrity token as `$` + base64url, and the minter
 * takes plain base64 — getting that wrong is the difference between a token and
 * `atob` refusing the string, which is how this was found.
 */
function asBase64(token: string): string {
  let text = token.startsWith('$') ? token.slice(1) : token;
  text = text.replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  return text;
}

/**
 * The eleven-character visitor id inside `visitorData`.
 *
 * A token minted against the whole `visitorData` blob is accepted at load time
 * and refused once enforcement kicks in: GVS binds a logged-out token to the
 * short id, and the blob is a base64url protobuf whose first field is that id
 * (`0x0A`, length `0x0B`, then eleven bytes).
 *
 * Taken from Flow's `VisitorId.kt`, which mirrors yt-dlp's `_extract_visitor_id`
 * including its fallback — when the id cannot be read, bind to the blob rather
 * than skip attestation.
 */
function visitorIdFrom(visitorData: string): string {
  try {
    const url = visitorData.replace(/=+$/, '');
    const padded = url + '='.repeat((4 - (url.length % 4)) % 4);
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    if (binary.length < 13) return visitorData;
    const id = binary.slice(2, 13);
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : visitorData;
  } catch {
    return visitorData;
  }
}

/**
 * A token shorter than this is a cold one — accepted briefly, then refused
 * mid-playback. Flow measured 88 mints: real tokens come back at 116 or 120
 * characters, so 110 is the floor.
 */
const MIN_TRUSTED_TOKEN = 110;

async function generate(): Promise<PoToken | null> {
  const [bgMod, wp] = await Promise.all([
    import('bgutils-js/botguard'),
    import('bgutils-js/webpo'),
  ]);

  const visitor = await nativeJson(VISITOR_API, { context: { client: WEB_CLIENT } });
  const visitorData: string =
    visitor?.responseContext?.visitorData ?? visitor?.visitorData ?? '';
  if (!visitorData) throw new Error('no visitor id');

  // The binding GVS actually checks, not the blob it sits inside.
  const binding = visitorIdFrom(visitorData);

  const challenge = await nativeJson(
    WAA,
    [REQUEST_KEY],
    {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': WAA_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
    },
  );
  const parsed = (bgMod.parseChallengeData as (data: unknown) => {
    program?: string;
    globalName?: string;
    interpreterJavascript?: { privateDoNotAccessOrElseSafeScriptWrappedValue?: string } | string;
  })(challenge);

  const interpreter =
    typeof parsed.interpreterJavascript === 'string'
      ? parsed.interpreterJavascript
      : parsed.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!parsed.program || !parsed.globalName || !interpreter) throw new Error('bad challenge');

  // The VM only exists once its interpreter has run.
  new Function(interpreter)();

  const client = await (bgMod.BotGuardClient as {
    create: (options: Record<string, unknown>) => Promise<{ snapshot: (args: Record<string, unknown>) => Promise<string> }>;
  }).create({ program: parsed.program, globalName: parsed.globalName, globalObject: globalThis });

  const signal: unknown[] = [];
  const snapshot = await client.snapshot({ webPoSignalOutput: signal });

  const minter = await (wp.WebPoMinter as {
    create: (data: Record<string, unknown>, output: unknown[]) => Promise<{ mintAsWebsafeString: (id: string) => Promise<string> }>;
  }).create({ integrityToken: asBase64(snapshot) }, signal);

  /*
   * Mint, and mint again while the answer is cold.
   *
   * A cold token loads and then fails minutes later, which is worse than a
   * clean failure now, so the challenge is repeated until the token is long
   * enough to be trusted — Flow's retry loop, same floor.
   */
  let poToken = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    poToken = await minter.mintAsWebsafeString(binding);
    if (poToken.replace(/=+$/, '').length >= MIN_TRUSTED_TOKEN) break;
  }
  if (!poToken) throw new Error('empty token');

  return { visitorData, poToken, at: Date.now(), binding, trusted: poToken.replace(/=+$/, '').length >= MIN_TRUSTED_TOKEN };
}

/**
 * A PO token for this device, or null.
 *
 * Cached for four hours and shared between callers through `inFlight`, because
 * BotGuard is expensive and a queue of songs must not run it per track.
 */
export async function poToken(): Promise<PoToken | null> {
  if (!poTokenSupported()) return null;

  if (!cached) cached = restore();
  if (cached) return cached;

  if (inFlight) return inFlight;

  inFlight = generate()
    .then((token) => {
      if (token) {
        remember(token);
        lastError = null;
      }
      return token;
    })
    .catch((e: unknown) => {
      lastError = e instanceof Error ? e.message : String(e);
      return null;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
