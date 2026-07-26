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
   * Deliberately carries **no URL**. A snap can be opened twice and then never
   * again, and a URL sitting in the message would be a copy the viewer keeps —
   * which would make the limit decorative. The bytes are fetched through
   * `ChatService.openSnap`, and asking is what spends the view.
   */
  snap?: SnapRef;
}

/**
 * What a client may know about a snap without having opened it.
 *
 * `gone` covers every way a snap ends — two views spent, downloaded, or
 * expired — because from the thread's point of view they are the same state and
 * distinguishing them would only tell the viewer things about the other person.
 */
export interface SnapRef {
  /** Epoch ms. After this the server will not hand out the image. */
  expiresAt: number;
  /** True once the media is unrecoverable. The bubble stays; the picture does not. */
  gone: boolean;
}

/** The result of spending a view: the image, and how many are left after it. */
export interface SnapView {
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
  /** Denormalised for the list view, so rendering never needs the full thread. */
  lastMessage?: Message;
  unreadCount: number;
  /** Pinned conversations sort above everything else. */
  pinned: boolean;
  /** Muted conversations still count unreads but never notify. */
  muted: boolean;
  favorite: boolean;
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

/** The chip row on the home screen: All · Unread · Groups · Favorites. */
export type ConversationFilter = 'all' | 'unread' | 'groups' | 'favorites';

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export type CallKind = 'voice' | 'video';
export type CallDirection = 'incoming' | 'outgoing';
export type CallOutcome = 'answered' | 'missed' | 'declined';

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
  kind: 'message' | 'snap' | 'call' | 'follow_request' | 'follow_accepted' | 'story' | 'mention' | 'system';
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
