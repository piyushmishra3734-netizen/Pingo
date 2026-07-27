/**
 * MockChatService — an in-memory ChatService.
 *
 * This is not a stub that returns fixtures. It models the *behaviour* a real
 * backend has, because that behaviour is what the UI has to be correct against:
 *
 *   - Latency on every read, so loading states are real and get designed.
 *   - Optimistic sends that transition sending → sent → delivered → read.
 *   - Typing indicators that arrive and clear on their own.
 *   - A push event stream, so components never poll.
 *
 * When `SocketChatService` lands it implements the same interface and the app
 * changes in exactly one place: the provider at the composition root.
 */

import type {
  ChatEvent,
  ChatService,
  ConnectionState,
  OutgoingMessage,
  Unsubscribe,
} from './chat-service.js';
import {
  calls,
  conversations as seedConversations,
  currentUser as seedCurrentUser,
  galleryByUser,
  messagesByConversation as seedMessages,
  moments,
  notifications as seedNotifications,
  users as seedUsers,
} from './seed.js';
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
  User,
  UserId,
  UserSettings,
} from './types.js';

/** Simulated round-trip. Long enough that skeletons matter, short enough to work in. */
const READ_LATENCY_MS = 220;

/** Delivery pipeline timings for an outgoing message. */
const ACK_MS = 260;
const DELIVERED_MS = 700;
const READ_MS = 2_400;

/** How long a simulated typing indicator stays up before clearing itself. */
const TYPING_WINDOW_MS = 3_200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

let messageCounter = 0;
function nextMessageId(): MessageId {
  messageCounter += 1;
  return `m-local-${Date.now().toString(36)}-${messageCounter}`;
}

export interface MockChatServiceOptions {
  /**
   * Whether to start with the demo conversations.
   *
   * `false` gives a genuinely empty account, which is what a real person sees
   * the moment they finish signing up. That state has its own design — Home's
   * welcome ([docs/01 § 10](../../../docs/01-onboarding-auth.md)) — and it is
   * unreachable while the mock hands every new user four seeded threads with
   * strangers in them.
   *
   * Defaults to seeded, because the styleguide and every screenshot of the
   * product depend on there being conversations to look at.
   */
  seeded?: boolean;
}

export class MockChatService implements ChatService {
  /** Mutable working copies, so a session's sends and reads persist in memory. */
  #currentUser: CurrentUser = clone(seedCurrentUser);
  #users: User[] = clone(seedUsers);
  #conversations: Conversation[];
  #messages: Record<string, Message[]>;
  #notifications: AppNotification[] = clone(seedNotifications);

  #listeners = new Set<(event: ChatEvent) => void>();
  #connection: ConnectionState = 'connecting';
  /** Tracked so `dispose` can clear anything still pending. */
  #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor({ seeded = true }: MockChatServiceOptions = {}) {
    this.#conversations = seeded ? clone(seedConversations) : [];
    this.#messages = seeded ? clone(seedMessages) : {};

