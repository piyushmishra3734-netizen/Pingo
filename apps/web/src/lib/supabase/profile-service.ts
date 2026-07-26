/**
 * `ProfileService`, implemented on Supabase.
 *
 * Reads and writes `public.profiles` and the `avatars` storage bucket, both
 * created by `supabase/migrations/20260725190000_profiles.sql`. Like
 * `auth-service.ts`, this is the only place that knows Supabase is behind the
 * boundary, and nothing under `screens/` may import it.
 *
 * ## Row level security does the enforcing
 *
 * None of the writes below pass a user id. They do not need to: the policies
 * check `auth.uid() = id`, so an attempt to write someone else's row fails at
 * the database rather than at a condition in this file. That is deliberate —
 * a client-side check is a suggestion, and this code runs in the user's browser
 * where they can edit it.
 */

import {
  ProfileError,
  isValidUsername,
  normaliseUsername,
  type FollowState,
  type Profile,
  type ProfileDraft,
  type ProfileService,
} from '@pingo/core';

import { getSupabaseClient, type PingoSupabaseClient } from './client.js';
import type { Database, ProfileRow } from './types.js';

type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

const AVATAR_BUCKET = 'avatars';

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    createdAt: Date.parse(row.created_at),
  };
}

/** Postgres unique-violation. The username index is the only one on this table. */
function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505';
}

function rethrow(error: unknown): never {
  if (error instanceof ProfileError) throw error;

  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (isUniqueViolation(error as { code?: string })) {
      throw new ProfileError('username_taken', 'That username is taken.');
    }
    // 23514 is a check-constraint violation — the format rules in the migration.
    if ((error as { code?: string }).code === '23514') {
      throw new ProfileError('username_invalid', 'That username is not allowed.');
    }
  }

  if (!navigator.onLine) throw new ProfileError('offline', 'You are offline.');

  throw new ProfileError(
    'unknown',
    error instanceof Error ? error.message : 'Something went wrong.',
  );
}

