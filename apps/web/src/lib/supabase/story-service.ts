/**
 * `StoryService`, implemented on Supabase.
 *
 * Reads `stories`, `story_views`, `story_likes` and the privacy tables from
 * `supabase/migrations/20260731000000_story_module.sql`, and writes media to the
 * private `stories` bucket.
 *
 * ## The audience rule is not in this file
 *
 * Who may see a story is decided by `can_see_story()` inside the read policy.
 * That is deliberate: this code runs in the user's browser, where they can edit
 * it, so a filter here would be a suggestion. An expired story, a story for
 * close friends only, a story hidden from you - none of them are *reachable*
 * through the API, rather than merely being left out of a list.
 *
 * The one thing filtered here is muted authors, and only because muting is the
 * viewer's own preference about a story they are perfectly entitled to see.
 */

import type {
  Story,
  StoryDraft,
  StoryGroup,
  StoryInsights,
  StoryKind,
  StoryService,
  StoryViewer,
} from '@pingo/core';

import { getSupabaseClient, type PingoSupabaseClient } from './client.js';
import type { ProfileRow, StoryRow } from './types.js';

const STORY_BUCKET = 'stories';

/**
 * How long a signed story URL lives.
 *
 * An hour. A story is watched once for a few seconds, but the rail holds a
 * dozen thumbnails that may sit on screen while somebody reads their chats - a
 * shorter life would turn the row into grey circles without anybody doing
 * anything.
 */
const MEDIA_TTL_SECONDS = 60 * 60;