    // Mirror a real client: briefly connecting, then connected.
    this.#after(400, () => {
      this.#connection = 'connected';
      this.#emit({ type: 'connection:changed', state: 'connected' });
    });
  }

  // -- internals -----------------------------------------------------------

  #emit(event: ChatEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  /** setTimeout that registers itself for cleanup. */
  #after(ms: number, fn: () => void): void {
    const id = setTimeout(() => {
      this.#timers.delete(id);
      fn();
    }, ms);
    this.#timers.add(id);
  }

  #conversation(id: ConversationId): Conversation | undefined {
    return this.#conversations.find((c) => c.id === id);
  }

  /** Applies a patch, keeps the list sorted, and notifies subscribers. */
  #updateConversation(id: ConversationId, patch: Partial<Conversation>): void {
    const conversation = this.#conversation(id);
    if (!conversation) return;
    Object.assign(conversation, patch);
    this.#sortConversations();
    this.#emit({ type: 'conversation:updated', conversation: clone(conversation) });
  }

  /** Pinned first, then most recent. Matches the home screen's ordering. */
  #sortConversations(): void {
    this.#conversations.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  #findMessage(id: MessageId): Message | undefined {
    for (const thread of Object.values(this.#messages)) {
      const found = thread.find((m) => m.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /** Walks an outgoing message through the delivery states a server would report. */
  #simulateDelivery(message: Message): void {
    const advance = (status: Message['status'], at: number) =>
      this.#after(at, () => {
        const live = this.#findMessage(message.id);
        if (!live) return;
        live.status = status;
        this.#emit({ type: 'message:updated', message: clone(live) });

        // The denormalised copy on the conversation has to move in step.
        const conversation = this.#conversation(live.conversationId);
        if (conversation?.lastMessage?.id === live.id) {
          conversation.lastMessage = clone(live);
          this.#emit({ type: 'conversation:updated', conversation: clone(conversation) });
        }
      });

    advance('sent', ACK_MS);
    advance('delivered', DELIVERED_MS);
    advance('read', READ_MS);
  }

  /**
   * After you send into a direct chat, show the other person typing briefly.
   * This exists so the typing dots are exercisable in the running app; it does
   * not fabricate a reply, because inventing messages would misrepresent state.
   */
  #simulateTypingResponse(conversationId: ConversationId): void {
    const conversation = this.#conversation(conversationId);
    if (!conversation || conversation.kind !== 'direct') return;

    const other = conversation.participantIds.find((id) => id !== this.#currentUser.id);
    if (!other) return;

    const partner = this.#users.find((u) => u.id === other);
    if (partner?.presence.state !== 'online') return;

    this.#after(900, () => {
      this.#updateConversation(conversationId, { typingUserIds: [other] });
      this.#emit({ type: 'typing:changed', conversationId, userIds: [other] });

      this.#after(TYPING_WINDOW_MS, () => {
        this.#updateConversation(conversationId, { typingUserIds: [] });
        this.#emit({ type: 'typing:changed', conversationId, userIds: [] });
      });
    });
  }

  // -- session -------------------------------------------------------------

  async getCurrentUser(): Promise<CurrentUser> {
    await delay(READ_LATENCY_MS);
    return clone(this.#currentUser);
  }

  async updateSettings(settings: Partial<UserSettings>): Promise<CurrentUser> {
    // Merge one level deep so callers can patch a single nested flag.
    this.#currentUser.settings = {
      ...this.#currentUser.settings,
      ...settings,
      notifications: {
        ...this.#currentUser.settings.notifications,
        ...(settings.notifications ?? {}),
      },
      privacy: {
        ...this.#currentUser.settings.privacy,
        ...(settings.privacy ?? {}),
      },
    };
    await delay(120);
    return clone(this.#currentUser);
  }

  // -- conversations -------------------------------------------------------

  async listConversations(): Promise<Conversation[]> {
    await delay(READ_LATENCY_MS);
    this.#sortConversations();
    return clone(this.#conversations);
  }

  async getConversation(id: ConversationId): Promise<Conversation | undefined> {
    await delay(120);
    const found = this.#conversation(id);
    return found ? clone(found) : undefined;
  }

  async listMessages(
    conversationId: ConversationId,
    options?: { limit?: number; before?: MessageId },
  ): Promise<Message[]> {
    await delay(READ_LATENCY_MS);
    const thread = this.#messages[conversationId] ?? [];

    // Page backwards from `before`, keeping newest-last ordering in the result.
    const end = options?.before
      ? Math.max(0, thread.findIndex((m) => m.id === options.before))
      : thread.length;
    const limit = options?.limit ?? 50;
    return clone(thread.slice(Math.max(0, end - limit), end));
  }

  // -- sending -------------------------------------------------------------

  async sendMessage(draft: OutgoingMessage): Promise<Message> {
    const message: Message = {
      id: nextMessageId(),
      conversationId: draft.conversationId,
      authorId: this.#currentUser.id,
      body: draft.body,
      createdAt: Date.now(),
      status: 'sending',
      attachments: [],
      reactions: [],
      ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
    };

    (this.#messages[draft.conversationId] ??= []).push(message);

    // Emit before returning: the UI's event handler is the single code path that
    // adds messages to the view, whether they are ours or someone else's.
    this.#emit({ type: 'message:new', message: clone(message) });
    this.#updateConversation(draft.conversationId, {
      lastMessage: clone(message),
      updatedAt: message.createdAt,
    });

    this.#simulateDelivery(message);
    this.#simulateTypingResponse(draft.conversationId);

    return clone(message);
  }

  /*
   * Pings are not simulated. The whole point of the feature is a server that
   * forgets on a schedule, and there is no honest way to fake that in memory —
   * a mock that always returned an image would make the view limit look broken,
   * and one that never did would make every Ping look expired.
   */
  async openPing(): Promise<undefined> {
    return undefined;
  }

  async savePing(): Promise<undefined> {
    return undefined;
  }

  /**
   * Photos in the mock carry their URL already, so nothing has to be spent to
   * see one. Returning undefined would make every limited photo look exhausted
   * in the styleguide, which is a worse lie than having no limit at all.
   */
  async openPhoto(messageId: MessageId): Promise<{ url: string } | undefined> {
    const url = this.#findMessage(messageId)?.photo?.url;
    return url ? { url } : undefined;
  }

  async markConversationRead(conversationId: ConversationId): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (!conversation || conversation.unreadCount === 0) return;
    this.#updateConversation(conversationId, { unreadCount: 0 });
  }

  // -- conversation management ----------------------------------------------

  /*
   * In memory, and shaped exactly like the real thing — including the parts
   * that are easy to get wrong, such as archiving un-pinning and marking read
   * clearing the count. A mock that skips those lets a screen look correct here
   * and be wrong against Supabase.
   */
  async setConversationFlags(
    conversationIds: ConversationId[],
    flags: ConversationFlags,
  ): Promise<void> {
    for (const id of conversationIds) {
      const patch: Partial<Conversation> = {};
      if (flags.pinned !== undefined) patch.pinned = flags.pinned;
      if (flags.mutedUntil !== undefined) {
        // Same derivation the SQL does, so a mute that has already lapsed reads
        // as unmuted here too rather than only against Supabase.
        patch.muted = flags.mutedUntil !== null && flags.mutedUntil > Date.now();
        if (flags.mutedUntil !== null) patch.mutedUntil = flags.mutedUntil;
        else delete patch.mutedUntil;
      }
      if (flags.favorite !== undefined) patch.favorite = flags.favorite;
      if (flags.archived !== undefined) {
        patch.archived = flags.archived;
        if (flags.archived) patch.pinned = false;
      }
      if (flags.unread !== undefined) {
        patch.unreadCount = flags.unread
          ? Math.max(this.#conversation(id)?.unreadCount ?? 0, 1)
          : 0;
      }
      this.#updateConversation(id, patch);
    }
  }

  async deleteConversations(conversationIds: ConversationId[]): Promise<void> {
    for (const id of conversationIds) {
      this.#messages[id] = [];
      this.#conversations = this.#conversations.filter((c) => c.id !== id);
      this.#emit({ type: 'conversation:removed', conversationId: id });
    }
  }

  async clearConversations(conversationIds: ConversationId[]): Promise<void> {
    for (const id of conversationIds) {
      this.#messages[id] = [];
      const conversation = this.#conversation(id);
      if (conversation) {
        // `lastMessage` is deleted rather than set undefined so the shape stays
        // "absent means none", which is what the list renders against.
        const next = { ...conversation, unreadCount: 0 };
        delete next.lastMessage;
        this.#conversations = this.#conversations.map((c) => (c.id === id ? next : c));
        this.#emit({ type: 'conversation:updated', conversation: clone(next) });
      }
    }
  }

  #lists: ChatList[] = [];
  #listMembers = new Map<string, Set<ConversationId>>();

  async listChatLists(): Promise<ChatList[]> {
    return this.#lists.map((list) => ({
      ...list,
      count: this.#listMembers.get(list.id)?.size ?? 0,
    }));
  }

  async createChatList(name: string): Promise<ChatList> {
    const list: ChatList = { id: `list-${this.#lists.length + 1}`, name: name.trim(), count: 0 };
    this.#lists.push(list);
    return list;
  }

  async renameChatList(listId: string, name: string): Promise<void> {
    this.#lists = this.#lists.map((l) => (l.id === listId ? { ...l, name: name.trim() } : l));
  }

  async deleteChatList(listId: string): Promise<void> {
    this.#lists = this.#lists.filter((l) => l.id !== listId);
    this.#listMembers.delete(listId);
    for (const conversation of this.#conversations) {
      if (conversation.listIds.includes(listId)) {
        this.#updateConversation(conversation.id, {
          listIds: conversation.listIds.filter((id) => id !== listId),
        });
      }
    }
  }

  async setChatListMembership(
    listId: string,
    conversationIds: ConversationId[],
    member: boolean,
  ): Promise<void> {
    const set = this.#listMembers.get(listId) ?? new Set<ConversationId>();
    for (const id of conversationIds) {
      if (member) set.add(id);
      else set.delete(id);

      const conversation = this.#conversation(id);
      if (!conversation) continue;
      const without = conversation.listIds.filter((l) => l !== listId);
      this.#updateConversation(id, {
        listIds: member ? [...without, listId] : without,
      });
    }
    this.#listMembers.set(listId, set);
  }

  async setTyping(conversationId: ConversationId, typing: boolean): Promise<void> {
    // A real service broadcasts to other participants; locally this is a no-op
    // beyond confirming the conversation exists.
    void conversationId;
    void typing;
  }

  async toggleReaction(messageId: MessageId, emoji: string): Promise<Message> {
    const message = this.#findMessage(messageId);
    if (!message) throw new Error(`No such message: ${messageId}`);

    const me = this.#currentUser.id;
    const existing = message.reactions.find((r) => r.emoji === emoji);

    if (!existing) {
      message.reactions.push({ emoji, userIds: [me] });
    } else if (existing.userIds.includes(me)) {
      existing.userIds = existing.userIds.filter((id) => id !== me);
      if (existing.userIds.length === 0) {
        message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
      }
    } else {
      existing.userIds.push(me);
    }

    this.#emit({ type: 'message:updated', message: clone(message) });
    return clone(message);
  }

  // -- people --------------------------------------------------------------

  async getUser(id: UserId): Promise<User | undefined> {
    await delay(80);
    if (id === this.#currentUser.id) return clone(this.#currentUser);
    const found = this.#users.find((u) => u.id === id);
    return found ? clone(found) : undefined;
  }

  async listContacts(): Promise<User[]> {
    await delay(READ_LATENCY_MS);
    return clone(this.#users);
  }

  /**
   * Finds the existing direct thread, or makes one in memory.
   *
   * The same idempotence the real service gets from a unique index, done here
   * by search — so the styleguide behaves like the app rather than piling up a
   * new empty conversation on every tap.
   */
  async startDirectConversation(otherUserId: UserId): Promise<ConversationId> {
    await delay(READ_LATENCY_MS);

    const existing = this.#conversations.find(
      (conversation) =>
        conversation.kind === 'direct' &&
        conversation.participantIds.includes(otherUserId) &&
        conversation.participantIds.includes(this.#currentUser.id),
    );
    if (existing) return existing.id;

    const other = this.#users.find((user) => user.id === otherUserId);
    const conversation: Conversation = {
      id: `conversation-${otherUserId}`,
      kind: 'direct',
      title: other?.name ?? 'New chat',
      participantIds: [this.#currentUser.id, otherUserId],
      unreadCount: 0,
      updatedAt: Date.now(),
      typingUserIds: [],
      muted: false,
      pinned: false,
      favorite: false,
      archived: false,
      listIds: [],
    };

    this.#conversations = [conversation, ...this.#conversations];
    this.#messages[conversation.id] = [];
    this.#emit({ type: 'conversation:updated', conversation: clone(conversation) });

    return conversation.id;
  }

  // -- calls, gallery, moments --------------------------------------------

  async listCalls(): Promise<CallRecord[]> {
    await delay(READ_LATENCY_MS);
    return [...this.#loggedCalls, ...clone(calls)];
  }

  /** Calls placed during this session, newest first, ahead of the fixtures. */
  #loggedCalls: CallRecord[] = [];

  async logCall(entry: {
    conversationId: ConversationId;
    calleeId: UserId;
    callKind: 'voice' | 'video';
    outcome: CallOutcome;
    durationSeconds: number;
  }): Promise<void> {
    this.#loggedCalls.unshift({
      id: `call-${this.#loggedCalls.length + 1}`,
      kind: entry.callKind,
      // The mock only ever places calls, never receives them.
      direction: 'outgoing',
      outcome: entry.outcome,
      withUserId: entry.calleeId,
      conversationId: entry.conversationId,
      startedAt: Date.now(),
      duration: entry.durationSeconds,
    });
  }

  async listGallery(userId: UserId): Promise<GalleryItem[]> {
    await delay(READ_LATENCY_MS);
    return clone(galleryByUser[userId] ?? []);
  }

  async listMoments(): Promise<Moment[]> {
    await delay(READ_LATENCY_MS);
    return clone(moments);
  }

  // -- notifications -------------------------------------------------------

  async listNotifications(): Promise<AppNotification[]> {
    await delay(READ_LATENCY_MS);
    return clone(this.#notifications);
  }

  async markNotificationRead(id: string): Promise<void> {
    const notification = this.#notifications.find((n) => n.id === id);
    if (notification) notification.read = true;
  }

  /*
   * The mock keeps these in memory so the styleguide behaves. Ownership is the
   * only rule either one has, and it lives in the database where it cannot be
   * talked out of — there is no time limit on editing or deleting.
   */
  async editMessage(messageId: MessageId, body: string): Promise<void> {
    const message = this.#findMessage(messageId);
    if (!message) return;
    message.body = body;
    message.editedAt = Date.now();
    this.#emit({ type: 'message:updated', message: clone(message) });
  }

  /*
   * The two deletes are genuinely different outcomes, so the mock keeps them
   * different too — a mock that collapses them would let a screen look correct
   * here and be wrong against Supabase.
   */
  async deleteMessage(messageId: MessageId, forEveryone = false): Promise<void> {
    if (!forEveryone) {
      for (const [id, thread] of Object.entries(this.#messages)) {
        this.#messages[id] = thread.filter((m) => m.id !== messageId);
      }
      this.#emit({ type: 'message:removed', messageId });
      return;
    }

    const message = this.#findMessage(messageId);
    if (!message) return;
    message.body = '';
    message.deleted = true;
    message.deletedAt = Date.now();
    this.#emit({ type: 'message:updated', message: clone(message) });
  }

  #starred = new Set<MessageId>();
  #pinned = new Set<MessageId>();

  async toggleStar(messageId: MessageId): Promise<boolean> {
    if (this.#starred.has(messageId)) { this.#starred.delete(messageId); return false; }
    this.#starred.add(messageId);
    return true;
  }

  async togglePin(messageId: MessageId): Promise<boolean> {
    if (this.#pinned.has(messageId)) { this.#pinned.delete(messageId); return false; }
    this.#pinned.add(messageId);
    return true;
  }

  async remindAboutMessage(): Promise<void> {
    return;
  }

  async reportMessage(): Promise<void> {
    return;
  }

  async unreadNotifications(): Promise<number> {
    return this.#notifications.filter((n) => !n.read).length;
  }

  async markAllNotificationsRead(): Promise<void> {
    for (const n of this.#notifications) n.read = true;
  }

  // -- search --------------------------------------------------------------

  async search(query: string): Promise<SearchResult[]> {
    await delay(140);
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const results: SearchResult[] = [];

    for (const conversation of this.#conversations) {
      if (conversation.title.toLowerCase().includes(q)) {
        results.push({ kind: 'conversation', conversation: clone(conversation) });
      }
    }

    for (const user of this.#users) {
      if (
        user.name.toLowerCase().includes(q) ||
        user.handle.toLowerCase().includes(q)
      ) {
        results.push({ kind: 'user', user: clone(user) });
      }
    }

    for (const [conversationId, thread] of Object.entries(this.#messages)) {
      const conversation = this.#conversation(conversationId);
      if (!conversation) continue;
      for (const message of thread) {
        if (message.body.toLowerCase().includes(q)) {
          results.push({
            kind: 'message',
            message: clone(message),
            conversation: clone(conversation),
          });
        }
      }
    }

    return results;
  }

  // -- live ----------------------------------------------------------------

  subscribe(listener: (event: ChatEvent) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  connectionState(): ConnectionState {
    return this.#connection;
  }

  /** Clears pending timers and listeners. Called when the provider unmounts. */
  dispose(): void {
    for (const id of this.#timers) clearTimeout(id);
    this.#timers.clear();
    this.#listeners.clear();
  }
}
