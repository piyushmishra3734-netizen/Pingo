/**
 * Sign in with a @username and a password.
 *
 * ## Why this cannot be done in the browser
 *
 * Supabase authenticates on an email address, and a username is not one. The
 * obvious client-side version — "look the username up, get the address, call
 * `signInWithPassword`" — needs an endpoint that turns a public handle into a
 * private email address, and once that endpoint exists, anybody can walk the
 * list of usernames and collect every email address on the product. That is a
 * data breach with a login screen in front of it.
 *
 * So the lookup happens here, where the address never leaves the server. The
 * browser sends a username and a password and receives a session or a refusal.
 * It is never told the address, and no response distinguishes "no such
 * username" from "wrong password" — a login form that says which one it was
 * tells an attacker which half to keep working on.
 *
 * That is a statement about the *response*, not the clock. A username that
 * exists costs an extra lookup and a real hash comparison, and measures around
 * 135ms slower than one that does not; no attempt is made to pad that away,
 * because it would buy nothing. Usernames are public in this product by design
 * - profiles are readable by handle and `pingo.chat/<username>` is a page - so
 * whether an account exists was never the secret here. The address behind it
 * is, and that does not leak either way.
 *
 * ## The password is still checked by Supabase, not by us
 *
 * The service-role key is used for exactly one thing: reading the address that
 * belongs to a profile id. The password itself goes to
 * `signInWithPassword` on an anonymous client, so the hash comparison, the
 * lockouts and the rate limits are all Supabase's own. Nothing here compares a
 * password, and nothing here can mint a session for an account without one.
 *
 * ## No JWT required
 *
 * Obviously — the caller is signing in. `verify_jwt = false` in
 * `supabase/config.toml` for this function, and it is the one function in the
 * product where that is correct.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/** Same shape the profiles table enforces: 3-20 of `[a-z0-9_]`. */
const USERNAME = /^[a-z0-9_]{3,20}$/;

function corsHeaders(request: Request): HeadersInit {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
    'Access-Control-Allow-Headers':
      request.headers.get('Access-Control-Request-Headers') ??
      'authorization, x-client-info, apikey, content-type, x-pingo-client',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

/**
 * The one refusal this function has.
 *
 * Unknown username, wrong password, a profile whose auth user has been deleted
 * — all of them come back as this. Any variation is a signal about somebody
 * else's account.
 */
function refuse(request: Request): Response {
  return json(request, { code: 'invalid_credentials' }, 400);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return json(request, { code: 'unknown' }, 405);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      username?: unknown;
      password?: unknown;
    };

    const username = String(body.username ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    const password = String(body.password ?? '');

    // Rejected before any lookup: a malformed handle cannot match a row, and
    // stopping here keeps junk out of the query path.
    if (!USERNAME.test(username) || password.length === 0) {
      return refuse(request);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (!profile?.id) return refuse(request);

    const { data: found, error: lookupError } = await admin.auth.admin.getUserById(profile.id);
    const address = found?.user?.email;
    if (lookupError || !address) return refuse(request);

    /*
     * The actual authentication. An anonymous client, so this is the identical
     * code path the email door uses — including Supabase's rate limiting, which
     * would not apply if this function checked the password itself.
     */
    const anon = createClient(supabaseUrl, supabaseAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signIn, error } = await anon.auth.signInWithPassword({
      email: address,
      password,
    });

    if (error || !signIn.session) {
      /*
       * Rate limiting is the one failure worth naming, because "too many
       * attempts" is not a fact about whether this account exists — every
       * caller hits it at the same threshold — and a login form that silently
       * says "wrong password" during a lockout sends people to reset a password
       * that was right.
       */
      if (error?.status === 429) return json(request, { code: 'rate_limited' }, 429);
      return refuse(request);
    }

    /*
     * Tokens, not a user object. The browser feeds these straight into
     * `setSession`, after which the session is indistinguishable from one
     * obtained through any other door.
     */
    return json(request, {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
  } catch (cause) {
    console.error('[username-login]', cause);
    return json(request, { code: 'unknown' }, 500);
  }
});
