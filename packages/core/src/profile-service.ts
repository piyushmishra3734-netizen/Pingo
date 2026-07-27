/**
 * The ProfileService boundary.
 *
 * The third boundary in PINGO, alongside `ChatService` and `AuthService`, and it
 * follows the same rule: screens depend on this interface and never on a
 * concrete implementation.
 *
 * ## Why profile is not part of auth
 *
 * `AuthService` answers *who is signed in* — an id, the contact points, the
 * doors that open the account. This answers *who they are to other people* —
 * name, handle, photo. Keeping them apart is what stopped the auth layer from
 * growing into a second user store, and it is why signing in with a phone and
 * being called "Piyush" are independent facts.
 */

/** How a person appears to everyone else. */
export interface Profile {
  /** Same id as the auth user. One row per account. */
  id: string;
  /** Lowercase handle, 3–20 of `[a-z0-9_]`. Unique across the product. */
  username: string;
  /** What people call them. Required — a nameless account is unusable. */
  displayName: string;
  /** Absent means the monogram, which is a real default and not a gap. */
  avatarUrl?: string;
  /**
   * A short line about themselves. Free text — emoji, line breaks, a website,
   * an @mention. Nothing in it is parsed for meaning at the boundary; the
   * screen that renders it decides what a link or a mention looks like.
   */
  bio?: string;
  createdAt: number;
}

/** A draft profile, as collected across the sign-up steps. */
export interface ProfileDraft {
  username: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
}

export type ProfileErrorCode =
  /** The handle is taken. Checked live, and again on write. */
  | 'username_taken'
  /** The handle is not 3–20 of `[a-z0-9_]`. */
  | 'username_invalid'
  /** A fourth post on a profile that already holds three. Replace one instead. */
  | 'post_limit'
  | 'offline'
  | 'unknown';

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/**
 * A post on a profile.
 *
 * PINGO allows three, permanently. That is a product decision rather than a
 * storage one: a profile is a portrait, and three pictures is what a portrait
 * needs. There is no feed for these to scroll in, which is why nothing here
 * carries a cursor or a page.
 *
 * `imageUrl` is short-lived and signed — the bucket is private, so a URL held
 * from an earlier read will stop working. Anything that keeps a post around
 * should re-read it rather than cache the URL.
 */
export interface Post {
  id: string;
  authorId: string;
  imageUrl: string;
  caption?: string;
  createdAt: number;
  /** Set when the caption has been changed since posting. */
  editedAt?: number;
  likeCount: number;
  likedByMe: boolean;
  /** Saving is private: nobody else can see that this was saved. */
  savedByMe: boolean;
  commentCount: number;
}

/** A new post, or the replacement for an existing one. */
export interface PostDraft {
  image: Blob;
  caption?: string;
}

export interface PostComment {
  id: string;
  postId: string;
  author: Profile;
  body: string;
  createdAt: number;
}

/** The three numbers under a profile. Deliberately not followers and following. */
export interface ProfileStats {
  posts: number;
  friends: number;
  groups: number;
}

/**
 * What the signed-in user and one other person have between them.
 *
 * PINGO's own idea, and the reason a profile here is not a copy of somebody
 * else's: the interesting thing about a person you know is the history, not the
 * audience. Only ever shown on the two profiles it concerns.
 */
export interface SharedHistory {
  /** When the follow became mutual. Absent when they are not friends. */
  friendsSince?: number;
  mutualGroups: number;
  photosShared: number;
}

/**
 * One picture from a chat, for the owner's private Media tab.
 *
 * Not a post and never public: this is the pictures that have passed through
 * someone's conversations, gathered so they can be found again. Only the owner
 * of the profile can read it, which is enforced by row level security on the
 * messages behind it rather than by this type.
 */
export interface ChatMediaItem {
  /** The message it came from, so tapping it can open the conversation. */
  id: string;
  url: string;
  createdAt: number;
  conversationId: string;
  /** True when the signed-in user sent it rather than received it. */
  mine: boolean;
}

export type ReportReason = 'spam' | 'harassment' | 'nudity' | 'hate' | 'scam' | 'other';

export interface ReportInput {
  /** The person, the post, or both. At least one is required. */
  userId?: string;
  postId?: string;
  reason: ReportReason;
  details?: string;
}

export class ProfileError extends Error {
  readonly code: ProfileErrorCode;

  constructor(code: ProfileErrorCode, message: string) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
  }
}

export interface ProfileService {
  /** The signed-in user's profile, or `null` if sign-up has not created it yet. */
  getMine(): Promise<Profile | null>;

  /**
   * One person, by handle or by id.
   *
   * Both, in one call, because a profile link can carry either: `/profile/anaya`
   * is what a user shares, and `/profile/<uuid>` is what a contact card in a
   * chat produces. A caller that had to know which it held would guess, and the
   * guess is what makes shared profile links break.
   *
   * `null` for a handle nobody has.
   */
  find(handleOrId: string): Promise<Profile | null>;

  /**
   * Whether a handle can be claimed.
   *
   * Advisory only. Two people can pass this check with the same handle in the
   * same second, so `create` re-checks and the unique index is the real
   * arbiter — this exists to give the sign-up screen an answer while typing,
   * not to guarantee one.
   */
  isUsernameAvailable(username: string): Promise<boolean>;

  /** Handles near a taken one, all verified free at the moment of the call. */
  suggestUsernames(from: string): Promise<string[]>;

  /**
   * Writes the profile for the signed-in user.
   *
   * @throws `ProfileError` with `username_taken` when the handle went between
   * the availability check and this call.
   */
  create(draft: ProfileDraft): Promise<Profile>;

