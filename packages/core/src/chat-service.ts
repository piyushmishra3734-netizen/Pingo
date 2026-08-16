/**
 * The ChatService boundary.
 *
 * Everything the UI needs from a backend goes through this interface. Nothing in
 * apps/web imports a concrete implementation except one line at the composition
 * root - which is what makes swapping `MockChatService` for a real socket
 * client a single-file change rather than a refactor.
 *
 * Design notes:
 *   - Reads are async (a network round-trip today or tomorrow).
 *   - Live updates are push, via `subscribe`, never polling.
 *   - Sends are optimistic: the method returns the local message immediately in
 *     `sending` state, then emits status transitions through the event stream.
 *     Cross-device sync depends on the UI trusting events over return values.
 */

import type {
  AppNotification,
  CallOutcome,
  CallRecord,
  ChatList,
  Conversation,
  ConversationFlags,
  ConversationId,
  CurrentUser,
  GalleryItem,
  Message,
  MessageId,
  Moment,
  SearchResult,
  PingView,
  User,
  UserId,
  UserSettings,
} from './types.js';

/** A draft outgoing message, before the service assigns it an id and timestamp. */
/**
 * An edit applied when a video is played, not when it is sent.
 *
 * Lives with the service contract because both ends need it: the sender writes
 * it, the reader applies it, and neither should be reaching into the other's
 * player component for the shape.
 */
export interface VideoEdit {
  /** Seconds from the start of the file. */
  trimStart?: number;
  /** Seconds from the start of the file. */
  trimEnd?: number;
  muted?: boolean;
  /**
   * Things placed on top of the picture, drawn by the player.
   *
   * A photo carries its stickers in its pixels - the editor flattens them in.
   * A video cannot: flattening a video means re-encoding it, which is slow on a
   * phone, fails on half of them, and costs exactly the quality this app
   * refuses to spend. So the decorations travel as data beside the file, the
   * same way the trim marks already do, and the player puts them back.
   *
   * Absent means a bare clip, which is what every video posted before this
   * meant and still means.
   */
  overlay?: VideoOverlayItem[];
  /** Pen strokes, in the same normalised space as `overlay`. */
  strokes?: VideoOverlayStroke[];
  /**
   * Quarter turns clockwise, applied to the picture at playback.
   *
   * A sideways clip is turned by turning what is shown, not by rewriting the
   * file. Everything placed on it is stored against the turned picture, so the
   * player has one job: turn it, then draw.
   */
  rotate?: 90 | 180 | 270;
  /**
   * The part of the (turned) picture worth showing, as fractions of it.
   *
   * The player scales and shifts the clip so this rectangle fills the frame -
   * the rest is simply outside the box, the same way a crop on a photo is
   * outside the file it was exported to.
   */
  crop?: { x: number; y: number; w: number; h: number };
}

/** One drawn line. Points are normalised to the picture, 0-1. */
export interface VideoOverlayStroke {
  colour: string;
  points: { x: number; y: number }[];
}

/**
 * One thing sitting on a video: a word, an emoji, or a sticker.
 *
 * Deliberately the same fields the photo editor already keeps for the same
 * three things - normalised centre, pinch scale, rotation - so an item placed
 * on a video is placed by the identical gesture code, and the only difference
 * between the two paths is whether the result is painted into pixels or
 * written down.
 */
export interface VideoOverlayItem {
  kind: 'text' | 'emoji' | 'sticker';
  /** The words, the emoji, or the sticker's name for its alt text. */
  value: string;
  /** Stickers only. */
  url?: string;
  colour: string;
  /** Normalised centre over the video's own frame, 0-1. */
  x: number;
  y: number;
  scale: number;
  /** Radians, clockwise. */
  rotation: number;
}

