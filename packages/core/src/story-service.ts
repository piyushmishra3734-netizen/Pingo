/**
 * The StoryService boundary.
 *
 * Stories are ephemeral posts — media that expires. That makes them neither
 * profile data (which persists) nor conversation data (which is addressed to
 * someone), so they get their own boundary rather than being wedged into a
 * service whose contract they would contradict.
 */

/** One posted story. Expired ones are never returned. */
export interface Story {
  id: string;
  authorId: string;
  /** Denormalised so a row of stories renders without a second lookup. */
  authorName: string;
  authorUsername: string;
  authorAvatarUrl?: string;
  mediaUrl: string;
  createdAt: number;
  expiresAt: number;
  /** Whether the signed-in user has already opened it. Drives the ring state. */
  seen: boolean;
}

/**
 * One person's stories, grouped for the home row.
 *
 * The row shows people, not posts: five stories from one person is one circle,
 * opened as a sequence.
 */
export interface StoryGroup {
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorAvatarUrl?: string;
  stories: Story[];
  /** True when every story in the group has been seen. */
  allSeen: boolean;
  /** Newest story's timestamp, for ordering the row. */
  latestAt: number;
}

export interface StoryService {
  /**
   * Everyone's live stories, grouped by author.
   *
   * The signed-in user's own group comes first when present — the row leads
   * with "You", the way every story rail does.
   */
  listStoryGroups(): Promise<StoryGroup[]>;

  /** Uploads the media and posts it. Expiry is set by the backend, not here. */
  post(media: Blob): Promise<Story>;

  /** Records that the signed-in user opened it. Idempotent. */
  markSeen(storyId: string): Promise<void>;

  /** Authors only. */
  remove(storyId: string): Promise<void>;
}
