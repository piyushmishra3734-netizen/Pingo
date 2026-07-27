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
  type ChatMediaItem,
  type FollowState,
  type Post,
  type PostComment,
  type PostDraft,
  type Profile,
  type ProfileDraft,
  type ProfileService,
  type ProfileStats,
  type ReportInput,
  type SharedHistory,
} from '@pingo/core';

import { getSupabaseClient, type PingoSupabaseClient } from './client.js';
import type { Database, PostCommentRow, PostRow, ProfileRow } from './types.js';

type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

const AVATAR_BUCKET = 'avatars';
const POST_BUCKET = 'posts';
const PHOTO_BUCKET = 'photos';

/**
 * How long a signed image URL lives.
 *
 * An hour rather than the minute chat photos get. A profile is looked at, put
 * down and looked at again — a URL that dies while the tab is still open would
 * turn the grid into broken images on nothing more than a coffee break.
 */
const IMAGE_URL_TTL_SECONDS = 60 * 60;

/** A profile holds three posts. The trigger is the real rule; this is the copy. */
const POST_LIMIT = 3;

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    // Empty and null both mean "not set", and only one of them should reach the
    // UI — otherwise an empty string renders as a bio-shaped gap.
    bio: row.bio?.trim() ? row.bio : undefined,
    createdAt: Date.parse(row.created_at),
  };
}

/** Postgres uuids, as postgrest will accept them in an `eq`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres unique-violation. The username index is the only one on this table. */
function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505';
}

