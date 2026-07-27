/**
 * The ChatService boundary.
 *
 * Everything the UI needs from a backend goes through this interface. Nothing in
 * apps/web imports a concrete implementation except one line at the composition
 * root — which is what makes swapping `MockChatService` for a real socket
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
  SnapView,
  User,
  UserId,
  UserSettings,
} from './types.js';

/** A draft outgoing message, before the service assigns it an id and timestamp. */
export interface OutgoingMessage {
  conversationId: ConversationId;
  /** For a sticker this is its emoji or name — the text fallback. */
  body: string;
  replyToId?: MessageId;
  /** Makes this a sticker message rather than a text one. */
  sticker?: { id: string; url: string };
  /**
   * Makes this a snap: a photo taken in the camera, already flattened.
   *
   * The blob is uploaded by the service, not the caller, so a screen never
   * needs to know which bucket snaps live in or how their paths are shaped.
   */
  snap?: { image: Blob };

  /**
   * Makes this a photo message. `body` carries the caption, if any.
   *
   * `viewLimit` absent means it stays in the chat and can be reopened freely;
   * a number makes it openable that many times per recipient. One control, one
   * concept — rather than a photo feature and a separate disappearing-photo
   * feature that behave differently for no reason a user could name.
   */
  photo?: { image: Blob; viewLimit?: number };
}

/**
 * Events pushed from the service.
 *
 * Every event carries enough context for a reducer to apply it without a refetch.
 * This is what keeps phone and desktop consistent: both consume the same stream.
 */
export type ChatEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'message:updated'; message: Message }
  /**
   * Gone from *this* reader's thread only — "delete for me". Deleting for
   * everyone is an update, not this, because the row survives as a tombstone.
   */
  | { type: 'message:removed'; messageId: MessageId }
  | { type: 'conversation:updated'; conversation: Conversation }
  /**
   * Gone from this member's list — deleted, or archived out of view.
   *
   * Not "the conversation ended": the membership survives and the row returns
   * when something newer arrives. The list is what changed, not the chat.
   */
  | { type: 'conversation:removed'; conversationId: ConversationId }
  | { type: 'typing:changed'; conversationId: ConversationId; userIds: UserId[] }
  | { type: 'presence:changed'; userId: UserId; presence: User['presence'] }
  | { type: 'notification:new'; notification: AppNotification }
  | { type: 'connection:changed'; state: ConnectionState };

export type ConnectionState = 'connecting' | 'connected' | 'offline';

/** Returned by `subscribe`; call it to stop listening. */
export type Unsubscribe = () => void;

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

  // -- Sending -------------------------------------------------------------
  /** Resolves with the optimistic message; watch events for delivery status. */
  sendMessage(draft: OutgoingMessage): Promise<Message>;

  /**
   * Spends one view and returns a short-lived URL for the image.
   *
   * Calling this **is** the view — there is no separate "confirm" step, because
   * a client that could decline to confirm could watch a snap forever. Returns
   * undefined once the snap is gone, which is the same answer for exhausted,
   * downloaded and expired.
   */
  openSnap(messageId: MessageId): Promise<SnapView | undefined>;

  /**
   * Fetches the bytes so the receiver can keep them, then destroys the copy.
   *
   * The order matters: the blob is returned first and the server copy is only
   * dropped once it is in hand, so a failed download does not lose the snap.
   */
  downloadSnap(messageId: MessageId): Promise<Blob | undefined>;

  /**
   * Spends one view of a limited photo and returns a URL for it.
   *
   * Unlimited photos never reach here — they carry their URL already. Returns
   * undefined once the reader has used their views up, which is the same answer
   * as "there was never anything to see".
   */
  openPhoto(messageId: MessageId): Promise<{ url: string; viewsLeft?: number } | undefined>;
  markConversationRead(conversationId: ConversationId): Promise<void>;

  // -- conversation management ---------------------------------------------

  /**
   * Sets any combination of a conversation's per-member flags.
   *
   * Takes a list rather than one id because multi-select is the normal case on
   * this screen — archiving eleven chats should be one round trip, not eleven,
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
  toggleReaction(messageId: MessageId, emoji: string): Promise<Message>;

  // -- message actions -----------------------------------------------------

  /** Within the edit window only; the server decides, not the caller. */
  editMessage(messageId: MessageId, body: string): Promise<void>;

  /**
   * `forEveryone` is a request, not an instruction — the server refuses it
   * outside the window or on someone else's message, and hides it for you
   * instead of failing.
   */
  deleteMessage(messageId: MessageId, forEveryone: boolean): Promise<void>;

  /** Per person. Returns the new state so the menu can label itself. */
  toggleStar(messageId: MessageId): Promise<boolean>;

  /** Per conversation — a pin is a statement to the room, not a private note. */
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
   * uniqueness check belongs in the database — two taps racing each other
   * cannot both win there, whereas a client-side "does one exist?" can.
   */
  startDirectConversation(otherUserId: UserId): Promise<ConversationId>;

  // -- Calls, gallery, moments --------------------------------------------
  listCalls(): Promise<CallRecord[]>;
  listGallery(userId: UserId): Promise<GalleryItem[]>;
  listMoments(): Promise<Moment[]>;

  // -- Notifications -------------------------------------------------------
  listNotifications(): Promise<AppNotification[]>;
  markNotificationRead(id: string): Promise<void>;

  /** Unread count for the badge. One number, not a list to be counted. */
  unreadNotifications(): Promise<number>;

  /** Marks the whole feed read — one statement, not a write per row. */
  markAllNotificationsRead(): Promise<void>;

  // -- Search --------------------------------------------------------------
  search(query: string): Promise<SearchResult[]>;

  // -- Live ----------------------------------------------------------------
  subscribe(listener: (event: ChatEvent) => void): Unsubscribe;
  connectionState(): ConnectionState;
}
