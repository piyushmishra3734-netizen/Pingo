/**
 * PINGO domain model.
 *
 * These types are the contract between the UI and whatever is behind it — mock
 * data today, a real backend tomorrow. They are transport-agnostic on purpose:
 * no REST shapes, no socket envelopes, no ORM leakage.
 *
 * Timestamps are epoch milliseconds. A number sorts, diffs and serialises
 * identically on every platform, which `Date` does not.
 */

// ---------------------------------------------------------------------------
// Identity & presence
// ---------------------------------------------------------------------------

export type UserId = string;
export type ConversationId = string;
export type MessageId = string;

/**
 * Presence drives the purple dot. Every state on the branding board maps to one
 * of these, which is why the dot component can be a pure function of presence.
 */
export type PresenceState = 'online' | 'away' | 'offline';

export interface Presence {
  state: PresenceState;
  /** Epoch ms of last activity. Rendered as "last seen ..." when offline. */
  lastSeenAt: number;
}

export interface User {
  id: UserId;
  /** Display name, as the user chose to write it. */
  name: string;
  /** Unique handle without the leading @, e.g. "anaya". */
  handle: string;
  avatarUrl?: string;
  /** Short bio shown on the profile screen. */
  bio?: string;
  presence: Presence;
}

/** The signed-in user. Separate type because it carries settings nobody else sees. */
export interface CurrentUser extends User {
  settings: UserSettings;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Delivery lifecycle. The board shows a double-check on the outgoing bubble, so
 * these states must be distinguishable in the UI, not collapsed into "sent".
 */
export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export interface AttachmentBase {
  id: string;
  kind: AttachmentKind;
  /** Bytes. Undefined while an upload is still in flight. */
  size?: number;
}

export interface ImageAttachment extends AttachmentBase {
  kind: 'image';
  url: string;
  width: number;
  height: number;
  /** Tiny blurred placeholder, so media never pops in and jars the reader. */
  placeholder?: string;
  alt?: string;
}

export interface VideoAttachment extends AttachmentBase {
  kind: 'video';
  url: string;
  posterUrl?: string;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
}

/** Voice notes. The board renders these as a waveform with a play control. */
export interface AudioAttachment extends AttachmentBase {
  kind: 'audio';
  url: string;
  /** Seconds. */
  duration: number;
  /**
   * Normalised amplitudes in the range 0–1, one per waveform bar. Precomputed
   * rather than analysed client-side: decoding audio to draw a waveform is
   * wasteful and janky on a list of many notes.
   */
  waveform: number[];
}

export interface FileAttachment extends AttachmentBase {
  kind: 'file';
  url: string;
  fileName: string;
  mimeType: string;
}

export type Attachment =
  | ImageAttachment
  | VideoAttachment
  | AudioAttachment
  | FileAttachment;

export interface Reaction {
  emoji: string;
  /** Who reacted. Length is the count; membership decides if "you" reacted. */
  userIds: UserId[];
}

export interface Message {
  id: MessageId;
  conversationId: ConversationId;
  authorId: UserId;
  /** Empty string is valid when the message is attachment-only. */
  body: string;
  createdAt: number;
  status: DeliveryStatus;
  attachments: Attachment[];
  reactions: Reaction[];
  /** Set when this message is a reply, for the quoted preview. */
  replyToId?: MessageId;
  editedAt?: number;
  /**
   * Removed for everyone.
   *
   * The row survives so the thread keeps its shape and replies quoting it keep
   * an anchor; `body` is empty and the tombstone is what a reader sees. Not a
   * system message — it stays on its author's side of the thread, because who
   * deleted it is part of what happened.
   */
  deleted?: boolean;
  /**
   * When it was removed, which is not when it was sent.
   *
   * A tombstone keeps its place in the thread but its interesting moment is the
   * deletion — "this was taken back, just now" is a different fact from "this
   * was sent at 8pm", and the thread shows the one that changed.
   */
  deletedAt?: number;
  /**
   * System notices ("Kabir joined") render as centred captions, not bubbles.
   */
  system?: boolean;
  /**
   * Set when the message *is* a sticker.
   *
   * Not an attachment: a sticker has no caption and renders without a bubble,
   * so treating it as one would mean every bubble carrying a "but not if it is
   * a sticker" branch. `body` still holds the sticker's emoji or name, which is
   * what a notification, the conversation list and a screen reader read.
   */
  sticker?: StickerRef;

  /**
   * A photo taken in the camera, already flattened with its filter and edits.
   *
   * Like a sticker, this replaces the bubble rather than decorating it — the
   * picture is the message. `body` stays a short label so notifications and the
   * conversation list have something to say without loading the image.
   *
   * Deliberately carries **no URL**. A Ping can be opened once or twice and then never
   * again, and a URL sitting in the message would be a copy the viewer keeps —
   * which would make the limit decorative. The bytes are fetched through
   * `ChatService.openPing`, and asking is what spends the view.
   */
  ping?: PingRef;