function rethrow(error: unknown): never {
  if (error instanceof ProfileError) throw error;

  if (typeof error === 'object' && error !== null && 'code' in error) {
    // Raised by the `posts_limit` trigger. Its own SQLSTATE rather than a check
    // violation, so it cannot be mistaken for the username rules below.
    if ((error as { code?: string }).code === 'PT001') {
      throw new ProfileError(
        'post_limit',
        'A profile holds three posts. Replace one instead.',
      );
    }
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

  /**
   * By handle, or by id when the argument looks like one.
   *
   * The shape of the string decides, because a uuid can never be a valid
   * username — the format check forbids the hyphens — so there is no input
   * that could be read either way.
   */
  async find(handleOrId: string): Promise<Profile | null> {
    const column = UUID.test(handleOrId) ? 'id' : 'username';
    const value = column === 'id' ? handleOrId : normaliseUsername(handleOrId);

    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq(column, value)
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
        bio: draft.bio?.trim() || null,
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
    /*
     * Keyed on whether the property is *present*, not on whether it is defined.
     *
     * `avatarUrl` and `bio` are optional, so the only way to say "clear this" is
     * to pass the key with `undefined` — and a `!== undefined` test reads that
     * as "not mentioned" and leaves the old value in place. Removing a profile
     * photo did nothing at all for exactly that reason.
     *
     * With `in`, an absent key means untouched and a present one means write it,
     * which is the distinction the caller is actually trying to make.
     */
    const patch: ProfileUpdate = {};
    if ('username' in changes && changes.username !== undefined) {
      patch.username = normaliseUsername(changes.username);
    }
    if ('displayName' in changes && changes.displayName !== undefined) {
      patch.display_name = changes.displayName.trim();
    }
    if ('avatarUrl' in changes) patch.avatar_url = changes.avatarUrl ?? null;
    if ('bio' in changes) patch.bio = changes.bio?.trim() || null;

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

  /**
   * Requests waiting on the signed-in user, newest first.
   *
   * ## Why two queries rather than an embed
   *
   * This read `profiles!follows_follower_id_fkey(*)` and always failed with a
   * 400. PostgREST resolves an embed by following a declared foreign key, and
   * `follows.follower_id` points at `auth.users` — there is no key from
   * `follows` to `profiles` for it to follow, so the relationship named there
   * never existed. Every caller wrapped this in a `catch`, so it looked like a
   * user with no pending requests rather than like a query that could not run.
   *
   * Repointing the key would fix the embed and would also be a change to the
   * table the whole follow gate is built on. Two reads and a join in memory
   * cost one extra round trip on a screen nobody opens in a loop.
   */
  async listFollowRequests(): Promise<Profile[]> {
    const me = await this.requireUserId();

    const { data: rows, error } = await this.client
      .from('follows')
      .select('follower_id, created_at')
      .eq('followee_id', me)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) rethrow(error);
    if (!rows || rows.length === 0) return [];

    const { data: people, error: peopleError } = await this.client
      .from('profiles')
      .select('*')
      .in('id', rows.map((row) => row.follower_id));

    if (peopleError) rethrow(peopleError);

    // Re-ordered to match the requests, so "newest first" survives the join.
    const byId = new Map((people ?? []).map((person) => [person.id, person]));
    return rows
      .map((row) => byId.get(row.follower_id))
      .filter((person): person is ProfileRow => person !== undefined)
      .map(toProfile);
  }

  // -- profile page ---------------------------------------------------------

  /**
   * The three numbers, from one function call.
   *
   * A `security definer` function rather than three queries, because two of the
   * three are invisible under RLS for anyone but yourself — someone else's
   * group memberships are theirs, and `follows` only ever returns rows the
   * caller is part of. Asking directly would report "0 friends, 0 groups" on
   * every profile in the product except your own.
   */
  async stats(userId: string): Promise<ProfileStats> {
    const { data, error } = await this.client.rpc('profile_stats', { target: userId });

    if (error) rethrow(error);

    const row = data?.[0];
    return {
      posts: row?.posts ?? 0,
      friends: row?.friends ?? 0,
      groups: row?.groups ?? 0,
    };
  }

  async sharedWith(userId: string): Promise<SharedHistory> {
    const { data, error } = await this.client.rpc('shared_with', { other: userId });

    if (error) rethrow(error);

    const row = data?.[0];
    return {
      friendsSince: row?.friends_since ? Date.parse(row.friends_since) : undefined,
      mutualGroups: row?.mutual_groups ?? 0,
      photosShared: row?.photos_shared ?? 0,
    };
  }

  // -- posts ----------------------------------------------------------------

  /**
   * Signs a batch of post images in one request.
   *
   * Separate from the row read because `createSignedUrls` takes paths and knows
   * nothing about posts — and because a post whose image has gone missing
   * should still render its caption rather than disappear from the grid.
   */
  private async signPosts(rows: PostRow[]): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();

    const { data } = await this.client.storage
      .from(POST_BUCKET)
      .createSignedUrls(
        rows.map((row) => row.image_path),
        IMAGE_URL_TTL_SECONDS,
      );

    /*
     * Both halves are nullable on the entry: an object that could not be signed
     * comes back carrying an error instead, and neither a `null` key nor a
     * `null` URL is any use to the grid. Dropped rather than kept as a blank —
     * a post whose image is missing renders as a caption, not as a dead tile.
     */
    const pairs: [string, string][] = [];
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) pairs.push([entry.path, entry.signedUrl]);
    }
    return new Map(pairs);
  }

  /**
   * Likes, saves and comment counts for a set of posts.
   *
   * Three small reads rather than a view or a set of aggregate columns. A
   * profile holds at most three posts, so this is bounded at a few dozen rows
   * however popular they are — and counts kept on the post row would be a
   * second source of truth that drifts the first time a delete races a like.
   */
  private async decoratePosts(rows: PostRow[]): Promise<Post[]> {
    if (rows.length === 0) return [];

    const me = await this.requireUserId();
    const ids = rows.map((row) => row.id);

    const [urls, likes, saves, comments] = await Promise.all([
      this.signPosts(rows),
      this.client.from('post_likes').select('post_id, user_id').in('post_id', ids),
      // RLS already limits this to the signed-in user's own saves.
      this.client.from('post_saves').select('post_id').in('post_id', ids),
      this.client.from('post_comments').select('post_id').in('post_id', ids),
    ]);

    const likeCount = new Map<string, number>();
    const likedByMe = new Set<string>();
    for (const like of likes.data ?? []) {
      likeCount.set(like.post_id, (likeCount.get(like.post_id) ?? 0) + 1);
      if (like.user_id === me) likedByMe.add(like.post_id);
    }

    const savedByMe = new Set((saves.data ?? []).map((save) => save.post_id));

    const commentCount = new Map<string, number>();
    for (const comment of comments.data ?? []) {
      commentCount.set(comment.post_id, (commentCount.get(comment.post_id) ?? 0) + 1);
    }

    return rows.map((row) => toPost(row, urls.get(row.image_path) ?? '', {
      likeCount: likeCount.get(row.id) ?? 0,
      likedByMe: likedByMe.has(row.id),
      savedByMe: savedByMe.has(row.id),
      commentCount: commentCount.get(row.id) ?? 0,
    }));
  }

  async listPosts(userId: string): Promise<Post[]> {
    const { data, error } = await this.client
      .from('posts')
      .select('*')
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(POST_LIMIT);

    if (error) rethrow(error);
    return this.decoratePosts(data ?? []);
  }

  /** Puts the picture in the private bucket and returns its path. */
  private async uploadPostImage(image: Blob): Promise<string> {
    const me = await this.requireUserId();
    // The author's id leads the path, which is what the storage policy checks.
    const path = `${me}/${crypto.randomUUID()}.jpg`;

    const { error } = await this.client.storage
      .from(POST_BUCKET)
      .upload(path, image, { contentType: image.type || 'image/jpeg' });

    if (error) rethrow(error);
    return path;
  }

  /** Best effort. A leftover object is waste; a thrown error here is a bug. */
  private async removePostImage(path: string): Promise<void> {
    await this.client.storage.from(POST_BUCKET).remove([path]);
  }

  async createPost(draft: PostDraft): Promise<Post> {
    const me = await this.requireUserId();
    const path = await this.uploadPostImage(draft.image);

    const { data, error } = await this.client
      .from('posts')
      .insert({ author_id: me, image_path: path, caption: draft.caption?.trim() || null })
      .select('*')
      .single();

    if (error) {
      // The row did not land, so the image has nothing pointing at it. Left
      // behind it would sit in the bucket forever counting against storage.
      await this.removePostImage(path);
      rethrow(error);
    }

    const [post] = await this.decoratePosts([data]);
    return post!;
  }

  async replacePost(postId: string, draft: PostDraft): Promise<Post> {
    // Read first, so the old image can be removed once the swap has succeeded.
    const { data: existing, error: readError } = await this.client
      .from('posts')
      .select('*')
      .eq('id', postId)
      .single();

    if (readError) rethrow(readError);

    const path = await this.uploadPostImage(draft.image);

    const { data, error } = await this.client
      .from('posts')
      .update({
        image_path: path,
        // Undefined means "keep what was there"; an empty string clears it.
        ...(draft.caption === undefined ? {} : { caption: draft.caption.trim() || null }),
      })
      .eq('id', postId)
      .select('*')
      .single();

    if (error) {
      await this.removePostImage(path);
      rethrow(error);
    }

    // Only now, when the row definitely points at the new picture.
    await this.removePostImage(existing.image_path);

    const [post] = await this.decoratePosts([data]);
    return post!;
  }

  async updatePostCaption(postId: string, caption: string): Promise<Post> {
    const { data, error } = await this.client
      .from('posts')
      .update({ caption: caption.trim() || null })
      .eq('id', postId)
      .select('*')
      .single();

    if (error) rethrow(error);

    const [post] = await this.decoratePosts([data]);
    return post!;
  }

  async deletePost(postId: string): Promise<void> {
    const { data: existing } = await this.client
      .from('posts')
      .select('image_path')
      .eq('id', postId)
      .maybeSingle();

    const { error } = await this.client.from('posts').delete().eq('id', postId);
    if (error) rethrow(error);

    // After the row, not before: a delete that fails must not leave a post
    // pointing at an image that is already gone.
    if (existing) await this.removePostImage(existing.image_path);
  }

  async setPostLiked(postId: string, liked: boolean): Promise<void> {
    const me = await this.requireUserId();

    const { error } = liked
      ? await this.client
          .from('post_likes')
          // Liking twice is a double tap, not an error worth showing.
          .upsert({ post_id: postId, user_id: me }, { onConflict: 'post_id,user_id', ignoreDuplicates: true })
      : await this.client.from('post_likes').delete().eq('post_id', postId).eq('user_id', me);

    if (error) rethrow(error);
  }

  async setPostSaved(postId: string, saved: boolean): Promise<void> {
    const me = await this.requireUserId();

    const { error } = saved
      ? await this.client
          .from('post_saves')
          .upsert({ post_id: postId, user_id: me }, { onConflict: 'post_id,user_id', ignoreDuplicates: true })
      : await this.client.from('post_saves').delete().eq('post_id', postId).eq('user_id', me);

    if (error) rethrow(error);
  }

  async listComments(postId: string): Promise<PostComment[]> {
    const { data, error } = await this.client
      .from('post_comments')
      // The author comes with the row: a comment without a name and a face is
      // half a comment, and fetching them separately would be one request per
      // person on a thread where several people have replied.
      .select('*, profiles!post_comments_author_id_fkey(*)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) rethrow(error);

    return (data ?? [])
      .map((row) => {
        const joined = row as unknown as PostCommentRow & { profiles: ProfileRow | null };
        if (!joined.profiles) return undefined;
        return toComment(joined, joined.profiles);
      })
      .filter((comment): comment is PostComment => comment !== undefined);
  }

  async addComment(postId: string, body: string): Promise<PostComment> {
    const me = await this.requireUserId();

    const { data, error } = await this.client
      .from('post_comments')
      .insert({ post_id: postId, author_id: me, body: body.trim() })
      .select('*, profiles!post_comments_author_id_fkey(*)')
      .single();

    if (error) rethrow(error);

    const joined = data as unknown as PostCommentRow & { profiles: ProfileRow | null };
    if (!joined.profiles) {
      // Cannot happen — the row was just written by this user, whose profile
      // exists — but the join is nullable in the type and guessing a name here
      // would be worse than saying the read failed.
      throw new ProfileError('unknown', 'Comment posted, but could not be shown.');
    }

    return toComment(joined, joined.profiles);
  }

  async deleteComment(commentId: string): Promise<void> {
    const { error } = await this.client.from('post_comments').delete().eq('id', commentId);
    if (error) rethrow(error);
  }

  // -- private media --------------------------------------------------------

  /**
   * Pictures out of the signed-in user's own conversations.
   *
   * There is no user id argument and there will not be one: this reads
   * `messages`, where RLS returns only conversations the caller belongs to, so
   * the query is already "mine" by construction. A version taking an id would
   * silently return an empty list for anyone else, which reads as "they have no
   * media" rather than as "that is not yours to see".
   *
   * View-limited photos are excluded. Their whole point is that the URL only
   * exists for as long as a view is being spent, and re-listing them here would
   * be a second, permanent copy of a picture that was sent to be seen once.
   */
  async listChatMedia(limit = 60): Promise<ChatMediaItem[]> {
    const me = await this.requireUserId();

    const { data, error } = await this.client
      .from('messages')
      .select('id, conversation_id, sender_id, photo_path, created_at, deleted_at')
      .not('photo_path', 'is', null)
      .is('view_limit', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) rethrow(error);

    const rows = (data ?? []) as {
      id: string;
      conversation_id: string;
      sender_id: string;
      photo_path: string;
      created_at: string;
    }[];

    if (rows.length === 0) return [];

    const { data: signed } = await this.client.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(rows.map((row) => row.photo_path), IMAGE_URL_TTL_SECONDS);

    const urlByPath = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));

    return rows
      .map((row) => ({
        id: row.id,
        url: urlByPath.get(row.photo_path) ?? '',
        createdAt: Date.parse(row.created_at),
        conversationId: row.conversation_id,
        mine: row.sender_id === me,
      }))
      // A picture whose object has gone is a grey square that cannot be opened.
      .filter((item) => item.url !== '');
  }

  // -- safety ---------------------------------------------------------------

  async isBlocked(userId: string): Promise<boolean> {
    const me = await this.requireUserId();

    const { data, error } = await this.client
      .from('blocks')
      .select('blocked_id')
      .eq('blocker_id', me)
      .eq('blocked_id', userId)
      .maybeSingle();

    if (error) rethrow(error);
    return data !== null;
  }

  async setBlocked(userId: string, blocked: boolean): Promise<void> {
    const me = await this.requireUserId();

    if (!blocked) {
      const { error } = await this.client
        .from('blocks')
        .delete()
        .eq('blocker_id', me)
        .eq('blocked_id', userId);
      if (error) rethrow(error);
      return;
    }

    const { error } = await this.client
      .from('blocks')
      .upsert(
        { blocker_id: me, blocked_id: userId },
        { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
      );
    if (error) rethrow(error);

    /*
     * Blocking also drops the follow in both directions. Leaving it would mean
     * a blocked person still counts as a friend — still inside the mutual gate
     * that opens calls and stories — which is the opposite of what the word
     * means to the person who pressed it.
     */
    const { error: unfollowError } = await this.client
      .from('follows')
      .delete()
      .or(
        `and(follower_id.eq.${me},followee_id.eq.${userId}),` +
          `and(follower_id.eq.${userId},followee_id.eq.${me})`,
      );
    if (unfollowError) rethrow(unfollowError);
  }

  async report(input: ReportInput): Promise<void> {
    const me = await this.requireUserId();

    /*
     * No `.select()`. Reports have an insert policy and deliberately no select
     * policy — moderation reads them with the service key and nothing in the
     * app reads them back. Asking for the row would return nothing and make a
     * successful report look like a failure.
     */
    const { error } = await this.client.from('reports').insert({
      reporter_id: me,
      subject_user_id: input.userId ?? null,
      subject_post_id: input.postId ?? null,
      reason: input.reason,
      details: input.details?.trim() || null,
    });

    if (error) rethrow(error);
  }
}

function toPost(
  row: PostRow,
  imageUrl: string,
  counts: {
    likeCount: number;
    likedByMe: boolean;
    savedByMe: boolean;
    commentCount: number;
  },
): Post {
  const created = Date.parse(row.created_at);
  const updated = Date.parse(row.updated_at);

  return {
    id: row.id,
    authorId: row.author_id,
    imageUrl,
    caption: row.caption ?? undefined,
    createdAt: created,
    /*
     * A second of slack. `updated_at` is set by a trigger on every write, and
     * the insert itself counts as one — so a brand new post has two timestamps
     * that differ by microseconds, and an exact comparison would mark every
     * post "edited" the moment it was published.
     */
    editedAt: updated - created > 1000 ? updated : undefined,
    ...counts,
  };
}

function toComment(row: PostCommentRow, author: ProfileRow): PostComment {
  return {
    id: row.id,
    postId: row.post_id,
    author: toProfile(author),
    body: row.body,
    createdAt: Date.parse(row.created_at),
  };
}
