import { AuthError } from '@pingo/core';

import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * How a one-time code reaches somebody, and how many they have left.
 *
 * A number gets 3 SMS and 2 calls per 12 hours. The `send-sms` hook enforces
 * it; this asks first (the `otp-quota` function), so the screens can say what
 * is left and offer the other way before anyone hits the wall.
 */

export type OtpChannel = 'sms' | 'call';

export interface OtpQuota {
  left: Record<OtpChannel, number>;
  /** When each one frees up again, epoch ms; null while some are left. */
  freesAt: Record<OtpChannel, number | null>;
}

export const OTP_LIMITS: Record<OtpChannel, number> = { sms: 3, call: 2 };

/** Out of this kind for now; the quota says when it frees up and what else is left. */
export class OtpLimitError extends AuthError {
  constructor(
    readonly channel: OtpChannel,
    readonly quota: OtpQuota,
  ) {
    super('rate_limited', channel === 'call' ? 'No more calls for now.' : 'No more texts for now.');
  }
}

function parse(reply: Record<string, unknown> | null | undefined): OtpQuota | undefined {
  const left = reply?.left as Partial<Record<OtpChannel, number>> | undefined;
  if (!left || typeof left.sms !== 'number' || typeof left.call !== 'number') return undefined;
  const freesAt = (reply?.freesAt ?? {}) as Partial<Record<OtpChannel, number | null>>;
  return { left: { sms: left.sms, call: left.call }, freesAt: { sms: freesAt.sms ?? null, call: freesAt.call ?? null } };
}

async function ask(body: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  const { data, error } = await getSupabaseClient().functions.invoke<Record<string, unknown>>('otp-quota', { body });
  if (!error) return data ?? undefined;
  try {
    return (await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** What this number has left. Undefined if the server cannot say (the screens then just offer both). */
export async function otpStatus(phone: string): Promise<OtpQuota | undefined> {
  return parse(await ask({ action: 'status', phone }).catch(() => undefined));
}

/**
 * Says which way the next code goes, just before asking Auth for it. Throws
 * `OtpLimitError` when that way is used up. If the quota service itself is
 * unreachable the send goes ahead as SMS: the hook still guards the limit.
 */
export async function chooseOtp(phone: string, channel: OtpChannel): Promise<OtpQuota | undefined> {
  const reply = await ask({ action: 'choose', phone, channel }).catch(() => undefined);
  const quota = parse(reply);
  if (reply?.code === 'limit' && quota) throw new OtpLimitError(channel, quota);
  if (!quota) return undefined;
  // This send is about to be spent.
  return { ...quota, left: { ...quota.left, [channel]: Math.max(0, quota.left[channel] - 1) } };
}

/** "7h 12m", "45m", for "try again in ...". */
export function untilLabel(at: number, now = Date.now()): string {
  const mins = Math.max(1, Math.ceil((at - now) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