export interface OutgoingMessage {
  conversationId: ConversationId;
  /** For a sticker this is its emoji or name - the text fallback. */
  body: string;
  replyToId?: MessageId;
  /** Makes this a sticker message rather than a text one. */
  sticker?: { id: string; url: string };
  /**
   * Makes this a **Ping**: a visual message, already flattened by the editor.
   *
   * The blob is uploaded by the service, not the caller, so a screen never
   * needs to know which bucket the media lives in or how its paths are shaped.
   *
   * ## `views` picks the mechanism, not just a number
   *
   * One or two views is an ephemeral Ping: the server hands out the bytes only
   * through `openPing`, and calling it is what spends the view. `null` is
   * *Keep in Chat*, which is an ordinary photo message - it stays in the thread
   * and can be reopened freely.
   *
   * They are two different storage behaviours because they are two different
   * promises, and the product already had both. Collapsing them into one
   * mechanism with a flag would mean the ephemeral path having a mode where it
   * never expires and never destroys anything.
   */
  ping?: { image: Blob; views: 1 | 2 | null };

  /**
   * Makes this a photo message. `body` carries the caption, if any.
   *
   * `viewLimit` absent means it stays in the chat and can be reopened freely;
   * a number makes it openable that many times per recipient. One control, one
   * concept - rather than a photo feature and a separate disappearing-photo
   * feature that behave differently for no reason a user could name.
   */
  photo?: { image: Blob; viewLimit?: number };
  /** Makes this a call-log entry. See `logCall`. */
  call?: {
    callKind: 'voice' | 'video';
    outcome: CallOutcome;
    durationSeconds: number;
    /** Absent on a group call - see `CallLogRef.calleeId`. */
    calleeId?: string;
    /** Set while a group call is live, so the thread can offer to join it. */
    callId?: string;
  };

  /**
   * Makes this a voice note.
   *
   * The waveform is computed by the recorder and travels with the message,
   * because deriving it at playback means fetching and decoding every note in
   * a thread to draw bars for one.
   */
  voice?: { audio: Blob; seconds: number; waveform: number[] };

  /** Makes this a document message. The service uploads and names it. */
  document?: { file: File };
  /**
   * Playback marks for a video, never burnt into the file.
   *
   * Trimming a video in a browser means re-encoding it, which costs exactly the
   * quality this path goes out of its way to keep - the bytes that leave the
   * phone are the bytes the camera wrote. So the file travels whole and the
   * edit rides beside it in `meta`, and every player applies it.
   *
   * Absent for a video nobody trimmed, which is most of them.
   */
  videoEdit?: VideoEdit;

  /**
   * The three structured kinds.
   *
   * None of them needs storage - each is a few fields - so they travel as the
   * shape the bubble will render rather than as bytes to be fetched later.
   */
  location?: { lat: number; lng: number; label?: string };
  contact?: { name: string; handle?: string; userId?: string };
  event?: { title: string; startsAt: number; location?: string };

  /**
   * Marks an ordinary message as a reply to a story.
   *
   * A story reply *is* a private message - the product has no story comments,
   * and inventing them would make a thing posted for a day into something with
   * a public thread attached. So this changes nothing about how the message is
   * sent or read; it records which story prompted it, which is what lets the
   * author's own insights count replies and lets the bubble say what it is
   * answering instead of arriving as a sentence with no subject.
   */
  storyReply?: { storyId: string };
}

/**
 * How far one person has read in one conversation.
 *
 * A watermark rather than a per-message flag: everything sent at or before
 * `readAt` has been seen by `userId`. One row per member is enough to draw
 * every tick in the thread, and it stays one row however much is said.
 */
export interface ReadReceipt {
  userId: UserId;
  /** Epoch ms. Everything at or before this has been read by them. */
  readAt: number;
}

/**
 * One person's answer for one particular message.
 *
 * `readAt` absent means they have not read it yet - which the message-info
 * screen shows as plainly as it shows the ones who have, because "still waiting
 * on Priya" is half of what anybody opens that screen to find out.
 */
export interface MessageReceipt {
  userId: UserId;
  readAt?: number;
}

/**
 * Events pushed from the service.
 *
 * Every event carries enough context for a reducer to apply it without a refetch.
 * This is what keeps phone and desktop consistent: both consume the same stream.
 */
/** What somebody is doing in a thread right now. */
export type ChatActivity = 'typing' | 'recording';

