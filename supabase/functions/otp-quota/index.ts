/**
 * otp-quota: the app asks here before every one-time code.
 *
 *   { action: 'status', phone }            -> { left, freesAt }
 *   { action: 'choose', phone, channel }   -> { ok: true, left, freesAt }
 *                                             or { ok: false, code: 'limit', left, freesAt }
 *
 * `choose` records which way the next code goes (SMS or a call) for the
 * `send-sms` hook to read, after checking the number still has one of that
 * kind left: 3 SMS and 2 calls per 12 hours. The hook checks again when it
 * sends, so this is the friendly answer and the hook is the guard.
 *
 * No JWT: the caller is signing in. It says nothing about whether the number
 * has an account, only how many codes it has had.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

import { otpPhone, otpQuota, recordOtpIntent, type OtpChannel } from '../_shared/otp.ts';

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { code: 'unknown' }, 405);

  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; phone?: unknown; channel?: unknown };
    const phone = otpPhone(String(body.phone ?? ''));
    if (phone.length < 8 || phone.length > 15) return json(request, { code: 'bad_phone' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const quota = await otpQuota(admin, phone);

    if (body.action === 'status') return json(request, quota);

    if (body.action === 'choose') {
      const channel: OtpChannel = body.channel === 'call' ? 'call' : 'sms';
      if (quota.left[channel] <= 0) return json(request, { ok: false, code: 'limit', ...quota });
      await recordOtpIntent(admin, phone, channel);
      return json(request, { ok: true, ...quota });
    }

    return json(request, { code: 'unknown' }, 400);
  } catch (cause) {
    console.error('[otp-quota]', cause);
    return json(request, { code: 'unknown' }, 500);
  }
});
