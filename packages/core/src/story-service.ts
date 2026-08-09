/**
 * The StoryService boundary.
 *
 * Stories are ephemeral posts - media that expires. That makes them neither
 * profile data (which persists) nor conversation data (which is addressed to
 * someone), so they get their own boundary rather than being wedged into a
 * service whose contract they would contradict.
 *
 * ## What is deliberately *not* here
 *
 * Replying to a story, and reacting to one, are not story operations. Both
 * produce a private message in the thread with that person, so both go through
 * `ChatService.sendMessage` with `storyReply` set. Putting them here would mean
 * a second way to send a message, with its own bugs, for something the chat
 * already does - and it would quietly invent a "story comment", which this
 * product does not have.
 */

export type StoryKind = 'photo' | 'video';

/**
 * Who a story goes to.
 *
 * Decided per story rather than per account, because that is how people
 * actually use it: one picture goes to close friends and the next goes to
 * everyone, and neither is a change of mind about the account.
 */
export type StoryAudience =
  /** Anyone signed in. */
  | 'public'
  /** Mutual follows. The default, and what most stories are. */
  | 'friends'
  /** The author's close friends list. Shown with a green ring. */
  | 'close'
  /** Named people, and nobody else. */
  | 'custom';

/** One posted story. */
export interface Story {
  id: string;
  authorId: string;
  /** Denormalised so a row of stories renders without a second lookup. */
  authorName: string;
  authorUsername: string;
  authorAvatarUrl?: string;
  kind: StoryKind;
  /** Short-lived and signed. Do not cache it - re-read the story instead. */
  mediaUrl: string;
  caption?: string;
  /** Free text, as typed. Not geocoded - a geocoder is a dependency with a key. */
  location?: string;
  /** An http(s) link the viewer can open. */
  linkUrl?: string;
  audience: StoryAudience;
  createdAt: number;
  expiresAt: number;
  /** Whether the signed-in user has already opened it. Drives the ring state. */
  seen: boolean;
  likedByMe: boolean;
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
  /** A mutual follow. Friends sort ahead of everybody else. */
  isFriend: boolean;
  /**
   * At least one story here went to close friends only.
   *
   * Derived rather than stored: being able to see a `close` story *is* what
   * being on the list means, so there is nothing else to ask. Drives the green
   * ring.
   */
  closeFriends: boolean;
}

/** A story about to be posted. */
export interface StoryDraft {
  media: Blob;
  kind: StoryKind;
  caption?: string;
  audience: StoryAudience;
  /** Required for `custom`, ignored otherwise. */
  audienceUserIds?: string[];
  location?: string;
  linkUrl?: string;
}

/** One person who watched a story. Owner-only - see `listViewers`. */
export interface StoryViewer {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  viewedAt: number;
  liked: boolean;
}

/**
 * The three numbers under one's own story.
 *
 * Deliberately three. A story is a thing you posted this morning and will have
 * forgotten by tomorrow, and the product has no reach graph, no retention curve
 * and no ambition to grow one.
 */
export interface StoryInsights {
  views: number;
  likes: number;
  replies: number;
}

export interface StoryService {
  /**
   * Live stories the signed-in user may see, grouped by author.
   *
   * Already filtered by audience - the database decides, not this list - and
   * with muted authors dropped. Ordering is the caller's business.
   */
  listStoryGroups(): Promise<StoryGroup[]>;

  /**
   * The signed-in user's own expired stories, newest first.
   *
   * Private, and only ever their own: the archive is a query over stories that
   * have aged out, not a copy made when they did, so it is complete the instant
   * a story expires with nothing needing to have run.
   */
  listArchive(): Promise<Story[]>;

  /** Uploads the media and posts it. Expiry is set by the backend, not here. */
  post(draft: StoryDraft): Promise<Story>;

  /** Records that the signed-in user opened it. Idempotent. */
  markSeen(storyId: string): Promise<void>;

  /** Authors only. Removes the media too. */
  remove(storyId: string): Promise<void>;

  /**
   * Likes or unlikes a story.
   *
   * The like is private between the two of them; there is no public count and
   * no viewer of a story can see whether anyone else liked it.
   */
  setLiked(storyId: string, liked: boolean): Promise<void>;

  /** Who watched one story. Author only; returns empty for anyone else. */
  listViewers(storyId: string): Promise<StoryViewer[]>;

  /** Views, likes and replies for one story. Author only. */
  insights(storyId: string): Promise<StoryInsights>;

  // -- close friends --------------------------------------------------------

  /**
   * The signed-in user's close friends, as ids.
   *
   * One-directional and private: being on the list is not something the other
   * person is told, and not something anybody else can read.
   */
  listCloseFriends(): Promise<string[]>;

  setCloseFriend(userId: string, close: boolean): Promise<void>;

  // -- privacy --------------------------------------------------------------

  /** People who never see the signed-in user's stories, as ids. */
  listHiddenFrom(): Promise<string[]>;

  setHiddenFrom(userId: string, hidden: boolean): Promise<void>;

  /**
   * Authors whose stories the signed-in user has muted, as ids.
   *
   * Entirely the muter's business - the author is never told, and their circle
   * simply stops appearing in the rail.
   */
  listMutedAuthors(): Promise<string[]>;

  setAuthorMuted(userId: string, muted: boolean): Promise<void>;
}

/** The five reactions offered under a story. Order is the order they appear. */
export const STORY_REACTIONS = ['❤️', '😂', '😮', '🔥', '😢'] as const;

export type StoryReaction = (typeof STORY_REACTIONS)[number];

/**
 * How long one photo story is shown before the next.
 *
 * Five seconds, which is what every story product has converged on - long
 * enough to read a caption, short enough that a queue of six is not a
 * commitment. A video runs for its own length instead; a timer that cuts a
 * video off mid-sentence is worse than one that waits.
 */
export const STORY_PHOTO_MS = 5000;

/** Labels for the audience picker, in the order they are offered. */
export const STORY_AUDIENCES: { value: StoryAudience; label: string; hint: string }[] = [
  { value: 'friends', label: 'Friends', hint: 'People you are friends with' },
  { value: 'close', label: 'Close friends', hint: 'Your list. They see a green ring' },
  { value: 'public', label: 'Everyone', hint: 'Anyone on PINGO' },
  { value: 'custom', label: 'Specific people', hint: 'Only who you choose' },
];