export class SupabaseStoryService implements StoryService {
  readonly #client: PingoSupabaseClient;

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.#client = client;
  }

  async #userId(): Promise<string> {
    const { data } = await this.#client.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new Error('Not signed in.');
    return id;
  }

  /**
   * Signs a batch of story media in one request.
   *
   * Rows written before the bucket went private carry only a public URL, which
   * still works; they are passed through untouched rather than being signed.
   */
  async #signMedia(rows: StoryRow[]): Promise<Map<string, string>> {
    const paths = rows.map((row) => row.media_path).filter((path): path is string => !!path);
    if (paths.length === 0) return new Map();

    const { data } = await this.#client.storage
      .from(STORY_BUCKET)
      .createSignedUrls(paths, MEDIA_TTL_SECONDS);

    const urls = new Map<string, string>();
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
    }
    return urls;
  }

  #toStory(
    row: StoryRow,
    profile: ProfileRow,
    urls: Map<string, string>,
    seen: Set<string>,
    liked: Set<string>,
  ): Story {
    const signed = row.media_path ? urls.get(row.media_path) : undefined;

    return {
      id: row.id,
      authorId: row.author_id,
      authorName: profile.display_name,
      authorUsername: profile.username,
      ...(profile.avatar_url ? { authorAvatarUrl: profile.avatar_url } : {}),
      kind: (row.kind === 'video' ? 'video' : 'photo') as StoryKind,
      mediaUrl: signed ?? row.media_url,
      ...(row.caption ? { caption: row.caption } : {}),
      ...(row.location ? { location: row.location } : {}),
      ...(row.link_url ? { linkUrl: row.link_url } : {}),
      audience: row.audience as Story['audience'],
      createdAt: Date.parse(row.created_at),
      expiresAt: Date.parse(row.expires_at),
      seen: seen.has(row.id),
      likedByMe: liked.has(row.id),
    };
  }

  async listStoryGroups(): Promise<StoryGroup[]> {
    const me = await this.#userId();

    const { data: rows, error } = await this.#client
      .from('stories')
      .select('*')
      // Live only. Expired rows are readable *by their author* - that is the
      // archive - so this list has to exclude them explicitly.
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!rows || rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const authorIds = [...new Set(rows.map((row) => row.author_id))];

    const [{ data: profiles }, { data: views }, { data: likes }, mutualIds, mutedIds, urls] =
      await Promise.all([
        this.#client.from('profiles').select('*').in('id', authorIds),
        // RLS returns only the signed-in user's own rows, which is exactly what
        // "have *I* seen this" needs.
        this.#client.from('story_views').select('story_id').in('story_id', ids),
        this.#client.from('story_likes').select('story_id').in('story_id', ids).eq('user_id', me),
        this.#mutualIds(),
        this.listMutedAuthors(),
        this.#signMedia(rows),
      ]);

    const profileById = new Map<string, ProfileRow>(
      (profiles ?? []).map((profile) => [profile.id, profile]),
    );
    const seen = new Set((views ?? []).map((view) => view.story_id));
    const liked = new Set((likes ?? []).map((like) => like.story_id));
    const muted = new Set(mutedIds);
    const friends = new Set(mutualIds);

    const groups = new Map<string, StoryGroup>();

    for (const row of rows) {
      // Muting is the viewer's own preference, so it is applied here rather
      // than in a policy - the story is one they are entitled to see.
      if (muted.has(row.author_id)) continue;

      const profile = profileById.get(row.author_id);
      // A story whose author has no profile cannot be rendered - skip rather
      // than show a nameless circle.
      if (!profile) continue;

      const story = this.#toStory(row, profile, urls, seen, liked);
      const existing = groups.get(row.author_id);

      if (existing) {
        existing.stories.push(story);
        existing.allSeen = existing.allSeen && story.seen;
        existing.latestAt = Math.max(existing.latestAt, story.createdAt);
        existing.closeFriends = existing.closeFriends || story.audience === 'close';
      } else {
        groups.set(row.author_id, {
          authorId: row.author_id,
          authorName: profile.display_name,
          authorUsername: profile.username,
          ...(profile.avatar_url ? { authorAvatarUrl: profile.avatar_url } : {}),
          stories: [story],
          allSeen: story.seen,
          latestAt: story.createdAt,
          isFriend: friends.has(row.author_id),
          /*
           * Seeing a `close` story *is* what being on the list means - the
           * policy already refused everybody else - so there is nothing further
           * to ask before turning the ring green.
           */
          closeFriends: story.audience === 'close',
        });
      }
    }

    return [...groups.values()];
  }

  async listArchive(): Promise<Story[]> {
    const me = await this.#userId();

    const { data: rows, error } = await this.#client
      .from('stories')
      .select('*')
      .eq('author_id', me)
      .lte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!rows || rows.length === 0) return [];

    const [{ data: profile }, urls] = await Promise.all([
      this.#client.from('profiles').select('*').eq('id', me).maybeSingle(),
      this.#signMedia(rows),
    ]);
    if (!profile) return [];

    // Everything here is the caller's own, watched by definition, and its likes
    // are not what an archive is for.
    return rows.map((row) => this.#toStory(row, profile, urls, new Set(), new Set()));
  }

  async post(draft: StoryDraft): Promise<Story> {
    const me = await this.#userId();

    const extension = draft.kind === 'video' ? 'mp4' : 'jpg';
    // Per-user folder, which is what the storage policy checks.
    const path = `${me}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await this.#client.storage
      .from(STORY_BUCKET)
      .upload(path, draft.media, {
        contentType: draft.media.type || (draft.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      });

    if (uploadError) throw uploadError;

    const { data, error } = await this.#client
      .from('stories')
      .insert({
        author_id: me,
        /*
         * Empty, and not a lie.
         *
         * `media_url` only still exists for rows written before the bucket
         * became private. Writing a public URL now would produce a link that
         * does not resolve, which is worse than an obviously absent one - the
         * reader falls back to it only when there is no path.
         */
        media_url: '',
        media_path: path,
        kind: draft.kind,
        audience: draft.audience,
        caption: draft.caption?.trim() || null,
        location: draft.location?.trim() || null,
        link_url: draft.linkUrl?.trim() || null,
      })
      .select('*')
      .single();

    if (error) {
      // The row did not land, so nothing points at the upload.
      await this.#client.storage.from(STORY_BUCKET).remove([path]);
      throw error;
    }

    if (draft.audience === 'custom' && draft.audienceUserIds?.length) {
      const { error: audienceError } = await this.#client
        .from('story_audience')
        .insert(draft.audienceUserIds.map((userId) => ({ story_id: data.id, user_id: userId })));

      if (audienceError) {
        /*
         * A custom story whose audience failed to write is visible to nobody  - 
         * except its author, who would see it in their own rail and reasonably
         * assume it had gone out. Removing it is the honest outcome.
         */
        await this.remove(data.id);
        throw audienceError;
      }
    }

    const { data: profile } = await this.#client
      .from('profiles')
      .select('*')
      .eq('id', me)
      .maybeSingle();

    const urls = await this.#signMedia([data]);

    return this.#toStory(
      data,
      profile ?? {
        id: me,
        username: '',
        display_name: 'You',
        avatar_url: null,
        bio: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      urls,
      // Your own story is seen by definition - you just made it.
      new Set([data.id]),
      new Set(),
    );
  }

  async markSeen(storyId: string): Promise<void> {
    const me = await this.#userId();
    // Idempotent: the primary key is (story_id, viewer_id), so a repeat view
    // conflicts with itself and is ignored rather than counted twice.
    await this.#client
      .from('story_views')
      .upsert({ story_id: storyId, viewer_id: me }, { onConflict: 'story_id,viewer_id' });
  }

  async remove(storyId: string): Promise<void> {
    // Read the path first: after the delete there is nothing left to ask.
    const { data: existing } = await this.#client
      .from('stories')
      .select('media_path')
      .eq('id', storyId)
      .maybeSingle();

    const { error } = await this.#client.from('stories').delete().eq('id', storyId);
    if (error) throw error;

    // After the row, not before - a delete that fails must not leave a story
    // pointing at media that has already gone.
    if (existing?.media_path) {
      await this.#client.storage.from(STORY_BUCKET).remove([existing.media_path]);
    }
  }

  async setLiked(storyId: string, liked: boolean): Promise<void> {
    const me = await this.#userId();

    const { error } = liked
      ? await this.#client
          .from('story_likes')
          // Liking twice is a double tap, not an error worth showing.
          .upsert(
            { story_id: storyId, user_id: me },
            { onConflict: 'story_id,user_id', ignoreDuplicates: true },
          )
      : await this.#client.from('story_likes').delete().eq('story_id', storyId).eq('user_id', me);

    if (error) throw error;
  }

  async listViewers(storyId: string): Promise<StoryViewer[]> {
    const { data, error } = await this.#client.rpc('story_viewers', { target: storyId });
    if (error) throw error;

    return (data ?? []).map((row) => ({
      userId: row.viewer_id,
      username: row.username,
      displayName: row.display_name,
      ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
      viewedAt: Date.parse(row.viewed_at),
      liked: row.liked,
    }));
  }

  async insights(storyId: string): Promise<StoryInsights> {
    const { data, error } = await this.#client.rpc('story_insights', { target: storyId });
    if (error) throw error;

    const row = data?.[0];
    return { views: row?.views ?? 0, likes: row?.likes ?? 0, replies: row?.replies ?? 0 };
  }

  // -- close friends --------------------------------------------------------

  async listCloseFriends(): Promise<string[]> {
    const me = await this.#userId();
    const { data, error } = await this.#client
      .from('close_friends')
      .select('friend_id')
      .eq('owner_id', me);

    if (error) throw error;
    return (data ?? []).map((row) => row.friend_id);
  }

  async setCloseFriend(userId: string, close: boolean): Promise<void> {
    const me = await this.#userId();

    const { error } = close
      ? await this.#client
          .from('close_friends')
          .upsert(
            { owner_id: me, friend_id: userId },
            { onConflict: 'owner_id,friend_id', ignoreDuplicates: true },
          )
      : await this.#client
          .from('close_friends')
          .delete()
          .eq('owner_id', me)
          .eq('friend_id', userId);

    if (error) throw error;
  }

  // -- privacy --------------------------------------------------------------

  async listHiddenFrom(): Promise<string[]> {
    const me = await this.#userId();
    const { data, error } = await this.#client
      .from('story_hidden_from')
      .select('user_id')
      .eq('owner_id', me);

    if (error) throw error;
    return (data ?? []).map((row) => row.user_id);
  }

  async setHiddenFrom(userId: string, hidden: boolean): Promise<void> {
    const me = await this.#userId();

    const { error } = hidden
      ? await this.#client
          .from('story_hidden_from')
          .upsert(
            { owner_id: me, user_id: userId },
            { onConflict: 'owner_id,user_id', ignoreDuplicates: true },
          )
      : await this.#client
          .from('story_hidden_from')
          .delete()
          .eq('owner_id', me)
          .eq('user_id', userId);

    if (error) throw error;
  }

  async listMutedAuthors(): Promise<string[]> {
    const me = await this.#userId();
    const { data, error } = await this.#client
      .from('story_muted_authors')
      .select('author_id')
      .eq('muter_id', me);

    if (error) throw error;
    return (data ?? []).map((row) => row.author_id);
  }

  async setAuthorMuted(userId: string, muted: boolean): Promise<void> {
    const me = await this.#userId();

    const { error } = muted
      ? await this.#client
          .from('story_muted_authors')
          .upsert(
            { muter_id: me, author_id: userId },
            { onConflict: 'muter_id,author_id', ignoreDuplicates: true },
          )
      : await this.#client
          .from('story_muted_authors')
          .delete()
          .eq('muter_id', me)
          .eq('author_id', userId);

    if (error) throw error;
  }

  // -- helpers --------------------------------------------------------------

  /**
   * Everyone the signed-in user is mutual with.
   *
   * Worked out here rather than borrowed from `SupabaseProfileService`, because
   * the alternative is one service reaching into another - and a story rail
   * that breaks when the profile service changes shape is a worse coupling than
   * eight lines of set intersection.
   */
  async #mutualIds(): Promise<string[]> {
    const me = await this.#userId();

    const { data } = await this.#client
      .from('follows')
      .select('follower_id, followee_id')
      .eq('status', 'accepted');

    const iFollow = new Set<string>();
    const followsMe = new Set<string>();
    for (const row of data ?? []) {
      if (row.follower_id === me) iFollow.add(row.followee_id);
      if (row.followee_id === me) followsMe.add(row.follower_id);
    }

    return [...iFollow].filter((id) => followsMe.has(id));
  }
}
