/**
 * `ChatService`, implemented on Supabase.
 *
 * Reads and writes `conversations`, `conversation_members` and `messages` from
 * `supabase/migrations/20260725200000_messaging.sql`, and receives new messages
 * over Realtime. Like the other two services, this is the only file that knows
 * Supabase is behind the boundary.
 *
 * ## What is real, and what is not yet
 *
 * `ChatService` was designed against the whole product, so it has methods for
 * surfaces that have no schema behind them. Rather than pretend, each of those
 * returns empty and says so at its definition:
 *
 * | Area | State |
 * | --- | --- |
 * | Conversations, messages, sending, unread, realtime | **Real** |
 * | Contacts, user lookup, search | **Real**, from `profiles` |
 * | Presence | Not built — everyone reads as offline |
 * | Reactions, typing | Not persisted — no-ops, see below |
 * | Calls, gallery, moments, notifications | Empty — no tables yet |
 * | Settings | In memory for the session only |
 *
 * A no-op that silently claims success is the kind of thing that gets
 * discovered a month later, so each one is marked and none of them lie about
 * having stored anything.
 */

import type {
  AppNotification,
  CallRecord,
  ChatEvent,
  ChatService,
  ConnectionState,
  Conversation,
  ConversationId,
  CurrentUser,
  GalleryItem,
  Message,
  MessageId,
  Moment,
  OutgoingMessage,
  SearchResult,
  SnapView,
  Unsubscribe,
  User,
  UserId,
  UserSettings,
} from '@pingo/core';

import { getSupabaseClient, type PingoSupabaseClient } from './client.js';
import { PresenceHub } from './presence.js';
import type { ConversationRow, MessageRow, ProfileRow } from './types.js';

/** Until a settings table exists, these are what every session starts from. */
const DEFAULT_SETTINGS: UserSettings = {
  appearance: 'system',
  notifications: {
    messages: true,
    calls: true,
    mentions: true,
    quietHours: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  },
  privacy: {
    presenceVisibility: 'everyone',
    readReceipts: true,
    typingIndicators: true,
    lastSeen: true,
  },
  reducedMotion: false,
};

function toUser(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.display_name,
    handle: row.username,
    avatarUrl: row.avatar_url ?? undefined,
    /*
     * No presence system yet. Everyone reads as offline rather than as a
     * plausible-looking "online", because a green dot that means nothing is
     * worse than no dot at all.
     */
    presence: { state: 'offline', lastSeenAt: Date.parse(row.created_at) },
  };
}

function toMessage(row: MessageRow, readAt: number | undefined): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.sender_id,
    body: row.body,
    createdAt: Date.parse(row.created_at),
    /*
     * `sent` is the honest ceiling. Delivery and read receipts need per-recipient
     * tracking this schema does not have, so claiming `delivered` would be
     * inventing a fact — except for the one case we *can* prove: the recipient's
     * own read cursor has passed it.
     */
    status: readAt !== undefined && Date.parse(row.created_at) <= readAt ? 'read' : 'sent',
    attachments: [],
    reactions: [],
    ...(row.edited_at ? { editedAt: Date.parse(row.edited_at) } : {}),
    // `media_url` is the sticker's image; `body` stays its emoji, so a client
    // that cannot render one still shows something meaningful.
    ...(row.kind === 'sticker' && row.media_url
      ? { sticker: { id: row.id, url: row.media_url } }
      : {}),
    /*
     * A snap carries no URL — see `SnapRef`. `gone` folds together exhausted,
     * downloaded and expired, because the thread should not tell you which.
     */
    ...(row.kind === 'snap'
      ? {
          snap: {
            expiresAt: row.snap_expires_at ? Date.parse(row.snap_expires_at) : 0,
            gone:
              row.snap_path === null ||
              row.snap_consumed_at !== null ||
              (row.snap_expires_at !== null && Date.parse(row.snap_expires_at) < Date.now()),
          },
        }
      : {}),
  };
}

/** Snaps live in a private bucket; the `snaps` migration explains why. */
const SNAP_BUCKET = 'snaps';

/**
 * A minute. The URL only has to outlive the fetch that immediately follows it;
 * anything longer is a window where a shared link outlives the snap.
 */