  update(changes: Partial<ProfileDraft>): Promise<Profile>;

  /** Stores the image and returns its URL. Does not attach it to the profile. */
  uploadAvatar(file: Blob): Promise<string>;

  /**
   * Other people on PINGO, newest first.
   *
   * Not contact matching — the web has no address-book API, so this cannot be
   * "friends from your contacts". It is the honest version: people who are
   * already here.
   */
  listRecentPeople(limit?: number): Promise<Profile[]>;

  // -- follows -------------------------------------------------------------

  /** Where this person stands with the signed-in user. */
  followState(userId: string): Promise<FollowState>;

  /** Sends a follow request. Idempotent — asking twice does not queue two. */
  requestFollow(userId: string): Promise<FollowState>;

  /**
   * Accepts a request this person sent you.
   *
   * Accepting does **not** follow them back. Mutual access needs both
   * directions, so the UI still offers "follow back" afterwards — otherwise
   * accepting would silently grant them your stories and calls while giving you
   * nothing, which is not what the person tapping "Accept" is agreeing to.
   */
  acceptFollow(userId: string): Promise<FollowState>;

  /** Unfollow, withdraw a request, or reject one. All the same row. */
  removeFollow(userId: string): Promise<FollowState>;

  /** Requests waiting on the signed-in user, newest first. */
  listFollowRequests(): Promise<Profile[]>;

  /**
   * Everyone the signed-in user is mutual with, as ids.
   *
   * A set rather than one `followState` call per person: the camera's send list
   * and the chat header both need to gate several people at once, and asking
   * per row would be a request per contact on every render.
   */
  listMutualIds(): Promise<string[]>;

  // -- profile page ---------------------------------------------------------

  /** Posts, friends and groups for one person. Works for anyone, not just you. */
  stats(userId: string): Promise<ProfileStats>;

  /**
   * The history between the signed-in user and one other person.
   *
   * Takes one id rather than two, and can only ever answer about the caller —
   * a profile cannot be used to inspect two other people's relationship.
   */
  sharedWith(userId: string): Promise<SharedHistory>;

  // -- posts ----------------------------------------------------------------

  /** Somebody's posts, newest first. Never more than three. */
  listPosts(userId: string): Promise<Post[]>;

  /**
   * Publishes a post.
   *
   * @throws `ProfileError` with `post_limit` when the profile already holds
   * three. The caller is expected to have offered a replacement before getting
   * here — this is the backstop, not the user-facing rule.
   */
  createPost(draft: PostDraft): Promise<Post>;

  /**
   * Swaps the picture on an existing post, keeping its place and its comments.
   *
   * A replace rather than delete-then-create, because the fourth upload is
   * supposed to take one of the three slots — and a delete followed by a failed
   * upload would leave the profile with two.
   */
  replacePost(postId: string, draft: PostDraft): Promise<Post>;

  /** Edits the words, not the picture. */
  updatePostCaption(postId: string, caption: string): Promise<Post>;

  deletePost(postId: string): Promise<void>;

  setPostLiked(postId: string, liked: boolean): Promise<void>;

  /** Private to the person saving. Nobody is told their post was saved. */
  setPostSaved(postId: string, saved: boolean): Promise<void>;

  /** Comments on a post, oldest first — the order a conversation reads in. */
  listComments(postId: string): Promise<PostComment[]>;

  addComment(postId: string, body: string): Promise<PostComment>;

  /** Allowed for the comment's author and for the owner of the post. */
  deleteComment(commentId: string): Promise<void>;

  // -- private media --------------------------------------------------------

  /**
   * Pictures from the signed-in user's own conversations, newest first.
   *
   * Only ever their own: there is no user id here because there is no version
   * of this that answers about somebody else.
   */
  listChatMedia(limit?: number): Promise<ChatMediaItem[]>;

  // -- safety ---------------------------------------------------------------

  isBlocked(userId: string): Promise<boolean>;

  setBlocked(userId: string, blocked: boolean): Promise<void>;

  /**
   * Files a report. Fire and forget by design — nothing in the product reads
   * these back, so there is no state for the caller to reflect afterwards
   * beyond "thanks, we have it".
   */
  report(input: ReportInput): Promise<void>;
}

/**
 * The relationship between the signed-in user and someone else.
 *
 * Deliberately one value rather than a pair of booleans. Every screen asks the
 * same question — "what button do I show?" — and a `{ following, followedBy,
 * pending }` triple makes each of them re-derive the answer, differently.
 */
export type FollowState =
  /** Nothing between them. */
  | 'none'
  /** You asked; they have not answered. */
  | 'requested'
  /** They asked you. This is the one that needs a decision. */
  | 'incoming'
  /** You follow them; they do not follow you. No calls, snaps or stories yet. */
  | 'following'
  /** They follow you; you do not follow them. */
  | 'follower'
  /** Both accepted. Calls, snaps and stories are open. */
  | 'mutual';

/**
 * What a mutual follow unlocks.
 *
 * Messaging is absent on purpose: anyone can message anyone. A request you
 * cannot send is a product nobody can start using, so the open door is the
 * text box, and everything with a camera or microphone waits for both sides.
 */
export function canShareMedia(state: FollowState): boolean {
  return state === 'mutual';
}

/** Trims, lowercases and strips what the handle rules forbid. */
export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

/**
 * A starting handle derived from a display name.
 *
 * Best effort — it can return something invalid (too short, or empty for a name
 * with no Latin characters), which the caller checks rather than assumes.
 */
export function suggestUsernameFromName(displayName: string): string {
  return normaliseUsername(displayName.replace(/\s+/g, '')).slice(0, 20);
}
