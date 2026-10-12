/**
 * A Firebase-verified phone number in, a Supabase session out.
 *
 * Firebase sends PINGO's login codes (Indian SMS needs a DLT sender, and
 * Firebase brings Google's). Its ID token proves the number; this turns that
 * into a session for the Supabase account on the number, creating one when the
 * number is new - exactly what verifying a Supabase phone code did.
 *
 * GoTrue has no "sign in as" for the admin, so the session comes the way a
 * magic link would: a phone-only account is given the derived address the
 * app already treats as plumbing and never shows (`<digits>@phone.pingo.chat`), a link token is minted
 * for it and redeemed here. Nothing is emailed; the address exists only so the
 * token has somewhere to point.
 *
 * Secrets: FIREBASE_PROJECT_ID (default bingo-5176a).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5.9.6';

const PROJECT = Deno.env.get('FIREBASE_PROJECT_ID') ?? 'bingo-5176a';
const KEYS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  const { idToken } = (await request.json().catch(() => ({}))) as { idToken?: string };
  if (typeof idToken !== 'string' || idToken.length > 4096) return json({ error: 'bad_token' }, 400);

  let phone: string;
  try {
    const { payload } = await jwtVerify(idToken, KEYS, {
      issuer: `https://securetoken.google.com/${PROJECT}`,
      audience: PROJECT,
    });
    phone = String(payload.phone_number ?? '').replace(/^\+/, '');
  } catch {
    return json({ error: 'bad_token' }, 401);
  }
  if (!/^[1-9][0-9]{6,14}$/.test(phone)) return json({ error: 'no_phone' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ponytail: scans the user list, fine to a few thousand accounts; a phone->id SQL function past that.
  let user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | undefined;
  for (let page = 1; !user; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return json({ error: 'lookup' }, 500);
    user = data.users.find((u) => u.phone === phone);
    if (data.users.length < 1000) break;
  }
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true });
    if (error || !data.user) return json({ error: 'create' }, 500);
    user = data.user;
  }

  let email = user.email;
  if (!email) {
    email = `${phone}@phone.pingo.chat`;
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      email,
      email_confirm: true,
      // Where the app reads a phone account's number for display.
      user_metadata: { ...(user.user_metadata ?? {}), pingo_phone: user.user_metadata?.pingo_phone ?? `+${phone}` },
    });
    if (error) return json({ error: 'link' }, 500);
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return json({ error: 'link' }, 500);

  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn, error: verifyError } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (verifyError || !signedIn.session) return json({ error: 'session' }, 500);

  return json({ access_token: signedIn.session.access_token, refresh_token: signedIn.session.refresh_token });
});