const SNAP_URL_TTL_SECONDS = 60;

/**
 * How long an unopened snap survives on the server.
 *
 * 24 hours, matching how long a story lasts. The server enforces this in
 * `open_snap` regardless of whether the cleanup job has run, so an expired snap
 * is unreadable the moment it expires even if its bytes linger a few minutes.
 */
const SNAP_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** What each kind says. Titles come from the actor's live name, not the row. */
const NOTIFICATION_COPY: Record<string, { body: string }> = {
  follow_request: { body: 'wants to follow you' },
  follow_accepted: { body: 'accepted your follow request' },
  message: { body: 'sent you a message' },
  snap: { body: 'sent you a snap' },
  story: { body: 'posted a story' },
};

export class SupabaseChatService implements ChatService {
  readonly #client: PingoSupabaseClient;

  #listeners = new Set<(event: ChatEvent) => void>();
  #connection: ConnectionState = 'connecting';
  #settings: UserSettings = { ...DEFAULT_SETTINGS };
  #channel: ReturnType<PingoSupabaseClient['channel']> | undefined;

  /** Cached so message mapping and conversation titles do not refetch people. */
  #people = new Map<UserId, User>();

  #authWatcher: { unsubscribe: () => void } | undefined;

  /**
   * Presence and typing, both over Realtime rather than the database.
   *
   * A row saying "online" outlives the tab that wrote it; a socket does not.
   * See  for why neither is persisted.
   */
  #presenceHub: PresenceHub;

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.#client = client;