export type ChatEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'message:updated'; message: Message }
  /**
   * Gone from *this* reader's thread only - "delete for me". Deleting for
   * everyone is an update, not this, because the row survives as a tombstone.
   */
  | { type: 'message:removed'; messageId: MessageId }
  | { type: 'conversation:updated'; conversation: Conversation }
  /**
   * Gone from this member's list - deleted, or archived out of view.
   *
   * Not "the conversation ended": the membership survives and the row returns
   * when something newer arrives. The list is what changed, not the chat.
   */
  | { type: 'conversation:removed'; conversationId: ConversationId }
  /**
   * Somebody is typing, or holding the microphone.
   *
   * One event for both because they are the same fact with a different verb,
   * and a receiver showing "typing" while the sender records a voice note is
   * worse than showing nothing. Optional so an older emitter still compiles;
   * absent means typing.
   */
  | {
      type: 'typing:changed';
      conversationId: ConversationId;
      userIds: UserId[];
      activity?: ChatActivity;
    }
  /**
   * Somebody else's read cursor moved.
   *
   * The half of delivery that used to travel only on a page load. Without it a
   * second tick could not appear while you were watching the thread it belonged
   * to - you had to leave the conversation and come back to learn that the
   * person you were talking to had read you, which is the one moment a receipt
   * exists for.
   */
  | { type: 'receipts:changed'; conversationId: ConversationId; readers: ReadReceipt[] }
  | { type: 'presence:changed'; userId: UserId; presence: User['presence'] }
  | { type: 'notification:new'; notification: AppNotification }
  | { type: 'connection:changed'; state: ConnectionState };

export type ConnectionState = 'connecting' | 'connected' | 'offline';

/** Returned by `subscribe`; call it to stop listening. */
export type Unsubscribe = () => void;

/** What a cold launch can paint before the network answers. */
export interface StartupSnapshot {
  currentUser: CurrentUser;
  users: User[];
  conversations: Conversation[];
  /** When the snapshot was taken. The UI may want to say "as of…" one day. */
  at: number;
}

export interface ChatService {
  // -- Session -------------------------------------------------------------
  getCurrentUser(): Promise<CurrentUser>;
  updateSettings(settings: Partial<UserSettings>): Promise<CurrentUser>;

  // -- Conversations -------------------------------------------------------
  listConversations(): Promise<Conversation[]>;
  getConversation(id: ConversationId): Promise<Conversation | undefined>;
  /**
   * Newest-last, so the UI can append without re-sorting.
   * `before` pages backwards through history for older messages.
   */
  listMessages(
    conversationId: ConversationId,
    options?: { limit?: number; before?: MessageId },
  ): Promise<Message[]>;
  /**
   * The last page this device saw, straight from disk. Never touches the
   * network and resolves in about a millisecond.
   *
   * Separate from `listMessages` rather than folded into it, because the two
   * answer different questions: this one asks *what did I have*, and
   * `listMessages` asks *what is true*. A thread shows the first immediately
   * and corrects itself with the second, which is the difference between a
   * chat that opens and a chat that loads.
   *
   * Resolves `undefined` when nothing is cached - a first visit, a cleared
   * origin, or a device whose database key has been regenerated.
   */
  cachedMessages(conversationId: ConversationId): Promise<Message[] | undefined>;
  /**
   * Everything the first frame needs, straight from disk.
   *
   * The home screen cannot render from a conversation list alone - it needs to
   * know who you are and who the other participants are - so this returns the
   * three together or not at all. Splitting them would only allow a state
   * where two thirds of a screen can be drawn, which is not a screen.
   *
   * Resolves `undefined` on a device that has never completed a load.
   */
  cachedStartup(): Promise<StartupSnapshot | undefined>;
  /** Records the snapshot above after a successful network load. */
  cacheStartup(snapshot: StartupSnapshot): Promise<void>;

  /**
   * Rebuild the live connection, because the platform quietly broke it.
   *
   * A backgrounded mobile WebView has its socket closed by the OS, and it is
   * closed *without* the client being told - so the channel believes it is
   * subscribed, no reconnect is attempted, and messages simply stop arriving
   * until something else forces a load. Coming back to the foreground is the
   * one moment that is always worth spending a socket on.
   *
   * Idempotent and cheap: a channel that is genuinely alive is torn down and
   * remade in a few hundred milliseconds, which is a fair price for never
   * being silently offline.
   */
  reconnect(): void;

