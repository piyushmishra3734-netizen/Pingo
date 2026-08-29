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

/** One person who joined because of you, as the mission screen draws them. */
export interface ReferredFriend {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  joinedAt: string;
}

export interface ReferralProgress {
  missionId: string;
  title: string;
  description: string;
  badgeId: string;
  referralCode: string;
  count: number;
  required: number;
  /**
   * The people behind the count, oldest first, capped by the server.
   *
   * `count` stays the authority on how many - a long-finished mission has more
   * friends than faces - so nothing should ever render `friends.length` as the
   * progress number.
   */
  friends: ReferredFriend[];
  unlocked: boolean;
  /**
   * When the badge was awarded. Present exactly when `unlocked` is true - both
   * are read off the same row, so they cannot disagree.
   */
  unlockedAt?: string;
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
    friends: Array.isArray(row.friends) ? (row.friends as unknown[]).map(toFriend) : [],
    unlocked: row.unlocked === true,
    ...(row.unlockedAt ? { unlockedAt: String(row.unlockedAt) } : {}),
  };
}

/** Defensive on every field: this row is JSON the server built, not a typed view. */
function toFriend(value: unknown): ReferredFriend {
  const row = (value ?? {}) as Record<string, unknown>;
  const avatarUrl = row.avatarUrl ? String(row.avatarUrl) : undefined;
  return {
    id: String(row.id ?? ''),
    username: String(row.username ?? ''),
    displayName: String(row.displayName ?? row.username ?? ''),
    ...(avatarUrl ? { avatarUrl } : {}),
    joinedAt: String(row.joinedAt ?? ''),
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

/**
 * Chooses which earned badge this account wears beside its name.
 *
 * Server-side because everybody else's client draws it too - the chat list, a
 * group's message header, a user card. A choice kept on this device would be
 * right on this device and nowhere else.
 *
 * The server refuses a badge the account has not earned, so a client cannot
 * award itself anything by asking to display it. Returns false on refusal
 * rather than throwing: the screen re-reads the truth either way, and a
 * rejected tap is not an error worth a dialog.
 */
export async function setDisplayedBadge(badgeId: string | null): Promise<boolean> {
  const { error } = await getSupabaseClient().rpc('set_displayed_badge', {
    p_badge_id: badgeId,
  });
  return !error;
}
