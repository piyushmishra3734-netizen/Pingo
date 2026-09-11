/**
 * Getting back into an account by @username, with a code instead of a password.
 *
 * ## Why this is a function and the phone door is not
 *
 * Somebody who signs in with their number already knows it, so their recovery
 * is ordinary Supabase phone OTP, called straight from the browser. Somebody
 * who signs in with a @username does not type a number at all - and the number
 * behind a handle is exactly the private fact `username-login` exists to keep
 * off the wire. So the lookup happens here, as it does there: the browser sends
 * a username, the code goes to the phone on that account, and the browser is
 * told only the last two digits, so the person knows which phone to pick up.
 *
 * ## Two steps, one function
 *
 * `start` looks up the number and asks Supabase Auth to send a code to it,
 * which reaches the phone as a call through the Send SMS hook like every other
 * PINGO code. `verify` looks the number up again and checks the code against
 * it; a right one returns a session, which the browser installs with
 * `setSession` and then uses to set a new password. The number never leaves
 * this function in either direction.
 *
 * Supabase does the code: generating it, expiring it, rate-limiting sends and
 * checks. Nothing here compares a code, and nothing here can mint a session
 * without one - the same boundary `username-login` keeps for passwords.
 *
 * ## What it will say about somebody else's account
 *
 * An unknown handle, a deleted account and an account with no number all come
 * back as `no_phone`. Usernames are public in PINGO by design, so whether an
 * account exists was never the secret; the number is, and only its last two
 * digits are ever returned, and only once a code is actually on its way.
 *
 * ## No JWT required
 *
 * The caller is locked out of their account; that is the point. `verify_jwt =
 * false` in `supabase/config.toml`, as for `username-login`.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/** Same shape the profiles table enforces: 3-20 of `[a-z0-9_]`. */
const USERNAME = /^[a-z0-9_]{3,20}$/;

/** What 2Factor reads out. Anything else is a typo, not a code. */
const CODE = /^\d{6}$/;

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

type Admin = ReturnType<typeof createClient>;

/** The number on the account behind a handle, as Auth stores it. */
async function phoneFor(admin: Admin, username: string): Promise<string | undefined> {
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (!profile?.id) return undefined;

  const { data, error } = await admin.auth.admin.getUserById(profile.id as string);
  if (error) return undefined;
  const phone = data?.user?.phone;
  return phone && phone.length > 0 ? phone : undefined;
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
      action?: unknown;
      username?: unknown;
      code?: unknown;
    };

    const action = String(body.action ?? '');
    const username = String(body.username ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    /*
     * Sends and checks go through an anonymous client, so they are the same
     * calls the phone door makes from a browser - with Auth's own rate limits
     * on them, which would not apply if this function did either itself.
     */
    const anon = createClient(supabaseUrl, supabaseAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === 'start') {
      const phone = USERNAME.test(username) ? await phoneFor(admin, username) : undefined;
      // Unknown handle, deleted account, no number on it: one answer.
      if (!phone) return json(request, { code: 'no_phone' });

      const { error } = await anon.auth.signInWithOtp({
        phone,
        // Recovery never creates an account, whatever the number turns out to be.
        options: { shouldCreateUser: false },
      });

      if (error) {
        if (error.status === 429) return json(request, { code: 'rate_limited' }, 429);
        // The status only: never the number, and never anything that could be one.
        console.error('[password-recovery] send failed', error.status);
        return json(request, { code: 'unknown' }, 502);
      }

      return json(request, { ok: true, ending: phone.slice(-2) });
    }

    if (action === 'verify') {
      const code = String(body.code ?? '').trim();
      if (!USERNAME.test(username) || !CODE.test(code)) {
        return json(request, { code: 'invalid_code' }, 400);
      }

      const phone = await phoneFor(admin, username);
      if (!phone) return json(request, { code: 'invalid_code' }, 400);

      const { data, error } = await anon.auth.verifyOtp({ phone, token: code, type: 'sms' });

      if (error || !data.session) {
        if (error?.status === 429) return json(request, { code: 'rate_limited' }, 429);
        // Wrong and expired look the same: a code is either right now or it is not.
        return json(request, { code: 'invalid_code' }, 400);
      }

      return json(request, {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }

    return json(request, { code: 'unknown' }, 400);
  } catch (cause) {
    console.error('[password-recovery]', cause instanceof Error ? cause.message : 'failed');
    return json(request, { code: 'unknown' }, 500);
  }
});