  // -- Sending -------------------------------------------------------------
  /** Resolves with the optimistic message; watch events for delivery status. */
  sendMessage(draft: OutgoingMessage): Promise<Message>;

  /**
   * Spends one view and returns a short-lived URL for the image.
   *
   * Calling this **is** the view - there is no separate "confirm" step, because
   * a client that could decline to confirm could watch a Ping forever. Returns
   * undefined once it is gone, which is the same answer for exhausted,
   * downloaded and expired.
   */
  openPing(messageId: MessageId): Promise<PingView | undefined>;

  /**
   * Mint a short-lived signed URL for a voice note storage path.
   *
   * Used on play when the page-load signed URL is missing or expired, so the
   * receiver always gets audible audio instead of a silent waveform.
   */
  signVoiceUrl?(path: string): Promise<string | undefined>;

  /**
   * Fetches the bytes so the receiver can keep them, then destroys the copy.
   *
   * The order matters: the blob is returned first and the server copy is only
   * dropped once it is in hand, so a failed save does not lose the Ping.
   *
   * Saving goes to the device, never to a PINGO server - that is the whole
   * point of the exchange, and it is why this destroys rather than archives.
   */
  savePing(messageId: MessageId): Promise<Blob | undefined>;

  /**
   * Spends one view of a limited photo and returns a URL for it.
   *
   * Unlimited photos never reach here - they carry their URL already. Returns
   * undefined once the reader has used their views up, which is the same answer
   * as "there was never anything to see".
   */
  openPhoto(messageId: MessageId): Promise<{ url: string; viewsLeft?: number } | undefined>;

  /**
   * "The whole video is stored on my device." Releases the server's copy.
   *
   * PINGO holds an uploaded video only until every recipient has a complete
   * copy of their own, so this is what lets it let go. It is a stronger claim
   * than delivered-or-read and must be sent only once the bytes are persisted
   * locally - a video that has merely been streamed has not been received.
   *
   * Optional: the in-memory mock has no storage to free.
   */
  confirmMediaReceived?(messageId: MessageId): Promise<void>;
  markConversationRead(conversationId: ConversationId): Promise<void>;

  /**
   * How far everyone *else* has read in this conversation.
   *
   * Excludes the caller: a receipt for your own reading is not a receipt. The
   * thread needs this on open, and gets every later change over
   * `receipts:changed` rather than by asking again.
   */
  listReceipts(conversationId: ConversationId): Promise<ReadReceipt[]>;

  /**
   * Who has read one particular message, and when they did.
   *
   * Distinct from `listReceipts` because a watermark cannot say *when* it
   * passed a given message - only that it has. This resolves the moment.
   */
  messageReceipts(messageId: MessageId): Promise<MessageReceipt[]>;

  // -- conversation management ---------------------------------------------

  /**
   * Sets any combination of a conversation's per-member flags.
   *
   * Takes a list rather than one id because multi-select is the normal case on
   * this screen - archiving eleven chats should be one round trip, not eleven,
   * and eleven separate calls would also mean eleven chances to half-succeed.
   *
   * Every flag here is private to the caller. Archiving does not move the chat
   * in anyone else's list, and there is deliberately no conversation-level
   * equivalent of any of them.
   */
  setConversationFlags(
    conversationIds: ConversationId[],
    flags: ConversationFlags,
  ): Promise<void>;

  /**
   * Hides the conversation and its history from this member only.
   *
   * Not a deletion in the database: the membership survives, so a later message
   * brings the chat back carrying only what arrived after. Removing the row
   * would drop you out of the conversation and make the next message create a
   * second one.
   */
  deleteConversations(conversationIds: ConversationId[]): Promise<void>;

  /** Empties the history but keeps the chat in the list. */
  clearConversations(conversationIds: ConversationId[]): Promise<void>;

  // -- custom lists ---------------------------------------------------------

  listChatLists(): Promise<ChatList[]>;
  createChatList(name: string): Promise<ChatList>;
  renameChatList(listId: string, name: string): Promise<void>;
  deleteChatList(listId: string): Promise<void>;
  /** One call for a whole selection, for the same reason as the flags above. */
  setChatListMembership(
    listId: string,
    conversationIds: ConversationId[],
    member: boolean,
  ): Promise<void>;
  setTyping(conversationId: ConversationId, typing: boolean): Promise<void>;

