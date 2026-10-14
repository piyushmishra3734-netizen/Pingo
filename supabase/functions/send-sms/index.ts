/**
 * The Send SMS auth hook: Supabase generates the code, this delivers it, by
 * Twilio, as an SMS or a phone call.
 *
 * Supabase Auth calls this over HTTPS whenever it needs a phone OTP sent. The
 * code is already generated and stored by Auth; this function's only job is
 * delivery. Nothing here decides whether a code is correct.
 *
 * ## SMS or a call
 *
 * Auth's hook payload has no channel field, so the person's choice reaches
 * here through `otp_requests`: the app (via `otp-quota`) or `password-recovery`
 * writes it just before asking Auth for the code, and this reads the newest
 * fresh one for the number. No choice on record means SMS.
 *
 * ## The limit is enforced here
 *
 * 3 SMS and 2 calls per number per 12 hours (`_shared/otp.ts`). The app asks
 * first and shows what is left, but anything can call Auth directly, so this
 * is the guard: over the limit, Auth gets a 429 and nothing is sent.
 *
 * ## The signature is the whole of the authentication
 *
 * `verify_jwt` is off, because the caller is Supabase Auth and has no user
 * session. What replaces it is a Standard Webhooks signature over the raw
 * body, read as text and only parsed after it verifies. Without it this would
 * be an open SMS sender pointed at a paid account.
 *
 * ## Nothing sensitive is logged
 *
 * Not the OTP, not the number, not the Twilio credentials. Failures record
 * what failed and Twilio's status code.
 *
 * ## Secrets
 *
 *   SEND_SMS_HOOK_SECRET          from the hook's page in Auth (v1,whsec_...)
 *   TWILIO_ACCOUNT_SID            AC...
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM                   the Twilio number, +1..., for SMS and calls
 *   TWILIO_MESSAGING_SERVICE_SID  optional, MG...; used for SMS instead of TWILIO_FROM
 */
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

import { markOtpSent, otpQuota, takeOtpIntent } from '../_shared/otp.ts';

const HOOK_SECRET = Deno.env.get('SEND_SMS_HOOK_SECRET');
const SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const FROM = Deno.env.get('TWILIO_FROM');
const MESSAGING_SERVICE = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');

/** Auth waits on this response before it answers the user. */
const PROVIDER_TIMEOUT_MS = 10_000;

function failure(httpCode: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: httpCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OK = () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });

interface HookPayload {
  user?: { id?: string; phone?: string; phone_change?: string };
  sms?: { otp?: string; phone?: string; sms_type?: string };
}

/**
 * The number the code is for. Adding or changing a number sends the code to
 * the new one, which Auth carries in `user.phone_change`.
 */
function destination(payload: HookPayload): string {
  const user = payload.user ?? {};
  const pending = user.phone_change?.trim() ?? '';
  const current = user.phone?.trim() ?? '';
  const named = payload.sms?.phone?.trim() ?? '';
  if (named) return named;
  if (payload.sms?.sms_type === 'phone_change' && pending) return pending;
  return current || pending;
}

/** The code read out digit by digit, twice, so nobody has to catch it the first time. */
function voiceTwiml(otp: string): string {
  const digits = otp.split('').join(', ');
  const say = `<Say voice="alice" language="en-IN">Your PINGO code is: ${digits}.</Say><Pause length="1"/>`;
  return `<Response>${say}${say}<Say voice="alice" language="en-IN">Goodbye.</Say></Response>`;
}

async function twilio(path: string, form: Record<string, string>): Promise<Response> {
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return failure(405, 'Method not allowed.');

  if (!HOOK_SECRET) {
    console.error('[send-sms] SEND_SMS_HOOK_SECRET is not set');
    return failure(500, 'Hook is not configured.');
  }
  if (!SID || !TOKEN || (!FROM && !MESSAGING_SERVICE)) {
    console.error('[send-sms] Twilio secrets are not set');
    return failure(500, 'SMS provider is not configured.');
  }

  const raw = await request.text();
  const headers = Object.fromEntries(request.headers);
  let payload: HookPayload;
  try {
    payload = new Webhook(HOOK_SECRET.replace('v1,whsec_', '')).verify(raw, headers) as HookPayload;
  } catch {
    console.error('[send-sms] signature rejected');
    return failure(401, 'Invalid signature.');
  }

  const phone = destination(payload);
  const otp = payload.sms?.otp?.trim() ?? '';
  if (!phone || !otp) return failure(400, 'Payload is missing a phone number or a code.');
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return failure(400, 'Phone number is not usable.');
  if (!/^\d{4,8}$/.test(otp)) return failure(400, 'Code is not usable.');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const intent = await takeOtpIntent(admin, digits);
  const quota = await otpQuota(admin, digits);
  if (quota.left[intent.channel] <= 0) {
    return failure(429, intent.channel === 'call' ? 'No more calls for this number for now.' : 'No more texts for this number for now.');
  }

  /*
   * 2Factor, when its key is set: the code reaches the phone as a call (its
   * SMS route does that while the DLT mapping is not live), which is exactly
   * "call me instead". SMS sign-in itself is Firebase's now; what comes here is
   * calls, adding a number and recovery by @username. The key is a path
   * segment, so nothing here logs a URL.
   */
  const twoFactor = Deno.env.get('TWOFACTOR_API_KEY');
  if (twoFactor) {
    // VOICE: 2Factor's call route, which takes an Indian number as its 10 digits ("Length Mismatch (Expected: 10)" with the 91). Its SMS route used to ring as a call without a DLT mapping; it no longer does.
    const url = `https://2factor.in/API/V1/${encodeURIComponent(twoFactor)}/VOICE/${encodeURIComponent(digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits)}/${encodeURIComponent(otp)}`;
    const sent = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    const body = (await sent?.json().catch(() => null)) as { Status?: string; Details?: string } | null;
    if (body?.Status !== 'Success') {
      console.error(`[send-sms] 2Factor refused: ${sent?.status ?? 'unreachable'} ${(body?.Details ?? '').replace(/\d{4,}/g, '****').slice(0, 160)}`);
      return failure(502, 'Could not send the code.');
    }
    await markOtpSent(admin, digits, intent);
    return OK();
  }

  const to = `+${digits}`;
  let response: Response;
  try {
    response =
      intent.channel === 'call'
        ? await twilio('Calls.json', { To: to, From: FROM ?? '', Twiml: voiceTwiml(otp) })
        : await twilio('Messages.json', {
            To: to,
            ...(MESSAGING_SERVICE ? { MessagingServiceSid: MESSAGING_SERVICE } : { From: FROM ?? '' }),
            Body: `${otp} is your PINGO code. It works for 5 minutes. Do not share it with anyone.`,
          });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    console.error(`[send-sms] Twilio unreachable${timedOut ? ' (timeout)' : ''}`);
    return failure(502, timedOut ? 'SMS provider timed out.' : 'SMS provider unreachable.');
  }

  if (!response.ok) {
    // Twilio's error code says why (21211 bad number, 21608 unverified on a trial account...) and holds no secret.
    const body = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;
    const code = body?.code;
    // The message names the cause in words (and at most the number it was sent to); digits are masked.
    const why = (body?.message ?? '').replace(/\d{4,}/g, '****').slice(0, 200);
    console.error(`[send-sms] Twilio ${intent.channel} refused with ${response.status}${code ? ` (${code})` : ''}${why ? `: ${why}` : ''}`);
    return failure(502, 'SMS provider did not accept the message.');
  }

  await markOtpSent(admin, digits, intent);
  return OK();
});
