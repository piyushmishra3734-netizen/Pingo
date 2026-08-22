/**
 * The two server calls the referral system needs, and nothing else.
 *
 * Both are RPCs rather than table reads, because both answer questions no
 * client is allowed to answer for itself: "how many people have I brought" and
 * "record that this person was brought by that code". Reading `referrals`
 * directly would give the first one, and the policy allows it - but then the
 * progress bar and the badge would be counted in two different places, and the
 * one on screen would eventually disagree with the one that unlocks.
 */
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { forgetReferralCode, heldReferralCode } from './referral-code.js';

export interface ReferralProgress {
  missionId: string;
  title: string;
  description: string;
  badgeId: string;
  referralCode: string;
  count: number;
  required: number;
  unlocked: boolean;
}

/** Progress for the signed-in user, or undefined when there is nothing to show. */
export async function fetchReferralProgress(): Promise<ReferralProgress | undefined> {
  const { data, error } = await getSupabaseClient().rpc('referral_progress');
  if (error || !data) return undefined;
  const row = data as Record<string, unknown>;
  if (row.ok !== true) return undefined;
  return {
    missionId: String(row.missionId),
    title: String(row.title),
    description: String(row.description),
    badgeId: String(row.badgeId),
    referralCode: String(row.referralCode ?? ''),
    count: Number(row.count ?? 0),
    required: Number(row.required ?? 0),
    unlocked: row.unlocked === true,
  };
}

/**
 * Hand over the code this device arrived with, once there is an account.
 *
 * Called after the profile exists, which is the app's own definition of a real
 * account and the moment the server will accept a referral at all. Safe to call
 * more than once: the server collapses repeats onto one row, so a retry after a
 * dropped connection costs nothing.
 *
 * The held code is cleared on every outcome except a network failure. A refusal
 * is final - self-referral, an account that predates the mission, a code that
 * does not exist - and keeping it would mean retrying it on every launch for
 * ever.
 */
export async function redeemHeldReferral(): Promise<'recorded' | 'refused' | 'none' | 'retry'> {
  const code = heldReferralCode();
  if (!code) return 'none';

  const { data, error } = await getSupabaseClient().rpc('redeem_referral', { code });
  if (error) return 'retry';

  const row = (data ?? {}) as Record<string, unknown>;
  /*
   * `no_account` is the one refusal worth keeping the code for: it means the
   * profile is not written yet, which is a matter of seconds rather than a
   * decision.
   */
  if (row.reason === 'no_account') return 'retry';

  forgetReferralCode();
  return row.ok === true ? 'recorded' : 'refused';
}
