/**
 * Mints short-lived TURN credentials.
 *
 * This function exists for one reason: **the TURN secret must never reach the
 * browser.** A TURN server relays media, so its credential is worth money to
 * whoever finds it. Ship a long-lived one in the bundle and you have published
 * an open relay - anyone can extract it from devtools and push their traffic
 * through your server until the bill arrives.
 *
 * Here the secret stays in Edge Function environment variables, and the browser
 * receives a credential that expires. Losing one costs an attacker a few hours
 * of relay on a server they cannot re-authenticate to afterwards.
 *
 * ## Two backends, one response
 *
 * Configure whichever you have; the client cannot tell the difference.
 *
 * | Backend | Env vars |
 * | --- | --- |
 * | Cloudflare Realtime TURN | `TURN_PROVIDER=cloudflare`, `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` |
 * | Self-hosted coturn | `TURN_PROVIDER=coturn`, `TURN_URLS`, `TURN_STATIC_AUTH_SECRET` |
 *
 * Cloudflare's dashboard labels the first value "TURN Token ID" while its docs
 * call it `TURN_KEY_ID`. Same string, two names - so `CF_TURN_TOKEN_ID` is
 * accepted as an alias, because guessing wrong here fails silently and looks
 * exactly like "TURN just doesn't work".
 *
 * With neither set the function returns an empty list rather than an error, and
 * the client falls back to STUN. That is a deliberate default: a project that
 * has not set up TURN yet should still make calls.
 *
 * ## Authentication
 *
 * Callers must be signed in. Without that check this endpoint is a free TURN
 * credential dispenser for the entire internet, which defeats the point of
 * keeping the secret server-side in the first place.
 */

const TTL_SECONDS = 3600;

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * A misconfiguration the operator can fix, safe to show them.
 *
 * Distinguished from a genuine crash because the message is reported in the
 * response as `reason`. Silence was the wrong default here: a wrong secret and
 * a working STUN-only setup produced byte-identical responses, so there was no
 * way to tell "TURN is off" from "TURN is broken" without reading Edge logs.
 */
class ConfigError extends Error {}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return json(request, { error: 'Sign in required.' }, 401);
  }

  const user = await verifyUser(authorization);
  if (!user) {
    return json(request, { error: 'Sign in required.' }, 401);
  }

  const provider = Deno.env.get('TURN_PROVIDER');
  if (!provider) {
    return json(request, {
      iceServers: [],
      ttl: TTL_SECONDS,
      reason: 'TURN_PROVIDER is not set. Running STUN-only.',
    });
  }

  try {
    const iceServers =
      provider === 'cloudflare'
        ? await cloudflareIceServers()
        : provider === 'coturn'
          ? await coturnIceServers(user.id)
          : [];

    return json(request, { iceServers, ttl: TTL_SECONDS });
  } catch (cause) {
    console.error('turn-credentials failed', cause);

    /*
     * `reason` is diagnostic, never secret - a status code and which env var to
     * look at. The client ignores it entirely and falls back to STUN; it exists
     * so misconfiguration is visible from a browser console instead of only in
     * Edge Function logs.
     */
    return json(request, {
      iceServers: [],
      ttl: TTL_SECONDS,
      reason:
        cause instanceof ConfigError ? cause.message : 'TURN provider unavailable.',
    });
  }
});

/**
 * Confirms the caller has a real session.
 *
 * Asks the Auth API rather than decoding the JWT locally: verifying a signature
 * by hand is easy to get subtly wrong, and this endpoint is called once an hour
 * per user, so the round trip costs nothing worth optimising.
 */
async function verifyUser(authorization: string): Promise<{ id: string } | undefined> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return undefined;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
  });

  if (!response.ok) return undefined;
  const user = (await response.json()) as { id?: string };
  return user.id ? { id: user.id } : undefined;
}

/** Cloudflare mints the credential for us and returns servers ready to use. */
async function cloudflareIceServers(): Promise<IceServer[]> {
  const keyId = Deno.env.get('CF_TURN_KEY_ID') ?? Deno.env.get('CF_TURN_TOKEN_ID');
  const token = Deno.env.get('CF_TURN_API_TOKEN');

  if (!keyId || !token) {
    throw new ConfigError(
      `Missing ${!keyId ? 'CF_TURN_KEY_ID' : 'CF_TURN_API_TOKEN'}.`,
    );
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    },
  );

  if (!response.ok) {
    /*
     * The two ways this goes wrong are worth telling apart, because both look
     * identical from the app (no TURN) and the fix is different:
     *
     *   401/403 - the API token is wrong.
     *   404     - the token is fine but the key id is wrong. Easy to hit, since
     *             the dashboard and the docs call that value different things.
     *
     * Only the status is reported. Neither secret goes anywhere near a browser.
     */
    const hint =
      response.status === 404
        ? 'CF_TURN_KEY_ID does not match a TURN key (dashboard calls it "TURN Token ID").'
        : response.status === 401 || response.status === 403
          ? 'CF_TURN_API_TOKEN was rejected.'
          : 'Cloudflare TURN is unavailable.';

    throw new ConfigError(`Cloudflare returned ${response.status}. ${hint}`);
  }

  const body = (await response.json()) as { iceServers?: IceServer | IceServer[] };
  // The API has returned both a bare object and an array across versions.
  // Normalising here means the client only ever sees one shape.
  if (!body.iceServers) return [];
  return Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
}

/**
 * coturn's REST API scheme, from its `use-auth-secret` mode.
 *
 * The username is `<unix-expiry>:<user-id>` and the credential is
 * `base64(HMAC-SHA1(secret, username))`. coturn recomputes exactly that on
 * arrival, so it can validate a credential it has never seen and never stored  - 
 * no shared database, no synchronisation, and nothing to revoke because the
 * timestamp in the username does the expiring.
 */
async function coturnIceServers(userId: string): Promise<IceServer[]> {
  const urls = Deno.env.get('TURN_URLS');
  const secret = Deno.env.get('TURN_STATIC_AUTH_SECRET');

  if (!urls || !secret) {
    throw new ConfigError(`Missing ${!urls ? 'TURN_URLS' : 'TURN_STATIC_AUTH_SECRET'}.`);
  }

  const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const username = `${expiry}:${userId}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(username),
  );

  return [
    {
      // Comma-separated in config, a list here - one coturn deployment usually
      // exposes UDP, TCP and TLS ports, and all of them should be offered.
      urls: urls.split(',').map((url) => url.trim()).filter(Boolean),
      username,
      credential: btoa(String.fromCharCode(...new Uint8Array(signature))),
    },
  ];
}

function corsHeaders(request: Request): HeadersInit {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
    /*
     * Reflected, not listed.
     *
     * A fixed list breaks the moment the client sends a header it does not
     * name, and the failure is opaque: the browser reports "Failed to fetch"
     * with no clue which header was the problem. That is exactly what happened
     * here - the Supabase client is configured with an `x-pingo-client` header
     * for log attribution, the preflight refused it, and the call looked like a
     * network outage. Reflecting whatever the browser asks for cannot drift.
     *
     * Safe because it only widens the *preflight*: the request still has to
     * pass this function's own sign-in check before it gets anything.
     */
    'Access-Control-Allow-Headers':
      request.headers.get('Access-Control-Request-Headers') ??
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // A day, so the preflight is paid once per browser rather than per call.
    'Access-Control-Max-Age': '86400',
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}