  /**
   * Announces that this user is holding the microphone.
   *
   * The same lifetime as typing — true for seconds, wrong forever after — so a
   * recorder that dies mid-note has its indicator swept rather than left up.
   */
  setRecording(conversationId: ConversationId, recording: boolean): Promise<void>;
  toggleReaction(messageId: MessageId, emoji: string): Promise<Message>;

  // -- message actions -----------------------------------------------------

  /** Within the edit window only; the server decides, not the caller. */
  editMessage(messageId: MessageId, body: string): Promise<void>;

  /**
   * `forEveryone` is a request, not an instruction - the server refuses it
   * outside the window or on someone else's message, and hides it for you
   * instead of failing.
   */
  deleteMessage(messageId: MessageId, forEveryone: boolean): Promise<void>;

  /** Per person. Returns the new state so the menu can label itself. */
  toggleStar(messageId: MessageId): Promise<boolean>;

  /** Per conversation - a pin is a statement to the room, not a private note. */
  togglePin(messageId: MessageId): Promise<boolean>;

  /** Stored; delivery needs a scheduler. See the migration. */
  remindAboutMessage(messageId: MessageId, at: number): Promise<void>;

  /** Write-only by design: a reporter cannot read reports back. */
  reportMessage(messageId: MessageId): Promise<void>;

  // -- People --------------------------------------------------------------
  getUser(id: UserId): Promise<User | undefined>;
  listContacts(): Promise<User[]>;

  /**
   * The conversation with this person, creating it only if there is not one.
   *
   * Idempotent, and that is the whole point: "message Anaya" must reach the
   * same thread every time, not make a second empty one beside the first. The
   * uniqueness check belongs in the database - two taps racing each other
   * cannot both win there, whereas a client-side "does one exist?" can.
   */
  startDirectConversation(otherUserId: UserId): Promise<ConversationId>;

  /**
   * Get-or-create the signed-in user's PINGO AI conversation.
   *
   * Same list and thread surfaces as any other chat. Not a separate AI product.
   */
  ensureAiConversation(): Promise<ConversationId>;

  // -- Groups ---------------------------------------------------------------
  //
  // Two doors, and the rule is the same one stated twice: *a friend may put you
  // in a group, or you may walk in yourself.* Being added needs a mutual follow,
  // because adding somebody reaches into their app without asking. A link needs
  // none, because following one is the invitee's own act.

  /**
   * Makes a group and returns it. The creator is its first admin.
   *
   * Rejects a member who is not a mutual follow - before anything is written,
   * so a refused member never leaves a half-made group behind.
   */
  createGroup(input: {
    title: string;
    memberIds: UserId[];
    avatarUrl?: string;
  }): Promise<ConversationId>;

  /** Admin only. Every id must be a mutual follow of the person adding. */
  addGroupMembers(conversationId: ConversationId, memberIds: UserId[]): Promise<void>;

  /** Admin only, and never yourself - leaving has its own door. */
  removeGroupMember(conversationId: ConversationId, userId: UserId): Promise<void>;

  /**
   * Leaves, handing the group on if you were the last admin.
   *
   * The alternative is a room nobody can rename, add to or remove from, ever
   * again - promotion needs an admin, and there would not be one.
   */
  leaveGroup(conversationId: ConversationId): Promise<void>;

  /**
   * Whether PINGO AI is in this group at all.
   *
   * Membership *is* the switch - the assistant answers because it is a member,
   * and a message is only sent in plaintext when it @mentions an assistant that
   * is in the room. So turning this off does not mute a listener: it removes
   * one, and every message in the group goes back to being sealed with no
   * exception for anybody.
   *
   * Admin-only, the same as adding members and the invite link. Whether there
   * is an assistant in the room is the room's decision.
   */
  setGroupAi(conversationId: ConversationId, enabled: boolean): Promise<void>;

  /** Admin only. `false` demotes, and is refused if you are the last admin. */
  setGroupAdmin(
    conversationId: ConversationId,
    userId: UserId,
    admin: boolean,
  ): Promise<void>;

