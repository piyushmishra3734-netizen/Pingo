/**
 * One-time codes: how many a number may have, and which way the next one goes.
 *
 * Shared by `otp-quota` (the app asks before a send), `password-recovery`
 * (which sends for a locked-out handle) and the `send-sms` hook (which sends,
 * and is where the limit is enforced). Table: `otp_requests`.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

export type OtpChannel = 'sms' | 'call';

/** Per number, per rolling window. */
export const OTP_LIMITS: Record<OtpChannel, number> = { sms: 3, call: 2 };
export const OTP_WINDOW_MS = 12 * 60 * 60 * 1000;

/** A choice older than this is not the one this code is for. */
const INTENT_FRESH_MS = 3 * 60 * 1000;

/** Digits only: Auth stores `919876543210`, the app may send `+91 98765 43210`. */
export function otpPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export interface OtpQuota {
  /** How many of each are left in the window. */
  left: Record<OtpChannel, number>;
  /** When each one frees up again, epoch ms; null while some are left. */
  freesAt: Record<OtpChannel, number | null>;
}

/** What this number has had in the last 12 hours, counted from codes actually sent. */
export async function otpQuota(admin: Admin, phone: string): Promise<OtpQuota> {
  const since = new Date(Date.now() - OTP_WINDOW_MS).toISOString();
  const { data } = await admin
    .from('otp_requests')
    .select('channel, sent_at')
    .eq('phone', otpPhone(phone))
    .not('sent_at', 'is', null)
    .gte('sent_at', since)
    .order('sent_at', { ascending: true });
  const rows = (data ?? []) as { channel: OtpChannel; sent_at: string }[];
  const quota: OtpQuota = { left: { sms: 0, call: 0 }, freesAt: { sms: null, call: null } };
  for (const ch of ['sms', 'call'] as const) {
    const sent = rows.filter((r) => r.channel === ch);
    quota.left[ch] = Math.max(0, OTP_LIMITS[ch] - sent.length);
    // Full: the oldest of the ones counted is the first to fall out of the window.
    if (quota.left[ch] === 0 && sent[0]) quota.freesAt[ch] = new Date(sent[0].sent_at).getTime() + OTP_WINDOW_MS;
  }
  return quota;
}

/** Records which way the next code for this number should go. */
export async function recordOtpIntent(admin: Admin, phone: string, channel: OtpChannel): Promise<void> {
  await admin.from('otp_requests').insert({ phone: otpPhone(phone), channel });
}

/** The newest unsent choice for this number, if it is recent; the hook uses it and stamps it. */
export async function takeOtpIntent(admin: Admin, phone: string): Promise<{ id: number | null; channel: OtpChannel }> {
  const since = new Date(Date.now() - INTENT_FRESH_MS).toISOString();
  const { data } = await admin
    .from('otp_requests')
    .select('id, channel')
    .eq('phone', otpPhone(phone))
    .is('sent_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { id: number; channel: OtpChannel } | null;
  return row ? { id: row.id, channel: row.channel } : { id: null, channel: 'sms' };
}

/** Marks a code as sent: it now counts against the number's limit. */
export async function markOtpSent(admin: Admin, phone: string, intent: { id: number | null; channel: OtpChannel }): Promise<void> {
  const now = new Date().toISOString();
  if (intent.id !== null) await admin.from('otp_requests').update({ sent_at: now }).eq('id', intent.id);
  else await admin.from('otp_requests').insert({ phone: otpPhone(phone), channel: intent.channel, sent_at: now });
  // Housekeeping, now and then.
  if (Math.random() < 0.05) await admin.rpc('otp_requests_prune').catch(() => undefined);
}
