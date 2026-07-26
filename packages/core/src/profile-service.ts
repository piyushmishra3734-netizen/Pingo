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
  createdAt: number;
}

/** A draft profile, as collected across the sign-up steps. */
export interface ProfileDraft {
  username: string;
  displayName: string;
  avatarUrl?: string;
}

export type ProfileErrorCode =
  /** The handle is taken. Checked live, and again on write. */
  | 'username_taken'
  /** The handle is not 3–20 of `[a-z0-9_]`. */
  | 'username_invalid'
  | 'offline'
  | 'unknown';

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