  /**
   * A picture sent into the chat, with an optional caption in `body`.
   *
   * Distinct from `ping` because the two are opposites: a Ping is built to be
   * hard to keep, a photo is built to stay. Sharing one shape would mean every
   * reader of a photo going through the machinery that destroys Pings.
   */
  photo?: PhotoRef;

  /** A place, shared as coordinates. Rendered as a card that opens a map. */
  location?: LocationRef;
  /** Somebody's details, passed on. */
  contact?: ContactRef;
  /** A time and a title, so it can be added to a calendar. */
  event?: EventRef;
  /**
   * A finished call, sitting in the thread where it happened.
   *
   * Calls are stored as messages rather than in a table of their own — see the
   * call-history migration — so this is what the thread and the Calls screen
   * both render from.
   */
  call?: CallLogRef;

  /**
   * Present when this message was sent as a reply to a story.
   *
   * The bubble is an ordinary one — the reply is just a message — but knowing
   * it answers a story is what lets the thread say so, instead of showing a
   * remark about a picture nobody in the conversation can see any more.
   */
  storyReply?: { storyId: string };
}

export interface CallLogRef {
  callKind: CallKind;
  outcome: CallOutcome;
  /** Seconds. Zero unless it was answered. */
  durationSeconds: number;
  /** Who was rung. The message's author is whoever rang them. */
  calleeId: UserId;
}

export interface LocationRef {
  lat: number;
  lng: number;
  /** What the sender called it. Absent means the card shows coordinates. */
  label?: string;
}

export interface ContactRef {
  name: string;
  /** A PINGO handle, when the contact is someone in the app. */
  handle?: string;
  /** Set when they are a PINGO user, so the card can open their chat. */
  userId?: UserId;
}

export interface EventRef {
  title: string;
  /** Epoch ms. */
  startsAt: number;
  location?: string;
}

/** A photo message's picture. Like a Ping, it carries no URL — see `PhotoRef.url`. */
export interface PhotoRef {
  /**
   * How many times each recipient may open it. Absent means without limit.
   *
   * A limited photo behaves like a Ping: the thread shows a cover rather than
   * the picture, and opening it spends one of the views.
   */
  viewLimit?: number;
  /** Views this reader has left, once they have opened it at least once. */
  viewsLeft?: number;
  /** True once this reader can no longer open it. */
  gone?: boolean;
  /**
   * A short-lived signed URL, present only for photos with no view limit.
   *
   * Limited ones deliberately have none until the reader asks, because a URL
   * sitting in the message is a copy the limit cannot govern.
   */
  url?: string;
  /** Shape, so the bubble can reserve the right space before the bytes land. */
  width?: number;
  height?: number;
}

/**
 * What a client may know about a Ping without having opened it.
 *
 * `gone` covers every way a Ping ends — views spent, saved, or expired —
 * because from the thread's point of view they are the same state, and
 * distinguishing them would only tell the viewer things about the other person.
 */
export interface PingRef {
  /** Epoch ms. After this the server will not hand out the image. */
  expiresAt: number;
  /** True once the media is unrecoverable. The bubble stays; the picture does not. */
  gone: boolean;
  /**
   * How many views the sender allowed: 1 or 2.
   *
   * Shown before opening, so the decision to look is an informed one — a single
   * view is a different thing to accept than two, and finding that out
   * afterwards is too late.
   */
  views: number;
}

/** The result of spending a view: the image, and how many are left after it. */
export interface PingView {
  url: string;
  /** 0 means this was the last look. */
  viewsLeft: number;
}

/** Enough to render a sticker without loading the pack it came from. */
export interface StickerRef {
  id: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * Three kinds, one list. A community is distinguished from a group by scale and
 * by having channels, but it still appears in the same conversation list — the
 * product should feel like one surface, not three inboxes.
 */
export type ConversationKind = 'direct' | 'group' | 'community';

export interface Conversation {
  id: ConversationId;
  kind: ConversationKind;
  /** Derived from the other participant for direct chats; explicit otherwise. */
  title: string;
  avatarUrl?: string;
  participantIds: UserId[];
  /**
   * Who runs this group. Empty for a direct chat, which has no ranks.
   *
   * A subset of `participantIds` rather than a flag on each participant,
   * because almost every screen wants the roster and only the group's own
   * screens want the roles — and a list of two ids is cheaper to compare than
   * a list of objects that changes identity whenever anything else does.
   */
  adminIds?: UserId[];
  /** Denormalised for the list view, so rendering never needs the full thread. */
  lastMessage?: Message;
  unreadCount: number;
  /** Pinned conversations sort above everything else. */
  pinned: boolean;
  /**
   * Muted right now. Derived from `mutedUntil`, never stored — an expired mute
   * is unmuted the instant it expires, with nothing to run and clear it.
   */
  muted: boolean;
  /**
   * When the mute lifts. Absent means not muted; `Infinity` means never.
   *
   * Carried separately from `muted` so a row can say *how long* rather than
   * only whether — "Muted until 8:00 pm" is the sentence that helps.
   */
  mutedUntil?: number;
  favorite: boolean;
  /**
   * Out of the main list. Private to this member.
   *
   * Whether a chat with new messages still counts as archived depends on the
   * reader's preference, so this is resolved from `archivedAt` rather than
   * being a fact the server hands down.
   */
  archived: boolean;
  /** When it was archived, so a newer message can be compared against it. */
  archivedAt?: number;
  /** Custom lists this conversation is filed under. A chat may be in several. */
  listIds: string[];
  /** User IDs currently typing. Drives the typing dots in the list and header. */
  typingUserIds: UserId[];
  updatedAt: number;
  /**
   * Consecutive days both people have sent a message, direct chats only.
   *
   * **Absent means no streak, and the UI shows nothing at all** — not a zero,
   * not an empty badge. A streak is a reward; rendering "🔥0" would turn it
   * into a scoreboard nobody asked to be on.
   */
  streak?: number;
}

/**
 * A user's own way of grouping chats — "Work", "Family".
 *
 * Private to its owner. Two people may both have a "Work" list and they have
 * nothing to do with each other.
 */
export interface ChatList {
  id: string;
  name: string;
  /** How many conversations are filed under it, for the chip's count. */
  count: number;
}

/**
 * The per-member flags a conversation carries.
 *
 * All optional, so a caller states only what it is changing — passing the full
 * set every time would mean every caller having to know the current values of
 * the flags it does not care about.
 */
export interface ConversationFlags {
  pinned?: boolean;
  /**
   * When the mute should lift: a timestamp, `Infinity` for always, or `null` to
   * unmute. Not a boolean — `true` cannot say for how long, and every product
   * that starts with one ends up adding a deadline column beside it.
   */
  mutedUntil?: number | null;
  favorite?: boolean;
  archived?: boolean;
  /**
   * Deliberately unread. Cannot be derived from the read cursor, because the
   * whole point is that you *have* read it and want the list to disagree.
   * Setting it false is "mark as read", which also clears the real unreads.
   */
  unread?: boolean;
}

/** The chip row on the home screen: All · Unread · Groups · Favorites. */
export type ConversationFilter = 'all' | 'unread' | 'groups' | 'favorites';

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export type CallKind = 'voice' | 'video';
export type CallDirection = 'incoming' | 'outgoing';
/**
 * How a call ended.
 *
 * `unreachable` is separate from `missed`: one means nobody picked up, the other
 * means it never got as far as ringing. A caller can tell the difference by ear,
 * so the log should not pretend they are the same thing.
 */
export type CallOutcome = 'answered' | 'missed' | 'declined' | 'unreachable';

export interface CallRecord {
  id: string;
  kind: CallKind;
  direction: CallDirection;
  outcome: CallOutcome;
  /** The other party for 1:1; the conversation for group calls. */
  withUserId?: UserId;
  conversationId?: ConversationId;
  startedAt: number;
  /** Seconds. Zero for missed and declined calls. */
  duration: number;
}

// ---------------------------------------------------------------------------
// Profile gallery & moments
// ---------------------------------------------------------------------------

/** Images and videos on a profile page. */
export interface GalleryItem {
  id: string;
  kind: 'image' | 'video';
  url: string;
  posterUrl?: string;
  width: number;
  height: number;
  createdAt: number;
  caption?: string;
}

/**
 * Moments are PINGO's stories. Deliberately not a feed: they expire, they are
 * not ranked, and there is no infinite scroll. The product does not farm
 * attention.
 */
export interface Moment {
  id: string;
  authorId: UserId;
  media: GalleryItem;
  createdAt: number;
  expiresAt: number;
  viewedByCurrentUser: boolean;
}

// ---------------------------------------------------------------------------
// Notifications & settings
// ---------------------------------------------------------------------------

export interface AppNotification {
  id: string;
  kind:
    | 'message'
    | 'ping'
    | 'ping_opened'
    | 'ping_replayed'
    | 'call'
    | 'follow_request'
    | 'follow_accepted'
    | 'story'
    | 'mention'
    | 'system';
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  conversationId?: ConversationId;
  /** Who caused it, when there is a person behind it. */
  actorId?: UserId;
}

export interface UserSettings {
  /** Light is the brand default. Dark is a future addition, not a promise yet. */
  appearance: 'light' | 'dark' | 'system';
  notifications: {
    messages: boolean;
    calls: boolean;
    mentions: boolean;
    /** Suppresses all notification surfaces between the configured hours. */
    quietHours: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  };
  privacy: {
    /** Who may see the presence dot. */
    presenceVisibility: 'everyone' | 'contacts' | 'nobody';
    readReceipts: boolean;
    /** Governs whether typing state is broadcast at all. */
    typingIndicators: boolean;
    lastSeen: boolean;
  };
  /** Honours the OS setting by default; can be forced on. */
  reducedMotion: boolean;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type SearchResult =
  | { kind: 'conversation'; conversation: Conversation }
  | { kind: 'message'; message: Message; conversation: Conversation }
  | { kind: 'user'; user: User };
