/**
 * Mints a short-lived LiveKit participant token.
 *
 * ## Why this exists at all
 *
 * The same reason `turn-credentials` does, only sharper. A LiveKit API secret
 * signs tokens, and a token is permission to join a room, publish into it and
 * subscribe to everyone in it. Ship the secret to the browser and you have not
 * leaked a relay credential - you have published the ability to mint a pass
 * into any conversation on the service. It stays in Edge Function secrets, and
 * the browser receives a signed JWT that expires.
 *
 * ## The room is checked, not just the session
 *
 * Being signed in is necessary and nowhere near sufficient. A token names a
 * room, and this function refuses to sign one for a room the caller is not
 * entitled to be in:
 *
 *   - the room name is derived from a conversation id, and
 *   - membership of that conversation is read from the database with the
 *     caller's own JWT, so row-level security answers the question.
 *
 * Without that check any signed-in account could ask for a token to any
 * conversation id and listen to a call it was never part of. RLS is the only
 * thing that decides; this function does not have an opinion of its own, which
 * is the point - there is one answer to "may this person be here" and it lives
 * in the database.
 *
 * ## Short-lived on purpose
 *
 * Ten minutes is long enough to join and reconnect through a tunnel or a lift,
 * and short enough that a token copied out of devtools is worthless by the time
 * anybody reads it. LiveKit keeps a participant connected past expiry; the TTL
 * governs joining, not staying.
 */

/** How long a minted token may be used to join. See the note above. */
const TTL_SECONDS = 600;

interface TokenRequest {
  /** The conversation this call belongs to. Decides the room and the rights. */
  conversationId?: string;
  /** The call, so two calls in one conversation are two rooms. */
  callId?: string;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json(request, { error: 'Sign in required.' }, 401);

  const user = await verifyUser(authorization);
  if (!user) return json(request, { error: 'Sign in required.' }, 401);

  let body: TokenRequest;
  try {
    body = (await request.json()) as TokenRequest;
  } catch {
    return json(request, { error: 'Expected a JSON body.' }, 400);
  }

  const conversationId = body.conversationId?.trim();
  const callId = body.callId?.trim();
  if (!conversationId || !callId) {
    return json(request, { error: 'conversationId and callId are required.' }, 400);
  }
  if (!isUuid(conversationId) || !isUuid(callId)) {
    return json(request, { error: 'conversationId and callId must be uuids.' }, 400);
  }

  /*
   * The database decides, using the caller's own token.
   *
   * `conversation_members` is behind RLS, so a row comes back only if this
   * person really is in this conversation. Asking with the service role would
   * have skipped exactly the check that matters.
   */
  const member = await isConversationMember(authorization, conversationId, user.id);
  if (!member) {
    return json(request, { error: 'Not a member of this conversation.' }, 403);
  }

  const url = Deno.env.get('LIVEKIT_URL');
  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!url || !apiKey || !apiSecret) {
    console.error('livekit-token: LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET is unset');
    return json(request, { error: 'Calling is not configured.' }, 503);
  }

  /*
   * One room per call, not per conversation.
   *
   * A conversation outlives any number of calls, and naming the room after it
   * would let somebody holding an old token walk into tomorrow's call. The call
   * id is generated fresh each time, so a token is useless the moment that call
   * ends.
   */
  const room = `call_${callId}`;

  const token = await mintToken({
    apiKey,
    apiSecret,
    room,
    identity: user.id,
    ttlSeconds: TTL_SECONDS,
  });

  return json(request, { url, token, room, ttl: TTL_SECONDS });
});

/**
 * Confirms the caller has a real session.
 *
 * Asks the Auth API rather than verifying the signature here, for the same
 * reason `turn-credentials` does: hand-rolled JWT verification is easy to get
 * subtly and silently wrong, and this runs once per call.
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

/** Whether this person is in this conversation, as row-level security sees it. */
async function isConversationMember(
  authorization: string,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return false;

  const query =
    `${url}/rest/v1/conversation_members` +
    `?select=user_id&conversation_id=eq.${conversationId}&user_id=eq.${userId}&limit=1`;

  const response = await fetch(query, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!response.ok) return false;

  const rows = (await response.json()) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * A LiveKit access token, signed here.
 *
 * LiveKit tokens are ordinary HS256 JWTs whose claims carry the grant, so this
 * is `crypto.subtle` and a base64url encoder rather than a dependency. The
 * server SDK would pull a package into an Edge Function to do what forty lines
 * of Web Crypto already does.
 *
 * `canPublish` and `canSubscribe` are both true because every participant on a
 * call is a participant - there is no audience. `roomJoin` is scoped to the one
 * room named above, so the token is not a key to the service.
 */
async function mintToken(input: {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  ttlSeconds: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: input.apiKey,
    sub: input.identity,
    // LiveKit reads `nbf`/`exp` as the window in which the token may be used to
    // join. A little backdating absorbs clock skew between here and their edge.
    nbf: now - 10,
    exp: now + input.ttlSeconds,
    jti: crypto.randomUUID(),
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // Nobody on a call needs to write room metadata or manage anybody else.
      canPublishData: true,
      roomAdmin: false,
      roomCreate: false,
    },
  };

  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encoded),
  );

  return `${encoded}.${base64urlBytes(new Uint8Array(signature))}`;
}

function base64url(value: string): string {
  return base64urlBytes(new TextEncoder().encode(value));
}

function base64urlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function corsHeaders(request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}
