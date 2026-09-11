/**
 * Mints a short-lived LiveKit token for a PINGO live stream.
 *
 * ## Why a separate function from `livekit-token`
 *
 * That one authorises against *conversation membership*: the room belongs to a
 * chat and the check is a row in `conversation_members`. A live belongs to a
 * *person* and the audience is their mutual followers, so the check is a row
 * in `live_streams` plus `is_mutual` - a different question with a different
 * failure shape. Sharing the function would mean a body that is sometimes a
 * conversation and sometimes a live, and an authorisation branch that must
 * never pick the wrong one.
 *
 * ## The grant differs by role
 *
 * The host publishes camera + microphone and subscribes to nothing (viewers
 * are silent - a live is not a call). A viewer subscribes and publishes
 * nothing, but may publish data so hearts can travel over the room when the
 * broadcast channel is unavailable.
 *
 * ## Short-lived, like every other token here
 *
 * Ten minutes to join; LiveKit keeps a participant connected past expiry.
 */

const TTL_SECONDS = 600;

interface LiveTokenRequest {
  /** The `live_streams` row being joined. */
  liveId?: string;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(request) });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json(request, { error: "Sign in required." }, 401);

  const user = await verifyUser(authorization);
  if (!user) return json(request, { error: "Sign in required." }, 401);

  let body: LiveTokenRequest;
  try {
    body = (await request.json()) as LiveTokenRequest;
  } catch {
    return json(request, { error: "Expected a JSON body." }, 400);
  }

  const liveId = body.liveId?.trim();
  if (!liveId || !isUuid(liveId)) {
    return json(request, { error: "liveId must be a uuid." }, 400);
  }

  // The database decides, using the caller's own JWT so RLS answers.
  const live = await readLive(authorization, liveId);
  if (!live) {
    return json(request, { error: "This live is not available." }, 403);
  }
  if (live.status !== "live") {
    return json(request, { error: "This live has ended." }, 410);
  }

  const isHost = live.host_id === user.id;
  // An approved guest publishes like a second host. `invited` counts too:
  // the invite is the approval, and the guest joins straight from it.
  const isGuest = !isHost && (await readGuest(authorization, liveId, user.id));
  const canPublish = isHost || isGuest;

  const url = Deno.env.get("LIVEKIT_URL");
  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!url || !apiKey || !apiSecret) {
    console.error("live-token: LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET is unset");
    return json(request, { error: "Live is not configured." }, 503);
  }

  const room = `live_${liveId}`;

  const token = await mintToken({
    apiKey,
    apiSecret,
    room,
    identity: user.id,
    publish: canPublish,
    ttlSeconds: TTL_SECONDS,
  });

  return json(request, {
    url,
    token,
    room,
    ttl: TTL_SECONDS,
    role: isHost ? "host" : isGuest ? "guest" : "viewer",
  });
});

interface LiveRow {
  host_id: string;
  status: string;
}

/** The live row as RLS sees it through the caller's own token. */
async function readLive(authorization: string, liveId: string): Promise<LiveRow | undefined> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return undefined;

  const query =
    `${url}/rest/v1/live_streams` +
    `?select=host_id,status&id=eq.${liveId}&limit=1`;

  const response = await fetch(query, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!response.ok) return undefined;

  const rows = (await response.json()) as LiveRow[];
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
}

/** Whether this user holds an approved seat: invited or already joined. */
async function readGuest(
  authorization: string,
  liveId: string,
  userId: string,
): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return false;

  const query =
    `${url}/rest/v1/live_guests` +
    `?select=status&live_id=eq.${liveId}&user_id=eq.${userId}` +
    `&status=in.(invited,joined)&limit=1`;

  const response = await fetch(query, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!response.ok) return false;

  const rows = (await response.json()) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

async function verifyUser(authorization: string): Promise<{ id: string } | undefined> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return undefined;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!response.ok) return undefined;

  const user = (await response.json()) as { id?: string };
  return user.id ? { id: user.id } : undefined;
}

async function mintToken(input: {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  /** Hosts and approved guests. Viewers are ears and eyes only. */
  publish: boolean;
  ttlSeconds: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: input.apiKey,
    sub: input.identity,
    nbf: now - 10,
    exp: now + input.ttlSeconds,
    jti: crypto.randomUUID(),
    video: {
      room: input.room,
      roomJoin: true,
      // A viewer is ears and eyes only. The host is the only publisher.
      canPublish: input.publish,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
      roomCreate: false,
    },
  };

  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded),
  );

  return `${encoded}.${base64urlBytes(new Uint8Array(signature))}`;
}

function base64url(value: string): string {
  return base64urlBytes(new TextEncoder().encode(value));
}

function base64urlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function corsHeaders(request: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") ??
      "authorization, x-client-info, apikey, content-type, x-pingo-client",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}