    this.#presenceHub = new PresenceHub(client, {
      onPresence: (userId, state) => {
        const cached = this.#people.get(userId);
        const presence = { state, lastSeenAt: Date.now() };
        if (cached) this.#people.set(userId, { ...cached, presence });
        this.#emit({ type: 'presence:changed', userId, presence });
      },
      onTyping: (conversationId, userIds) => {
        this.#emit({ type: 'typing:changed', conversationId, userIds });
      },
    });

    /*
     * The channel is (re)opened when a session exists, never in the constructor.
     *
     * Realtime enforces RLS on its own stream, which means the socket has to
     * carry the user's JWT. This service is constructed at app mount — before
     * auth has resolved — so a channel opened here would subscribe as the
     * anonymous role and silently receive nothing at all. Not an error, not a
     * failed subscription: just permanent silence, which is the hardest kind of
     * bug to notice.
     */
    const { data } = this.#client.auth.onAuthStateChange((_event, session) => {
      if (session) {
        this.#openChannel();
        this.#presenceHub.start(session.user.id);
      } else {
        this.#closeChannel();
        this.#presenceHub.stop();
      }
    });
    this.#authWatcher = data.subscription;

    // Covers the already-signed-in case, where the listener above fires late.
    void this.#client.auth.getSession().then(({ data: current }) => {
      if (current.session) {
        this.#openChannel();
        this.#presenceHub.start(current.session.user.id);
      }
    });
  }

  // -- internals -----------------------------------------------------------

  #emit(event: ChatEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  async #userId(): Promise<string> {
    const { data } = await this.#client.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new Error('Not signed in.');
    return id;
  }

  /**
   * One realtime channel for every conversation the user is in.
   *
   * Realtime enforces RLS on its own stream, so this subscribes to *all*
   * message inserts and the server filters to the ones this user may see. A
   * per-conversation channel would mean subscribing and unsubscribing on every
   * navigation, and would miss messages in threads not currently open — which
   * is exactly when the list badge needs to move.
   */
  #closeChannel(): void {
    if (!this.#channel) return;
    void this.#client.removeChannel(this.#channel);
    this.#channel = undefined;
  }

  #openChannel(): void {
    // Idempotent: `onAuthStateChange` fires on token refresh too, and tearing
    // the socket down every hour would drop messages during the gap.
    if (this.#channel) return;

    this.#channel = this.#client
      .channel('pingo:messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as MessageRow;
          this.#emit({ type: 'message:new', message: toMessage(row, undefined) });

          // The list needs the new preview and a bumped position, and only a
          // refetch can produce a correctly-shaped `Conversation`.
          void this.getConversation(row.conversation_id).then((conversation) => {
            if (conversation) this.#emit({ type: 'conversation:updated', conversation });
          });
        },
      )
      /*
       * Notifications, live.
       *
       * RLS filters this stream to rows whose  is mine, so no client
       * filter is needed and no other user's feed can be observed. Without
       * this the badge only ever reflected what was true when the app loaded.
       */
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const row = payload.new as { id: string; kind: string; actor_id: string | null; subject_id: string | null; created_at: string };
          const actor = row.actor_id ? this.#people.get(row.actor_id) : undefined;
          this.#emit({
            type: 'notification:new',
            notification: {
              id: row.id,
              kind: row.kind as AppNotification['kind'],
              title: actor?.name ?? 'Someone',
              body: NOTIFICATION_COPY[row.kind]?.body ?? 'Something happened.',
              createdAt: Date.parse(row.created_at),
              read: false,
              ...(row.subject_id ? { conversationId: row.subject_id } : {}),
              ...(row.actor_id ? { actorId: row.actor_id } : {}),
            },
          });
        },
      )
      /*
       * Notifications, live.
       *
       * RLS filters this stream to rows whose user_id is mine, so there is no
       * client-side filter to get wrong and no other feed to observe. Without
       * it the badge only ever showed what was true when the app loaded.
       */
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const row = payload.new as {
            id: string;
            kind: string;
            actor_id: string | null;
            subject_id: string | null;
            created_at: string;
          };
          const actor = row.actor_id ? this.#people.get(row.actor_id) : undefined;
          this.#emit({
            type: 'notification:new',
            notification: {
              id: row.id,
              kind: row.kind as AppNotification['kind'],
              title: actor?.name ?? 'Someone',
              body: NOTIFICATION_COPY[row.kind]?.body ?? 'Something happened.',
              createdAt: Date.parse(row.created_at),
              read: false,
              ...(row.subject_id ? { conversationId: row.subject_id } : {}),
              ...(row.actor_id ? { actorId: row.actor_id } : {}),
            },
          });
        },
      )
      .subscribe((status) => {
        const next: ConnectionState =
          status === 'SUBSCRIBED' ? 'connected' : status === 'CLOSED' ? 'offline' : 'connecting';

        if (next !== this.#connection) {
          this.#connection = next;
          this.#emit({ type: 'connection:changed', state: next });
        }
      });
  }

  async #loadPeople(ids: UserId[]): Promise<void> {
    const missing = ids.filter((id) => !this.#people.has(id));
    if (missing.length === 0) return;

    const { data } = await this.#client.from('profiles').select('*').in('id', missing);
    for (const row of data ?? []) this.#people.set(row.id, toUser(row));
  }

  /** Builds the view-model conversations for a set of rows the user belongs to. */
  async #hydrate(rows: ConversationRow[], me: UserId): Promise<Conversation[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const [{ data: members }, { data: recent }, { data: streaks }] = await Promise.all([
      this.#client.from('conversation_members').select('*').in('conversation_id', ids),
      /*
       * Newest 200 across all of the user's conversations. Enough to give every
       * row its preview without a query per conversation; a thread's full
       * history comes from `listMessages` when it is opened.
       */
      this.#client
        .from('messages')
        .select('*')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false })
        .limit(200),
      /*
       * One call for every conversation's streak, not one per row. The function
       * computes them from `messages`, so the number can never drift from the
       * conversation it describes.
       */
      this.#client.rpc('my_streaks'),
    ]);

    const streakByConversation = new Map(
      (streaks ?? []).map((row) => [row.conversation_id, row.streak]),
    );

    await this.#loadPeople((members ?? []).map((m) => m.user_id));

    return rows
      .map((row) => {
        const roster = (members ?? []).filter((m) => m.conversation_id === row.id);
        const mine = roster.find((m) => m.user_id === me);
        const readAt = mine ? Date.parse(mine.last_read_at) : 0;

        const threadMessages = (recent ?? []).filter((m) => m.conversation_id === row.id);
        const last = threadMessages[0];

        const others = roster.filter((m) => m.user_id !== me);
        const otherUser = others[0] ? this.#people.get(others[0].user_id) : undefined;

        return {
          id: row.id,
          kind: row.kind,
          // A direct chat is titled by whoever else is in it, per viewer.
          title: row.title ?? otherUser?.name ?? 'Conversation',
          ...(otherUser?.avatarUrl ? { avatarUrl: otherUser.avatarUrl } : {}),
          participantIds: roster.map((m) => m.user_id),
          ...(last ? { lastMessage: toMessage(last, undefined) } : {}),
          // Only other people's messages can be unread. Your own never are.
          unreadCount: threadMessages.filter(
            (m) => m.sender_id !== me && Date.parse(m.created_at) > readAt,
          ).length,
          pinned: mine?.pinned ?? false,
          muted: mine?.muted ?? false,
          favorite: mine?.favorite ?? false,
          typingUserIds: [],
          updatedAt: Date.parse(row.last_message_at),
          // Omitted entirely when there is no streak, so the row renders nothing.
          ...(streakByConversation.has(row.id)
            ? { streak: streakByConversation.get(row.id) }
            : {}),
        } satisfies Conversation;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  }

  // -- session -------------------------------------------------------------

  async getCurrentUser(): Promise<CurrentUser> {
    const id = await this.#userId();
    const { data } = await this.#client.from('profiles').select('*').eq('id', id).maybeSingle();

    if (!data) {
      // Signed in without a profile — the setup flow's job, not this one's.
      return {
        id,
        name: '',
        handle: '',
        presence: { state: 'online', lastSeenAt: Date.now() },
        settings: this.#settings,
      };
    }

    return { ...toUser(data), presence: { state: 'online', lastSeenAt: Date.now() }, settings: this.#settings };
  }

  /** In memory for this session — there is no settings table yet. */
  async updateSettings(settings: Partial<UserSettings>): Promise<CurrentUser> {
    this.#settings = { ...this.#settings, ...settings };
    return this.getCurrentUser();
  }

  // -- conversations -------------------------------------------------------

  async listConversations(): Promise<Conversation[]> {
    const me = await this.#userId();

    const { data: memberships } = await this.#client
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', me);

    const ids = (memberships ?? []).map((m) => m.conversation_id);
    if (ids.length === 0) return [];

    const { data: rows } = await this.#client.from('conversations').select('*').in('id', ids);
    return this.#hydrate(rows ?? [], me);
  }

  async getConversation(id: ConversationId): Promise<Conversation | undefined> {
    const me = await this.#userId();
    const { data } = await this.#client.from('conversations').select('*').eq('id', id).maybeSingle();
    if (!data) return undefined;
    const [conversation] = await this.#hydrate([data], me);
    return conversation;
  }

  async listMessages(
    conversationId: ConversationId,
    options?: { limit?: number; before?: MessageId },
  ): Promise<Message[]> {
    const me = await this.#userId();

    // The other side's read cursor is what lets an outgoing message show as
    // read rather than merely sent.
    const { data: roster } = await this.#client
      .from('conversation_members')
      .select('user_id,last_read_at')
      .eq('conversation_id', conversationId);

    const theirReadAt = (roster ?? [])
      .filter((m) => m.user_id !== me)
      .map((m) => Date.parse(m.last_read_at))
      .sort((a, b) => b - a)[0];

    let query = this.#client
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(options?.limit ?? 50);

    if (options?.before) {
      const { data: anchor } = await this.#client
        .from('messages')
        .select('created_at')
        .eq('id', options.before)
        .maybeSingle();
      if (anchor) query = query.lt('created_at', anchor.created_at);
    }

    const { data } = await query;

    // Fetched newest-first for the limit; returned newest-last so the UI can
    // append without re-sorting.
    return (data ?? [])
      .slice()
      .reverse()
      .map((row) => toMessage(row, row.sender_id === me ? theirReadAt : undefined));
  }

  // -- sending -------------------------------------------------------------

  /**
   * Puts a snap in the private bucket and returns its **path**, not a URL.
   *
   * A signed URL stored on the message would be a copy the viewer keeps, and
   * the two-view limit would mean nothing. The path is useless on its own — a
   * URL is minted per view by `openSnap`, and minting it is what spends one.
   */
  async #uploadSnap(image: Blob): Promise<string> {
    const me = await this.#userId();
    const path = `${me}/${crypto.randomUUID()}.jpg`;

    const { error } = await this.#client.storage
      .from(SNAP_BUCKET)
      .upload(path, image, { contentType: image.type || 'image/jpeg' });

    if (error) throw error;
    return path;
  }

  async openSnap(messageId: MessageId): Promise<SnapView | undefined> {
    const { data, error } = await this.#client.rpc('open_snap', { snap_id: messageId });
    const row = data?.[0];
    if (error || !row?.path) return undefined;

    /*
     * A minute. The URL only has to survive the fetch that follows it — anything
     * longer is a window in which a shared link still works after the snap is
     * supposed to be gone.
     */
    const signed = await this.#client.storage
      .from(SNAP_BUCKET)
      .createSignedUrl(row.path, SNAP_URL_TTL_SECONDS);

    if (signed.error || !signed.data) return undefined;
    return { url: signed.data.signedUrl, viewsLeft: row.views_left };
  }

  async downloadSnap(messageId: MessageId): Promise<Blob | undefined> {
    const opened = await this.openSnap(messageId);
    if (!opened) return undefined;

    const response = await fetch(opened.url);
    if (!response.ok) return undefined;
    const blob = await response.blob();

    /*
     * Destroyed only once the bytes are in hand. Marking it downloaded first
     * would mean a dropped connection costs the receiver the snap entirely.
     */
    await this.#client.rpc('download_snap', { snap_id: messageId });
    return blob;
  }

  async sendMessage(draft: OutgoingMessage): Promise<Message> {
    const me = await this.#userId();

    /*
     * Uploaded before the row is inserted, deliberately. A message row whose
     * media never arrived is a permanently broken bubble in someone's thread;
     * a failed upload that inserts nothing is a retry.
     */
    const snapPath = draft.snap ? await this.#uploadSnap(draft.snap.image) : undefined;
    const snapExpiry = snapPath
      ? new Date(Date.now() + SNAP_EXPIRY_MS).toISOString()
      : undefined;

    const { data, error } = await this.#client
      .from('messages')
      .insert({
        conversation_id: draft.conversationId,
        sender_id: me,
        body: draft.body,
        ...(draft.sticker ? { kind: 'sticker', media_url: draft.sticker.url } : {}),
        ...(snapPath
          ? {
              kind: 'snap',
              // `media_url` stays populated to satisfy the not-null constraint
              // on snap rows; the path is what `open_snap` actually reads.
              media_url: snapPath,
              snap_path: snapPath,
              snap_expires_at: snapExpiry,
            }
          : {}),
      })
      .select('*')
      .single();

    if (error) throw error;
    const message = toMessage(data, undefined);

    /*
     * Emitted here, not left to Realtime.
     *
     * `useMessages` sets no state of its own — its `send` awaits this and waits
     * for `message:new` to put the bubble on screen. Relying on the socket to
     * echo our own insert would make sending look broken whenever realtime is
     * slow, reconnecting, or switched off. The hook de-duplicates by id, so the
     * echo that follows is harmless.
     */
    this.#emit({ type: 'message:new', message });

    const conversation = await this.getConversation(draft.conversationId);
    if (conversation) this.#emit({ type: 'conversation:updated', conversation });

    return message;
  }

  async markConversationRead(conversationId: ConversationId): Promise<void> {
    const me = await this.#userId();

    await this.#client
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', me);

    const conversation = await this.getConversation(conversationId);
    if (conversation) this.#emit({ type: 'conversation:updated', conversation });
  }

  /** Not persisted — typing needs a realtime presence channel, not a table. */
  async setTyping(conversationId: ConversationId, typing: boolean): Promise<void> {
    await this.#presenceHub.setTyping(conversationId, typing);
  }

  /**
   * Not persisted — there is no reactions table yet.
   *
   * Returns the message unchanged rather than pretending. The caller sees no
   * reaction appear, which is the truth: nothing was stored.
   */
  async toggleReaction(messageId: MessageId): Promise<Message> {
    const { data, error } = await this.#client
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error(`No message ${messageId}`);

    return toMessage(data, undefined);
  }

  // -- people --------------------------------------------------------------

  async getUser(id: UserId): Promise<User | undefined> {
    const cached = this.#people.get(id);
    if (cached) return cached;

    const { data } = await this.#client.from('profiles').select('*').eq('id', id).maybeSingle();
    if (!data) return undefined;

    const user = toUser(data);
    this.#people.set(id, user);
    return user;
  }

  /** Everyone else on PINGO. Contact matching needs a device, not a browser. */
  async listContacts(): Promise<User[]> {
    const me = await this.#userId();
    const { data } = await this.#client
      .from('profiles')
      .select('*')
      .neq('id', me)
      .order('created_at', { ascending: false })
      .limit(100);

    const users = (data ?? []).map(toUser);
    for (const user of users) this.#people.set(user.id, user);
    return users;
  }

  // -- not yet backed by schema -------------------------------------------

  /** No calls table. Empty rather than fabricated history. */
  async listCalls(): Promise<CallRecord[]> {
    return [];
  }

  /** No gallery table. */
  async listGallery(): Promise<GalleryItem[]> {
    return [];
  }

  /** No moments table. */
  async listMoments(): Promise<Moment[]> {
    return [];
  }

  /** No notifications table — push is delivered, not stored, for now. */
  /**
   * The feed, with actor names resolved.
   *
   * Titles are built here rather than stored, so a renamed user is not stuck
   * with their old name in every notification they ever caused. The row keeps
   * ids; the words are assembled at read time.
   */
  async listNotifications(): Promise<AppNotification[]> {
    const { data, error } = await this.#client
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return [];

    const rows = data ?? [];
    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];

    // One lookup for every actor in the page, not one per row.
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: people } = await this.#client
        .from('profiles')
        .select('id, display_name')
        .in('id', actorIds);
      for (const person of people ?? []) names.set(person.id, person.display_name);
    }

    return rows.map((row) => {
      const who = (row.actor_id && names.get(row.actor_id)) || 'Someone';
      const copy = NOTIFICATION_COPY[row.kind] ?? { title: who, body: 'Something happened.' };

      return {
        id: row.id,
        kind: row.kind,
        title: who,
        body: copy.body,
        createdAt: Date.parse(row.created_at),
        read: row.read_at !== null,
        ...(row.subject_id ? { conversationId: row.subject_id } : {}),
        ...(row.actor_id ? { actorId: row.actor_id } : {}),
      } satisfies AppNotification;
    });
  }

  async markNotificationRead(id: string): Promise<void> {
    await this.#client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
  }

  async unreadNotifications(): Promise<number> {
    const { data, error } = await this.#client.rpc('unread_notifications');
    // Zero on failure: a badge that shows a number it cannot justify is worse
    // than no badge, and this runs on every app load.
    return error ? 0 : (data ?? 0);
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.#client.rpc('mark_notifications_read');
  }

  // -- search --------------------------------------------------------------

  async search(query: string): Promise<SearchResult[]> {
    const term = query.trim();
    if (term.length === 0) return [];

    const me = await this.#userId();

    const [{ data: people }, conversations] = await Promise.all([
      this.#client
        .from('profiles')
        .select('*')
        .neq('id', me)
        .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
        .limit(10),
      this.listConversations(),
    ]);

    const results: SearchResult[] = (people ?? []).map((row) => ({
      kind: 'user' as const,
      user: toUser(row),
    }));

    const lowered = term.toLowerCase();
    for (const conversation of conversations) {
      if (conversation.title.toLowerCase().includes(lowered)) {
        results.push({ kind: 'conversation', conversation });
      }
    }

    return results;
  }

  // -- live ----------------------------------------------------------------

  subscribe(listener: (event: ChatEvent) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  connectionState(): ConnectionState {
    return this.#connection;
  }

  /** Called by `ChatProvider` when the tree unmounts. */
  dispose(): void {
    this.#listeners.clear();
    this.#authWatcher?.unsubscribe();
    this.#closeChannel();
  }

  // -- beyond the interface ------------------------------------------------

  /**
   * Opens (or reuses) a direct conversation with someone.
   *
   * Not on `ChatService` yet — starting a conversation is a Phase 3 screen that
   * does not exist. It is here because the RPC does, and because the first
   * thing anyone will want to do with this service is talk to somebody.
   */
  async startDirectConversation(otherUserId: UserId): Promise<ConversationId> {
    const { data, error } = await this.#client.rpc('start_direct_conversation', {
      other_user: otherUserId,
    });

    if (error) throw error;
    return data;
  }
}
