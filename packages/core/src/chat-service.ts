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
  Conversation,
  ConversationId,
  CurrentUser,
  GalleryItem,
  Message,
  MessageId,
  Moment,
  SearchResult,
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
  | { type: 'conversation:updated'; conversation: Conversation }
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
  markConversationRead(conversationId: ConversationId): Promise<void>;
  setTyping(conversationId: ConversationId, typing: boolean): Promise<void>;
  toggleReaction(messageId: MessageId, emoji: string): Promise<Message>;

  // -- People --------------------------------------------------------------
  getUser(id: UserId): Promise<User | undefined>;
  listContacts(): Promise<User[]>;

  // -- Calls, gallery, moments --------------------------------------------
  listCalls(): Promise<CallRecord[]>;
  listGallery(userId: UserId): Promise<GalleryItem[]>;
  listMoments(): Promise<Moment[]>;

  // -- Notifications -------------------------------------------------------
  listNotifications(): Promise<AppNotification[]>;
  markNotificationRead(id: string): Promise<void>;

  // -- Search --------------------------------------------------------------
  search(query: string): Promise<SearchResult[]>;

  // -- Live ----------------------------------------------------------------
  subscribe(listener: (event: ChatEvent) => void): Unsubscribe;
  connectionState(): ConnectionState;
}
