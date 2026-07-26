import { getSupabaseClient } from '../supabase/client.js';

/**
 * Where a call's ICE servers come from.
 *
 * ## Why this is not a constant
 *
 * STUN is free and public, so it can be hard-coded. TURN cannot: it *relays*
 * media, which is bandwidth somebody pays for, so every TURN server on earth is
 * behind a credential.
 *
 * That credential must never reach the bundle. Everything Vite exposes to the
 * browser — anything `VITE_`-prefixed — is readable by opening devtools, and a
 * long-lived TURN credential sitting there is an open relay: anyone can lift it
 * and push their own traffic through, on your bill, until you notice. This is
 * not theoretical; it is the single most common way people get a surprise
 * WebRTC invoice.
 *
 * So the secret lives server-side in the `turn-credentials` Edge Function, and
 * the browser asks for a credential that expires. If the function is not
 * deployed the app degrades to STUN-only — which is exactly where it was before
 * TURN existed, and still connects for most people.
 *
 * ## What TURN actually buys
 *
 * STUN only *tells* two peers their public addresses; the media still travels
 * directly. Behind symmetric NAT or a corporate firewall there is no direct path
 * to find, and roughly 10–20% of real-world networks are like that. TURN relays
 * the media through a server that both sides can reach. It is slower and costs
 * money, which is why it is the fallback and not the default — ICE tries direct
 * routes first and only relays when nothing else works.
 */

/** Public STUN. Always present, and enough on most home and mobile networks. */
const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface CachedIce {
  servers: RTCIceServer[];
  /** Epoch ms. Refetched before this, never after. */
  expiresAt: number;
}

let cache: CachedIce | undefined;
let inFlight: Promise<RTCIceServer[]> | undefined;

/**
 * Refetch this long before the credential actually expires.
 *
 * A credential that dies mid-call takes the relay with it, and ICE will not
 * silently recover. The margin is generous because the cost of being early is
 * one HTTP request.
 */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/**
 * How long a *failure* is remembered.
 *
 * Without this, a project that has not set up TURN pays a failing HTTP request
 * on the critical path of every single call. Short enough that deploying the
 * function starts working within minutes, with no reload.
 */
const FAILURE_CACHE_MS = 5 * 60_000;

/**
 * ICE servers for a new peer connection.
 *
 * Never rejects. A failure here means no TURN, not no call — degrading to STUN
 * connects for most people, and failing the call outright would be a worse
 * outcome than the one this function exists to improve.
 */
export async function resolveIceServers(): Promise<RTCIceServer[]> {
  if (cache && Date.now() < cache.expiresAt - EXPIRY_MARGIN_MS) return cache.servers;

  // One request even if both peers of a fast redial ask at once.
  inFlight ??= fetchIceServers().finally(() => {
    inFlight = undefined;
  });

  return inFlight;
}

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const { data, error } = await getSupabaseClient().functions.invoke<{
      iceServers: RTCIceServer[];
      ttl: number;
    }>('turn-credentials');

    if (error || !data?.iceServers?.length) return remember(STUN_SERVERS);

    /*
     * STUN stays in the list alongside TURN, deliberately.
     *
     * ICE gathers candidates from every server it is given and picks the
     * cheapest working path — direct if there is one, relayed only if not.
     * Dropping STUN here would force every call onto the relay and turn a
     * fallback into the bill.
     */
    const servers = [...STUN_SERVERS, ...data.iceServers];
    cache = { servers, expiresAt: Date.now() + data.ttl * 1000 };
    return servers;
  } catch {
    // Function not deployed, offline, or misconfigured. STUN-only is the same
    // behaviour PINGO had before TURN, so this is a downgrade, not a break.
    return remember(STUN_SERVERS);
  }
}

/** Caches a STUN-only result for the short failure window. */
function remember(servers: RTCIceServer[]): RTCIceServer[] {
  cache = { servers, expiresAt: Date.now() + FAILURE_CACHE_MS + EXPIRY_MARGIN_MS };
  return servers;
}

/** Drops the cached credential. For tests, and for sign-out. */
export function resetIceServers(): void {
  cache = undefined;
}