export class SupabaseProfileService implements ProfileService {
  private readonly client: PingoSupabaseClient;

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.client = client;
  }

  private async requireUserId(): Promise<string> {
    const { data } = await this.client.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new ProfileError('unknown', 'Not signed in.');
    return id;
  }

  async getMine(): Promise<Profile | null> {
    const userId = await this.requireUserId();

    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      // `maybeSingle` rather than `single`: no row is the normal state for a
      // user who has not finished sign-up, not an error to throw on.
      .maybeSingle();

    if (error) rethrow(error);
    return data ? toProfile(data) : null;
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const handle = normaliseUsername(username);
    if (!isValidUsername(handle)) return false;

    const { data, error } = await this.client
      .from('profiles')
      .select('username')
      .eq('username', handle)
      .maybeSingle();

    if (error) rethrow(error);
    return data === null;
  }

  async suggestUsernames(from: string): Promise<string[]> {
    const base = normaliseUsername(from).slice(0, 15) || 'pingo';

    /*
     * Candidates first, one round trip second. Checking them one at a time
     * would be a request per suggestion while the user waits at a screen that
     * has already told them their first choice failed.
     */
    const candidates = [
      `${base}1`,
      `${base}_`,
      `${base}${new Date().getFullYear() % 100}`,
      `${base}${Math.floor(Math.random() * 90 + 10)}`,
      `the${base}`,
      `${base}_x`,
    ].filter(isValidUsername);

    if (candidates.length === 0) return [];

    const { data, error } = await this.client
      .from('profiles')
      .select('username')
      .in('username', candidates);

    if (error) rethrow(error);

    const taken = new Set((data ?? []).map((row) => row.username));
    return candidates.filter((candidate) => !taken.has(candidate)).slice(0, 3);
  }

  async create(draft: ProfileDraft): Promise<Profile> {
    const userId = await this.requireUserId();
    const username = normaliseUsername(draft.username);

    if (!isValidUsername(username)) {
      throw new ProfileError('username_invalid', 'That username is not allowed.');
    }

    const { data, error } = await this.client
      .from('profiles')
      .insert({
        id: userId,
        username,
        display_name: draft.displayName.trim(),
        avatar_url: draft.avatarUrl ?? null,
      })
      .select('*')
      .single();

    if (error) rethrow(error);
    return toProfile(data);
  }

  async update(changes: Partial<ProfileDraft>): Promise<Profile> {
    const userId = await this.requireUserId();

    /*
     * Typed as the table's own Update shape rather than a loose record.
     * postgrest rejects excess properties, so a `Record<string, …>` here fails
     * to compile — and that strictness is worth keeping: it means a typo in a
     * column name is a build error, not a silent no-op at runtime.
     */
    const patch: ProfileUpdate = {};
    if (changes.username !== undefined) patch.username = normaliseUsername(changes.username);
    if (changes.displayName !== undefined) patch.display_name = changes.displayName.trim();
    if (changes.avatarUrl !== undefined) patch.avatar_url = changes.avatarUrl ?? null;

    const { data, error } = await this.client
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) rethrow(error);
    return toProfile(data);
  }

  async uploadAvatar(file: Blob): Promise<string> {
    const userId = await this.requireUserId();

    /*
     * The user's id is the folder, which is what the storage policy checks —
     * `(storage.foldername(name))[1] = auth.uid()`. The timestamp defeats CDN
     * caching, so a replaced photo appears immediately instead of showing the
     * old one until the cache expires.
     */
    const path = `${userId}/avatar-${Date.now()}`;

    const { error } = await this.client.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });

    if (error) rethrow(error);

    const { data } = this.client.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async listRecentPeople(limit = 12): Promise<Profile[]> {
    const userId = await this.requireUserId();

    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .neq('id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) rethrow(error);
    return (data ?? []).map(toProfile);
  }

  // -- follows -------------------------------------------------------------

  /**
   * Both directions in one query.
   *
   * `or(...)` fetches the row I own and the row they own together, because the
   * answer depends on both and two round trips could see them in different
   * states — accept arriving between them would report `following` for a pair
   * that is already mutual.
   */
  async followState(userId: string): Promise<FollowState> {
    const me = await this.requireUserId();
    if (me === userId) return 'none';

    const { data, error } = await this.client
      .from('follows')
      .select('follower_id, followee_id, status')
      .or(
        `and(follower_id.eq.${me},followee_id.eq.${userId}),` +
          `and(follower_id.eq.${userId},followee_id.eq.${me})`,
      );

    if (error) rethrow(error);

    const outgoing = (data ?? []).find((row) => row.follower_id === me);
    const incoming = (data ?? []).find((row) => row.follower_id === userId);

    if (outgoing?.status === 'accepted' && incoming?.status === 'accepted') return 'mutual';
    // An unanswered request I received outranks one I sent: it is the only
    // state with something for this user to actually do.
    if (incoming?.status === 'pending') return 'incoming';
    if (outgoing?.status === 'pending') return 'requested';
    if (outgoing?.status === 'accepted') return 'following';
    if (incoming?.status === 'accepted') return 'follower';
    return 'none';
  }

  async requestFollow(userId: string): Promise<FollowState> {
    const me = await this.requireUserId();

    // `upsert` rather than `insert`: re-requesting after a withdrawal is normal,
    // and a duplicate-key error is not something a user should ever be shown.
    const { error } = await this.client
      .from('follows')
      .upsert(
        { follower_id: me, followee_id: userId, status: 'pending' },
        { onConflict: 'follower_id,followee_id', ignoreDuplicates: true },
      );

    if (error) rethrow(error);
    return this.followState(userId);
  }

  async acceptFollow(userId: string): Promise<FollowState> {
    const me = await this.requireUserId();

    // Their row, not mine. RLS also enforces this — the policy only lets the
    // followee update — so a mistake here fails rather than granting access.
    const { error } = await this.client
      .from('follows')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('follower_id', userId)
      .eq('followee_id', me);

    if (error) rethrow(error);
    return this.followState(userId);
  }

  /** Unfollow, withdraw, or reject — all of them delete a row. */
  async removeFollow(userId: string): Promise<FollowState> {
    const me = await this.requireUserId();

    const { error } = await this.client
      .from('follows')
      .delete()
      .or(
        `and(follower_id.eq.${me},followee_id.eq.${userId}),` +
          `and(follower_id.eq.${userId},followee_id.eq.${me})`,
      );

    if (error) rethrow(error);
    return this.followState(userId);
  }

  /**
   * Both directions once, intersected here.
   *
   * Postgres could answer this with a self-join, but that would need another
   * `security definer` function to see past RLS on the other person's row —
   * and RLS already returns every row that involves me, which is exactly the
   * input this needs. Two lists and a set beat a new database surface.
   */
  async listMutualIds(): Promise<string[]> {
    const me = await this.requireUserId();

    const { data, error } = await this.client
      .from('follows')
      .select('follower_id, followee_id')
      .eq('status', 'accepted');

    if (error) rethrow(error);

    const iFollow = new Set<string>();
    const followsMe = new Set<string>();
    for (const row of data ?? []) {
      if (row.follower_id === me) iFollow.add(row.followee_id);
      if (row.followee_id === me) followsMe.add(row.follower_id);
    }

    return [...iFollow].filter((id) => followsMe.has(id));
  }

  async listFollowRequests(): Promise<Profile[]> {
    const me = await this.requireUserId();

    const { data, error } = await this.client
      .from('follows')
      .select('follower_id, created_at, profiles!follows_follower_id_fkey(*)')
      .eq('followee_id', me)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) rethrow(error);

    return (data ?? [])
      .map((row) => (row as unknown as { profiles: ProfileRow | null }).profiles)
      .filter((profile): profile is ProfileRow => profile !== null)
      .map(toProfile);
  }
}
