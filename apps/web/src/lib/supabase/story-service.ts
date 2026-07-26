/**
 * `StoryService`, implemented on Supabase.
 *
 * Reads `stories` / `story_views` and writes media to the `stories` bucket, all
 * from `supabase/migrations/20260725210000_stories_and_streaks.sql`.
 *
 * Expiry is enforced by the row-level security policy — `expires_at > now()` —
 * not by a filter here. An expired story is therefore unreachable through the
 * API at all, rather than merely hidden by a client that could be rewritten.
 */

import type { Story, StoryGroup, StoryService } from '@pingo/core';

import { getSupabaseClient, type PingoSupabaseClient } from './client.js';
import type { ProfileRow } from './types.js';

const STORY_BUCKET = 'stories';

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

  async listStoryGroups(): Promise<StoryGroup[]> {
    const me = await this.#userId();

    const { data: rows, error } = await this.#client
      .from('stories')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!rows || rows.length === 0) return [];

    const authorIds = [...new Set(rows.map((row) => row.author_id))];

    const [{ data: profiles }, { data: views }] = await Promise.all([
      this.#client.from('profiles').select('*').in('id', authorIds),
      // Only the signed-in user's own view rows are readable, which is exactly
      // what "have *I* seen this" needs.
      this.#client
        .from('story_views')
        .select('story_id')
        .in(
          'story_id',
          rows.map((row) => row.id),
        ),
    ]);

    const profileById = new Map<string, ProfileRow>(
      (profiles ?? []).map((profile) => [profile.id, profile]),
    );
    const seen = new Set((views ?? []).map((view) => view.story_id));

    const groups = new Map<string, StoryGroup>();

    for (const row of rows) {
      const profile = profileById.get(row.author_id);
      // A story whose author has no profile cannot be rendered — skip rather
      // than show a nameless circle.
      if (!profile) continue;

      const story: Story = {
        id: row.id,
        authorId: row.author_id,
        authorName: profile.display_name,
        authorUsername: profile.username,
        ...(profile.avatar_url ? { authorAvatarUrl: profile.avatar_url } : {}),
        mediaUrl: row.media_url,
        createdAt: Date.parse(row.created_at),
        expiresAt: Date.parse(row.expires_at),
        seen: seen.has(row.id),
      };

      const existing = groups.get(row.author_id);
      if (existing) {
        existing.stories.push(story);
        existing.allSeen = existing.allSeen && story.seen;
        existing.latestAt = Math.max(existing.latestAt, story.createdAt);
      } else {
        groups.set(row.author_id, {
          authorId: row.author_id,
          authorName: profile.display_name,
          authorUsername: profile.username,
          ...(profile.avatar_url ? { authorAvatarUrl: profile.avatar_url } : {}),
          stories: [story],
          allSeen: story.seen,
          latestAt: story.createdAt,
        });
      }
    }

    /*
     * You first, then unseen, then most recent. The row's job is to answer
     * "what is new" at a glance, so anything already watched sinks.
     */
    return [...groups.values()].sort((a, b) => {
      if (a.authorId === me) return -1;
      if (b.authorId === me) return 1;
      if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
      return b.latestAt - a.latestAt;
    });
  }

  async post(media: Blob): Promise<Story> {
    const me = await this.#userId();

    // Per-user folder, which is what the storage policy checks.
    const path = `${me}/story-${Date.now()}`;

    const { error: uploadError } = await this.#client.storage
      .from(STORY_BUCKET)
      .upload(path, media, { contentType: media.type || 'image/jpeg' });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = this.#client.storage.from(STORY_BUCKET).getPublicUrl(path);

    const { data, error } = await this.#client
      .from('stories')
      .insert({ author_id: me, media_url: publicUrl.publicUrl })
      .select('*')
      .single();

    if (error) throw error;

    const { data: profile } = await this.#client
      .from('profiles')
      .select('*')
      .eq('id', me)
      .maybeSingle();

    return {
      id: data.id,
      authorId: me,
      authorName: profile?.display_name ?? 'You',
      authorUsername: profile?.username ?? '',
      ...(profile?.avatar_url ? { authorAvatarUrl: profile.avatar_url } : {}),
      mediaUrl: data.media_url,
      createdAt: Date.parse(data.created_at),
      expiresAt: Date.parse(data.expires_at),
      // Your own story is seen by definition — you just made it.
      seen: true,
    };
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
    const { error } = await this.#client.from('stories').delete().eq('id', storyId);
    if (error) throw error;
  }
}