  /**
   * Admin only. Updates name, face, cover and bio.
   *
   * Pass `avatarUrl` / `coverUrl` to set; pass `clearAvatar` / `clearCover` to
   * remove. Omit a field to leave it alone (except `title` and `description`,
   * which always write — use empty description to clear the bio).
   */
  updateGroup(
    conversationId: ConversationId,
    changes: {
      title: string;
      description?: string;
      avatarUrl?: string;
      coverUrl?: string;
      clearAvatar?: boolean;
      clearCover?: boolean;
    },
  ): Promise<void>;

  /**
   * Shared wallpaper for a group or community.
   *
   * Any member may set it - decoration, not a roster change. Direct chats do
   * not use this; their wallpaper is personal and stays on the device.
   *
   * `wallpaperId` is a preset id (`default`, `dawn`, …, `custom`). When it is
   * `custom`, `photoUrl` is required and must be a URL every member can load.
   */
  setGroupWallpaper(
    conversationId: ConversationId,
    wallpaperId: string,
    photoUrl?: string,
  ): Promise<void>;

  /**
   * How long a new message in this conversation lives. `undefined` is off.
   *
   * Any member of any kind of conversation may set it: a timer is a decision
   * about what is kept, and the person who needs one is rarely the one holding
   * the admin badge. Everybody is told, by a system notice naming who changed
   * it and to what.
   *
   * Never retroactive. It governs what is said next, so it cannot be used to
   * clear a history somebody else is part of.
   */
  setDisappearing(conversationId: ConversationId, seconds: number | undefined): Promise<void>;

  /**
   * The group's live invite code, minting one if there is not already one.
   *
   * Idempotent on purpose: opening the invite screen twice must not invalidate
   * the link somebody is already holding.
   */
  groupInviteCode(conversationId: ConversationId): Promise<string>;

  /** Admin only. Kills the live code; a new one can be minted afterwards. */
  revokeGroupInvite(conversationId: ConversationId): Promise<void>;

  /**
   * What a link shows before you commit to it: the name, the picture and how
   * many people are in it. Not the roster, and not a single message.
   */
  previewGroupInvite(code: string): Promise<
    | {
        conversationId: ConversationId;
        title: string;
        avatarUrl?: string;
        memberCount: number;
      }
    | undefined
  >;

  /** Joins by link. Returns the conversation, whether or not you were in it. */
  joinGroupWithCode(code: string): Promise<ConversationId>;

  // -- Calls, gallery, moments --------------------------------------------
  listCalls(): Promise<CallRecord[]>;

  /**
   * Records a call that has finished.
   *
   * Written by the caller's client only. The callee's copy arrives over the
   * same realtime stream every other message uses, so a declined call does not
   * need both ends to agree on who writes it.
   */
  logCall(entry: {
    conversationId: ConversationId;
    /** Absent on a group call, which has no single callee. */
    calleeId?: UserId;
    callKind: 'voice' | 'video';
    outcome: CallOutcome;
    durationSeconds: number;
    /** Set while a group call is live, so the thread can offer to join it. */
    callId?: string;
  }): Promise<Message>;

  /**
   * Turns a live group-call entry into history.
   *
   * The same message, edited rather than replaced: a second row would put two
   * calls in the thread for one, and the first would go on offering to join a
   * room that emptied an hour ago.
   */
  endCallLog(
    messageId: MessageId,
    entry: { outcome: CallOutcome; durationSeconds: number },
  ): Promise<void>;
  listGallery(userId: UserId): Promise<GalleryItem[]>;
  listMoments(): Promise<Moment[]>;

  // -- Notifications -------------------------------------------------------
  listNotifications(): Promise<AppNotification[]>;
  markNotificationRead(id: string): Promise<void>;

  /** Unread count for the badge. One number, not a list to be counted. */
  unreadNotifications(): Promise<number>;

  /** Marks the whole feed read - one statement, not a write per row. */
  markAllNotificationsRead(): Promise<void>;

  // -- Search --------------------------------------------------------------
  search(query: string): Promise<SearchResult[]>;

  // -- Live ----------------------------------------------------------------
  subscribe(listener: (event: ChatEvent) => void): Unsubscribe;
  connectionState(): ConnectionState;
}
