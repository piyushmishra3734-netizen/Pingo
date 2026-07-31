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
 * | Presence | Not built - everyone reads as offline |
 * | Reactions, typing | Not persisted - no-ops, see below |
 * | Calls, gallery, moments, notifications | Empty - no tables yet |
 * | Settings | In memory for the session only |
 *
 * A no-op that silently claims success is the kind of thing that gets
 * discovered a month later, so each one is marked and none of them lie about
 * having stored anything.
 */

import type {
  AppNotification,
  Attachment,
  CallOutcome,
  CallRecord,
  ChatEvent,
  ChatList,
  ChatService,
  ConnectionState,
  Conversation,
  ConversationFlags,
  ConversationId,
  CurrentUser,
  GalleryItem,
  Message,
  MessageId,
  MessageReceipt,
  StartupSnapshot,
  Moment,
  OutgoingMessage,
  Reaction,
  ReadReceipt,
  SearchResult,
  PingView,
  Unsubscribe,
  User,
  UserId,
  UserSettings,
} from '@pingo/core';

import {
  openRecord,
  openRow,
  openRows,
  UNREADABLE,
  publishDeviceKey,
  purgeUnsealedCache,
  verifyRowStore,
  writeMessageRows,
  type RowStoreIntegrity,
  sealBody,
  sealRecord,
} from '../crypto/session.js';
import { STORE, localDelete, localGet, localSet } from '../local/db.js';
import { enqueue, flush } from '../local/outbox.js';
import { getSupabaseClient, type PingoSupabaseClient } from './client.js';
import { PresenceHub } from './presence.js';
import type { ConversationRow, Database, MessageRow, ProfileRow } from './types.js';

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

function toUser(row: ProfileRow, lastSeenAt?: number): User {
  return {
    id: row.id,
    name: row.display_name,
    handle: row.username,
    avatarUrl: row.avatar_url ?? undefined,
    /*
     * Offline until Realtime says otherwise - a green dot that means nothing is
     * worse than no dot at all.
     *
     * `lastSeenAt` is when one of this person's devices last opened PINGO, read
     * from `device_keys`. It used to be the profile's `created_at`, which meant
     * the header confidently reported "last seen" as the day the account was
     * made and never changed again. Falling back to `created_at` when the
     * person has no device row is deliberate: it is the only timestamp we hold
     * for someone who has not signed in since devices were recorded, and it is
     * at least a real moment they existed.
     */
    presence: { state: 'offline', lastSeenAt: lastSeenAt ?? Date.parse(row.created_at) },
  };
}

/**
 * Postgres timestamps, including the two that are not dates.
 *
 * `infinity` is how "muted forever" is stored, and `Date.parse` returns NaN for
 * it - which would silently become "muted until an invalid date" and compare
 * false against every clock, quietly unmuting the chat.
 */
function parseTimestamp(value: string): number {
  if (value === 'infinity') return Number.POSITIVE_INFINITY;
  if (value === '-infinity') return Number.NEGATIVE_INFINITY;
  return Date.parse(value);
}

/**
 * The attachment a row carries, if any.
 *
 * Voice notes and documents both become attachments, because the bubble already
 * renders those. Both leave the URL empty for the signing pass to fill in - a
 * page signs one bucket per request rather than one row at a time.
 */
function toAttachments(row: MessageRow): Attachment[] {
  if (row.kind === 'voice' && row.voice_path) {
    return [
      {
        id: row.id,
        kind: 'audio',
        url: '',
        duration: row.voice_duration ?? 0,
        waveform: row.voice_waveform ?? [],
      },
    ];
  }

  if (row.kind === 'document' && row.file_path) {
    return [
      {
        id: row.id,
        kind: 'file',
        url: '',
        fileName: row.file_name ?? 'Document',
        // The generic type is what a server falls back to when it cannot tell,
        // so it is the honest value here rather than an empty string.
        mimeType: row.file_mime ?? 'application/octet-stream',
        ...(row.file_size !== null ? { size: row.file_size } : {}),
      },
    ];
  }

  return [];
}

/**
 * The group rules, in the words a person should read.
 *
 * The functions raise custom SQLSTATEs rather than messages, so the rule lives
 * in one place and every client says the same thing about it. Mapping them here
 * rather than showing `error.message` also stops a Postgres string - schema
 * names, function names, a hint about granting privileges - from reaching a
 * screen.
 */
const GROUP_ERRORS: Record<string, string> = {
  GR001: 'That group name will not work. Try something between 1 and 60 characters.',
  GR002: 'You can only add friends to a group. Send them the invite link instead.',
  GR003: 'Only an admin can do that.',
  GR004: 'Use Leave group to leave.',
  GR005: 'Make someone else an admin before you step down.',
  GR006: 'That invite link is no longer valid.',
};

function groupError(error: { code?: string; message?: string }): Error {
  return new Error(
    (error.code ? GROUP_ERRORS[error.code] : undefined) ?? 'That did not work. Try again.',
  );
}

/** How many changed rows one delta will accept before giving up on itself. */
const DELTA_LIMIT = 200;

/** Before any message. A cursor that has never advanced. */
const EPOCH = '1970-01-01T00:00:00Z';

/**
 * Folds changed messages into a cached page.
 *
 * Replace by id, append what is new, and keep the page in creation order  - 
 * changes arrive ordered by `updated_at`, which for an edited message says
 * nothing about where it belongs on screen.
 *
 * The page is not trimmed back to fifty. A conversation that gained ten
 * messages should show sixty rather than silently dropping the ten oldest,
 * which would look like history disappearing while somebody was reading it.
 */
function mergeMessages(cached: Message[], changed: Message[]): Message[] {
  const byId = new Map(cached.map((m) => [m.id, m]));
  for (const message of changed) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** The high-water mark to store, never moving backwards. */
function newestUpdatedAt(rows: MessageRow[], fallback: string): string {
  let newest = fallback;
  for (const row of rows) {
    const at = row.updated_at ?? row.created_at;
    if (at > newest) newest = at;
  }
  return newest;
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
     * inventing a fact - except for the one case we *can* prove: the recipient's
     * own read cursor has passed it.
     */
    status: readAt !== undefined && Date.parse(row.created_at) <= readAt ? 'read' : 'sent',
    /*
     * A voice note arrives as an audio attachment rather than as a field of its
     * own, because the bubble already renders one - a parallel `voice` shape
     * would be a second thing meaning the same thing. The URL is empty until
     * `#signMedia` fills it in, one pass per page rather than one per row.
     */
    attachments: toAttachments(row),
    reactions: [],
    ...(row.edited_at ? { editedAt: Date.parse(row.edited_at) } : {}),
    ...(row.reply_to_id ? { replyToId: row.reply_to_id } : {}),
    // The row survives deletion so replies quoting it keep an anchor. The
    // server already emptied the body; this is what draws the tombstone, and
    // the timestamp is the deletion's own - see `Message.deletedAt`.
    ...(row.deleted_at
      ? { deleted: true, deletedAt: Date.parse(row.deleted_at) }
      : {}),
    // `media_url` is the sticker's image; `body` stays its emoji, so a client
    // that cannot render one still shows something meaningful.
    ...(row.kind === 'sticker' && row.media_url
      ? { sticker: { id: row.id, url: row.media_url } }
      : {}),
    /*
     * A Ping carries no URL - see `PingRef`. `gone` folds together exhausted,
     * saved and expired, because the thread should not tell you which.
     */
    ...(row.kind === 'snap'
      ? {
          ping: {
            // One or two. Older rows predate the choice and were sent as two.
            views: row.view_limit ?? 2,
            expiresAt: row.snap_expires_at ? Date.parse(row.snap_expires_at) : 0,
            gone:
              row.snap_path === null ||
              row.snap_consumed_at !== null ||
              (row.snap_expires_at !== null && Date.parse(row.snap_expires_at) < Date.now()),
          },
        }
      : {}),
    /*
     * A photo's URL is filled in afterwards by `#signPhotos`, which signs a
     * whole page in one pass. Signing here would mean an await per row and a
     * request per row for a thread that renders fifty of them.
     */
    ...(row.kind === 'photo' && row.photo_path
      ? { photo: { ...(row.view_limit ? { viewLimit: row.view_limit } : {}) } }
      : {}),
    // The structured kinds are read straight off `meta`, which is the shape the
    // client wrote and the only thing that reads it.
    ...(row.kind === 'location' && row.meta
      ? { location: row.meta as unknown as Message['location'] }
      : {}),
    ...(row.kind === 'contact' && row.meta
      ? { contact: row.meta as unknown as Message['contact'] }
      : {}),
    ...(row.kind === 'event' && row.meta
      ? { event: row.meta as unknown as Message['event'] }
      : {}),
    ...(row.kind === 'call' && row.meta
      ? { call: row.meta as unknown as Message['call'] }
      : {}),
    /*
     * Not keyed on `kind`, unlike everything above it.
     *
     * A story reply is a text message that happens to carry a tag, so there is
     * no kind to match on - the presence of `storyId` in `meta` is the whole
     * signal.
     */
    ...((row.meta as { storyId?: string } | null)?.storyId
      ? { storyReply: { storyId: (row.meta as { storyId: string }).storyId } }
      : {}),
  };
}

/**
 * How many times one `listMessages` call may read to fill its page.
 *
 * A ceiling rather than a target: the loop exists to absorb messages hidden
 * after the database limit, and hiding a whole page of them is not a case worth
 * an unbounded read. Reaching this returns a short page, which the caller reads
 * as the end of history - wrong, but bounded, and better than a loop that can
 * run forever against a thread somebody has emptied for themselves.
 */
const MAX_PAGE_READS = 5;

/** Snaps live in a private bucket; the `snaps` migration explains why. */
const SNAP_BUCKET = 'snaps';

/** Photos live in their own private bucket. See the `photo_messages` migration. */
const PHOTO_BUCKET = 'photos';

/** Voice notes, same arrangement and for the same reasons. */
const VOICE_BUCKET = 'voice';

/** Documents, likewise. */
const DOCUMENT_BUCKET = 'documents';

/**
 * An hour for a photo's signed URL.
 *
 * Longer than a snap's minute, because a photo is meant to be scrolled back to
 * and re-signing on every pass through the thread would be a request per bubble.
 * Still finite: a URL that never expires is a copy that outlives the message.
 */
const PHOTO_URL_TTL_SECONDS = 60 * 60;

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
  ping: { body: 'sent you a Ping' },
  // The sender's two. Never "photo received" - a Ping is not a photo, and the
  // word is the whole point of the feature having a name.
  ping_opened: { body: 'opened your Ping' },
  ping_replayed: { body: 'replayed your Ping' },
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

  /**
   * The backing store for `Message.reactions`. docs/13 § 8.1.
   *
   * Not a second model - every `Message.reactions` handed to the UI is derived
   * from here, so there is one authoritative client state rather than two that
   * can disagree.
   */
  #reactions = new Map<MessageId, Reaction[]>();

  /**
   * Optimistic toggles awaiting their echo. docs/13 § 8.2.
   *
   * Keyed by message, holding the newest intent and its revision. Without this
   * a stale confirmation overwrites newer intent: tap ❤️ then 👍, and the ❤️
   * echo arrives last and wins.
   */
  #pending = new Map<MessageId, { revision: number; emoji: string | undefined }>();
  #revision = 0;

  /** Messages this user deleted for themselves. Filtered out of every read. */
  #hidden = new Set<MessageId>();

  /**
   * Did every message in the page just fetched decrypt?
   *
   * Set by the fetch and read by the caller that decides whether to cache. A
   * page with an undecryptable message in it is not written to disk, because a
   * cached placeholder is served before the network and turns a passing
   * failure into a permanent one.
   */
  #pageFullyDecrypted = true;

  /** Newest updated_at seen in the last full page. Seeds the delta cursor. */
  #pageNewestUpdatedAt = EPOCH;

  /**
   * How often the delta path answered, and how much it moved.
   *
   * Counted rather than logged so milestone 3 can be measured on a real device
   * instead of argued about. A hit that fetched zero rows is the shape this
   * whole milestone is aiming for.
   */
  #deltaStats = { hits: 0, misses: 0, rowsFetched: 0 };

  /** Delta sync effectiveness, for inspection. */
  deltaReport(): { hits: number; misses: number; rowsFetched: number } {
    return { ...this.#deltaStats };
  }

  /**
   * What the row store looked like against the blob, per conversation.
   *
   * Held in memory and exposed rather than logged, so the migration can be
   * inspected on a real device with real data before legacy writes are
   * removed. Milestone 2 finishes when this reports agreement across a
   * meaningful sample; until then the blob remains authoritative.
   */
  #rowStoreIntegrity = new Map<ConversationId, RowStoreIntegrity & { written: number }>();

  /** Migration progress, for inspection. Reads nothing and changes nothing. */
  rowStoreReport(): Array<RowStoreIntegrity & { written: number }> {
    return [...this.#rowStoreIntegrity.values()];
  }

  #authWatcher: { unsubscribe: () => void } | undefined;

  /**
   * Presence and typing, both over Realtime rather than the database.
   *
   * A row saying "online" outlives the tab that wrote it; a socket does not.
   * See `presence.ts` for why neither is persisted.
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
     * carry the user's JWT. This service is constructed at app mount - before
     * auth has resolved - so a channel opened here would subscribe as the
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
        /*
         * Reclaims storage for snaps nobody opened. The migration documents
         * this as the client's job when pg_cron is not scheduled - and until
         * now nothing did it, so expired images stayed on the server forever.
         * Fire and forget: it is housekeeping, not part of signing in.
         */
        void this.#client.rpc('purge_expired_snaps');
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

    /*
     * Publishing rides along with the first thing that needs an identity,
     * rather than being a step sign-in has to remember. It runs once per
     * session and never blocks: a device that has not published yet can still
     * read and send, it just cannot be encrypted *to* until it has.
     */
    void publishDeviceKey(this.#client, id);

    // Plaintext left on disk by a build that predates sealing. Runs once, and
    // costs one refetch for any conversation it clears.
    void purgeUnsealedCache();

    return id;
  }

  /**
   * One realtime channel for every conversation the user is in.
   *
   * Realtime enforces RLS on its own stream, so this subscribes to *all*
   * message inserts and the server filters to the ones this user may see. A
   * per-conversation channel would mean subscribing and unsubscribing on every
   * navigation, and would miss messages in threads not currently open - which
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
          /*
           * Signed before it is announced.
           *
           * A photo arriving over the socket has a storage path and no URL, and
           * this echo races the signed copy that `sendMessage` returns - the
           * hook de-duplicates by id, so whichever lands first wins. When the
           * socket won, the sender's own photo rendered as an unopened cover.
           */
          // Decrypted before it is signed, because signing reads the row and
          // the announcement reads the body.
          void openRow(row)
            .then(() => this.#signPhotos([row], [toMessage(row, undefined)]))
            .then(([message]) => {
              if (message) this.#emit({ type: 'message:new', message });
            });

          // The list needs the new preview and a bumped position, and only a
          // refetch can produce a correctly-shaped `Conversation`.
          void this.getConversation(row.conversation_id).then((conversation) => {
            if (conversation) this.#emit({ type: 'conversation:updated', conversation });
          });
        },
      )
      /*
       * Edits and deletions, live.
       *
       * Both are `update`s on an existing row rather than inserts, so without
       * this the other side of the conversation keeps reading the old text
       * until it reloads - which is precisely the case an "Edited" marker
       * exists to prevent. The row carries no reactions, so they come from the
       * cache rather than being wiped by the update.
       */
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as MessageRow;
          // Signed for the same reason as the insert above.
          void openRow(row)
            .then(() => this.#signPhotos([row], [toMessage(row, undefined)]))
            .then(([signed]) => {
              if (!signed) return;
              this.#emit({
                type: 'message:updated',
                message: { ...signed, reactions: this.#reactions.get(row.id) ?? [] },
              });
            });

          // The list shows this message when it is the newest one, so an edit
          // or a deletion has to reach the preview as well as the thread.
          void this.getConversation(row.conversation_id).then((conversation) => {
            if (conversation) this.#emit({ type: 'conversation:updated', conversation });
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
      /*
       * Reactions, live. A reaction is immediate enough that seeing it only
       * after a reload reads as the tap not having worked. RLS filters this to
       * conversations the user is in, so no client-side check is needed.
       */
      /*
       * Reactions, live - applied as a delta rather than triggering a re-read.
       * docs/13 § 8.3: the payload carries the row, not the operation, so a
       * confirmation of our own change is matched on the user id and compared
       * against the newest pending intent.
       */
      /*
       * A conversation itself changing, live.
       *
       * The first migration deliberately left `conversations` unpublished,
       * because the list updated from the same message events and publishing
       * both would deliver everything twice. That reasoning held exactly as
       * long as a conversation only ever changed *because* of a message.
       *
       * Groups broke it. A rename, a new group picture and a member joining are
       * all changes with no message attached, so the list had no way to hear
       * about any of them - which is why a group appeared only after a reload.
       */
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { id?: string } | null;
          if (!row?.id) return;
          void this.#announce(row.id);
        },
      )
      /*
       * The roster, live.
       *
       * An INSERT naming me is the moment I am *in* a group - there is no other
       * signal for it, because nothing is sent to the conversation when
       * somebody is added. A DELETE naming me is being removed, and has to take
       * the row out of my list rather than re-reading a conversation I can no
       * longer see.
       *
       * For anybody else, both mean the roster moved, which the group info
       * sheet and the header's avatar stack both draw from.
       */
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_members' },
        (payload) => {
          const row = payload.new as { conversation_id?: string; user_id?: string };
          if (!row.conversation_id) return;
          void this.#announce(row.conversation_id);
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'conversation_members' },
        (payload) => {
          /*
           * `old` carries only the primary key under the default replica
           * identity - which is exactly the two columns needed here, because
           * the key is (conversation_id, user_id).
           */
          const row = payload.old as { conversation_id?: string; user_id?: string };
          if (!row.conversation_id || !row.user_id) return;

          void this.#userId().then((me) => {
            if (row.user_id === me) {
              // Removed, or left from another device. Re-reading would return
              // nothing and leave the old row on screen.
              this.#emit({
                type: 'conversation:removed',
                conversationId: row.conversation_id!,
              });
              return;
            }
            void this.#announce(row.conversation_id!);
          });
        },
      )
      /*
       * Read receipts, live.
       *
       * The stream that was missing. `last_read_at` was fetched once, when the
       * thread opened, so the second tick could only ever appear on a *later*
       * visit - you had to leave the conversation and come back to find out
       * that the person you were talking to had read you.
       *
       * RLS on `conversation_members` is already "members of that
       * conversation", and realtime applies it to its own stream, so this
       * carries nothing a member could not have read directly.
       */
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversation_members' },
        (payload) => {
          const row = payload.new as {
            conversation_id?: string;
            user_id?: string;
            last_read_at?: string;
          };
          if (!row.conversation_id || !row.user_id || !row.last_read_at) return;

          void this.#userId().then((me) => {
            // My own cursor moving is not news to me, and echoing it would
            // redraw the thread every time I opened it.
            if (row.user_id === me) return;

            this.#emit({
              type: 'receipts:changed',
              conversationId: row.conversation_id!,
              readers: [
                { userId: row.user_id!, readAt: Date.parse(row.last_read_at!) },
              ],
            });

            // The list draws its ticks from the conversation's own preview, so
            // it needs the same news in the shape it already understands.
            void this.getConversation(row.conversation_id!).then((conversation) => {
              if (conversation) this.#emit({ type: 'conversation:updated', conversation });
            });
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { message_id?: string; user_id?: string; emoji?: string }
            | null;
          if (!row?.message_id || !row.user_id) return;

          // DELETE arrives as `old`, and means this person now has nothing.
          const emoji = payload.eventType === 'DELETE' ? undefined : row.emoji;
          void this.#onReactionChange(row.message_id, row.user_id, emoji);
        },
      )
      .subscribe((status) => {
        const next: ConnectionState =
          status === 'SUBSCRIBED' ? 'connected' : status === 'CLOSED' ? 'offline' : 'connecting';

        if (next !== this.#connection) {
          const wasOffline = this.#connection !== 'connected';
          this.#connection = next;
          this.#emit({ type: 'connection:changed', state: next });

          /*
           * Coming back is what drains the outbox.
           *
           * Keyed on the transition rather than on a timer or a retry loop:
           * there is exactly one moment when a queued message becomes sendable,
           * and polling for it would either be slow or waste battery being
           * early. A reconnect after a reconnect flushes nothing, because the
           * queue is already empty.
           */
          if (next === 'connected' && wasOffline) void this.#flushOutbox();
        }
      });
  }

  async #loadPeople(ids: UserId[]): Promise<void> {
    const missing = ids.filter((id) => !this.#people.has(id));
    if (missing.length === 0) return;

    const [{ data }, lastSeen] = await Promise.all([
      this.#client.from('profiles').select('*').in('id', missing),
      this.#lastSeenFor(missing),
    ]);
    for (const row of data ?? []) this.#people.set(row.id, toUser(row, lastSeen.get(row.id)));
  }

  /**
   * When each of these people last had PINGO open.
   *
   * `device_keys.last_seen_at` is written every time a session starts, one row
   * per device, so the answer for a person is the newest across their devices  - 
   * a phone left closed for a week must not drag down a laptop used an hour
   * ago. The table is world-readable by design (it holds public halves only),
   * so this needs no policy of its own.
   *
   * A failure here is not worth failing a roster load over: the caller falls
   * back to the profile timestamp and the header reads a little stale rather
   * than not rendering.
   */
  async #lastSeenFor(ids: UserId[]): Promise<Map<UserId, number>> {
    const newest = new Map<UserId, number>();
    if (ids.length === 0) return newest;

    const { data, error } = await this.#client
      .from('device_keys')
      .select('user_id,last_seen_at')
      .in('user_id', ids);

    if (error || !data) return newest;

    for (const row of data) {
      const at = Date.parse(row.last_seen_at);
      if (!Number.isFinite(at)) continue;
      const seen = newest.get(row.user_id);
      if (seen === undefined || at > seen) newest.set(row.user_id, at);
    }
    return newest;
  }

  /** Builds the view-model conversations for a set of rows the user belongs to. */
  async #hydrate(rows: ConversationRow[], me: UserId): Promise<Conversation[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const [{ data: members }, { data: previews }, { data: streaks }] = await Promise.all([
      this.#client.from('conversation_members').select('*').in('conversation_id', ids),
      /*
       * One preview and one unread count per conversation, from the database.
       *
       * This used to be "the newest 200 messages across everything", filtered
       * per conversation in JavaScript - which holds only while the total stays
       * under two hundred. Past that the 200 all belong to the busiest one or
       * two threads, every other conversation matches nothing, and the list
       * says "No messages yet" about a conversation full of messages. The
       * unread count came from the same truncated set and went to zero with it.
       */
      this.#client.rpc('conversation_previews'),
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

    const previewByConversation = new Map(
      (previews ?? []).map((row) => [row.conversation_id, row]),
    );

    /*
     * Which lists each conversation is filed under.
     *
     * RLS scopes `chat_list_members` to lists this user owns, so this needs no
     * filter of its own - and could not see anyone else's filing if it tried.
     */
    const { data: listRows } = await this.#client
      .from('chat_list_members')
      .select('list_id,conversation_id')
      .in('conversation_id', ids);

    const listsByConversation = new Map<string, string[]>();
    for (const row of listRows ?? []) {
      const existing = listsByConversation.get(row.conversation_id);
      if (existing) existing.push(row.list_id);
      else listsByConversation.set(row.conversation_id, [row.list_id]);
    }

    /*
     * The preview rows name the newest message; this fetches those rows. One
     * query for the whole list, and bounded by the number of conversations
     * rather than by how much anyone has been talking.
     */
    const lastMessageIds = (previews ?? [])
      .map((row) => row.last_message_id)
      .filter((id): id is string => Boolean(id));

    const lastById = new Map<string, MessageRow>();
    if (lastMessageIds.length > 0) {
      const { data: lastRows } = await this.#client
        .from('messages')
        .select('*')
        .in('id', lastMessageIds);
      // The list's previews are ciphertext too. Without this the home screen
      // would show base64 under every name.
      await openRows(lastRows ?? []);
      for (const row of lastRows ?? []) lastById.set(row.id, row);
    }

    await this.#loadPeople((members ?? []).map((m) => m.user_id));

    return rows
      /*
       * A chat the member deleted is not in their list at all - not archived,
       * not empty, absent. It returns on its own when something newer arrives,
       * which is what `deleted` in the preview already accounts for.
       */
      .filter((row) => !previewByConversation.get(row.id)?.deleted)
      .map((row) => {
        const roster = (members ?? []).filter((m) => m.conversation_id === row.id);
        const mine = roster.find((m) => m.user_id === me);

        const preview = previewByConversation.get(row.id);
        const last = preview?.last_message_id
          ? lastById.get(preview.last_message_id)
          : undefined;

        const others = roster.filter((m) => m.user_id !== me);
        const otherUser = others[0] ? this.#people.get(others[0].user_id) : undefined;

        /*
         * How far the *others* have read.
         *
         * This used to be `undefined`, unconditionally, which is why the chat
         * list could never show a second tick: the thread knew the message had
         * been read and the row beside it still said "sent". One number was
         * missing from one call, and the two screens disagreed about the same
         * message.
         *
         * The furthest reader wins. In a group that means two ticks appear when
         * the first person reads it, which matches what the thread's "Seen by"
         * line counts from - a row cannot express "three of six", and pretending
         * a group behaves like a direct chat is better than saying nothing until
         * the last straggler catches up.
         */
        const theirReadAt = others
          .map((m) => Date.parse(m.last_read_at))
          .sort((a, b) => b - a)[0];

        return {
          id: row.id,
          kind: row.kind,
          // A direct chat is titled by whoever else is in it, per viewer.
          title: row.title ?? otherUser?.name ?? 'Conversation',
          /*
           * A group's own picture, or the other person's.
           *
           * Checked in that order rather than merged: a group that has had its
           * picture removed must fall back to nothing, not to whichever member
           * happens to sort first - which would give the group a face belonging
           * to somebody who might later leave it.
           */
          ...(row.avatar_url
            ? { avatarUrl: row.avatar_url }
            : otherUser?.avatarUrl
              ? { avatarUrl: otherUser.avatarUrl }
              : {}),
          participantIds: roster.map((m) => m.user_id),
          // Only groups have ranks, so a direct chat carries an empty list
          // rather than an absent field the screens would have to guard.
          adminIds: roster.filter((m) => m.role === 'admin').map((m) => m.user_id),
          ...(last ? { lastMessage: toMessage(last, theirReadAt) } : {}),
          // Counted in SQL over the real rows, not over whatever this client
          // happened to have fetched.
          unreadCount: preview?.unread_count ?? 0,
          pinned: mine?.pinned ?? false,
          // Both computed in SQL, so an expired mute needs nothing to clear it.
          muted: preview?.muted ?? false,
          ...(preview?.muted_until
            ? { mutedUntil: parseTimestamp(preview.muted_until) }
            : {}),
          favorite: mine?.favorite ?? false,
          /*
           * Raw, as the server sees it. Whether a chat with newer messages is
           * still archived is the reader's preference to answer, and the
           * service has no business knowing which way they set it.
           */
          archived: preview?.archived_at !== null && preview?.archived_at !== undefined,
          ...(preview?.archived_at
            ? { archivedAt: Date.parse(preview.archived_at) }
            : {}),
          listIds: listsByConversation.get(row.id) ?? [],
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
      // Signed in without a profile - the setup flow's job, not this one's.
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

  /** In memory for this session - there is no settings table yet. */
  async updateSettings(settings: Partial<UserSettings>): Promise<CurrentUser> {
    this.#settings = { ...this.#settings, ...settings };
    return this.getCurrentUser();
  }

  // -- conversations -------------------------------------------------------

  async listConversations(): Promise<Conversation[]> {
    /*
     * The cache answers first when the network cannot.
     *
     * Not cache-first: a stale list shown ahead of a fresh one makes every
     * launch flash the wrong unread counts. This tries the network, and falls
     * back only when it fails - so an offline launch opens on the conversations
     * you had rather than on an empty screen with an error.
     */
    try {
      const live = await this.#listConversationsFromNetwork();
      // Sealed too. The list carries message previews, which is to say it
      // carries the first line of every conversation you have.
      void sealRecord(live).then((sealed) => localSet(STORE.conversations, 'all', sealed));
      return live;
    } catch (cause) {
      const cached = await openRecord<Conversation[]>(
        await localGet<unknown>(STORE.conversations, 'all'),
      );
      if (cached) return cached;
      throw cause;
    }
  }

  async #listConversationsFromNetwork(): Promise<Conversation[]> {
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

  // -- conversation management ----------------------------------------------

  /*
   * Every one of these writes to `conversation_members` for this user only, so
   * RLS on `user_id = auth.uid()` is what makes them safe - there is no way to
   * express "archive it for them" and no code path that would want to.
   */

  async setConversationFlags(
    conversationIds: ConversationId[],
    flags: ConversationFlags,
  ): Promise<void> {
    if (conversationIds.length === 0) return;
    const me = await this.#userId();

    const patch: Database['public']['Tables']['conversation_members']['Update'] = {};
    if (flags.pinned !== undefined) patch.pinned = flags.pinned;
    if (flags.mutedUntil !== undefined) {
      /*
       * `Infinity` is stored as Postgres `infinity` rather than as a date far
       * enough away to look permanent. A sentinel year would eventually arrive,
       * and every read would have to know which one was chosen to mean forever.
       */
      patch.muted_until =
        flags.mutedUntil === null
          ? null
          : Number.isFinite(flags.mutedUntil)
            ? new Date(flags.mutedUntil).toISOString()
            : 'infinity';
    }
    if (flags.favorite !== undefined) patch.favorite = flags.favorite;
    if (flags.archived !== undefined) {
      patch.archived_at = flags.archived ? new Date().toISOString() : null;
      /*
       * Archiving un-pins. The pinned section sits above the main list, so a
       * pinned-and-archived chat would have to be in two places at once - and
       * the pin limit would be spent on something the user has put away.
       */
      if (flags.archived) patch.pinned = false;
    }
    if (flags.unread !== undefined) {
      patch.marked_unread = flags.unread;
      // Marking read has to move the cursor too, or the real unreads survive
      // and the row goes straight back to bold.
      if (!flags.unread) patch.last_read_at = new Date().toISOString();
    }

    if (Object.keys(patch).length === 0) return;

    await this.#writeMembership(conversationIds, me, patch);
    await this.#refresh(conversationIds);
  }

  async deleteConversations(conversationIds: ConversationId[]): Promise<void> {
    if (conversationIds.length === 0) return;
    const me = await this.#userId();
    const now = new Date().toISOString();

    /*
     * Both timestamps. `cleared_at` hides the history, `deleted_at` hides the
     * row - a chat that only cleared would sit in the list looking empty, and
     * one that only "deleted" would come back with its whole history intact the
     * moment anyone replied.
     */
    await this.#writeMembership(conversationIds, me, {
      cleared_at: now,
      deleted_at: now,
      pinned: false,
      marked_unread: false,
    });

    for (const id of conversationIds) {
      this.#emit({ type: 'conversation:removed', conversationId: id });
    }
  }

  async clearConversations(conversationIds: ConversationId[]): Promise<void> {
    if (conversationIds.length === 0) return;
    const me = await this.#userId();

    await this.#writeMembership(conversationIds, me, {
      cleared_at: new Date().toISOString(),
    });
    await this.#refresh(conversationIds);
  }

  /**
   * Updates this user's membership rows, and refuses to succeed quietly.
   *
   * An `update` filtered by RLS does not error - it matches nothing and returns
   * 200. So an archive that the policy declines, or one aimed at a conversation
   * the user is not in, would look exactly like an archive that worked, and the
   * row would spring back on the next refresh with no explanation. Asking for
   * the count is what turns that into a failure the UI can report.
   */
  async #writeMembership(
    conversationIds: ConversationId[],
    me: UserId,
    patch: Database['public']['Tables']['conversation_members']['Update'],
  ): Promise<void> {
    const { error, count } = await this.#client
      .from('conversation_members')
      .update(patch, { count: 'exact' })
      .eq('user_id', me)
      .in('conversation_id', conversationIds);

    if (error) throw error;
    if (!count) throw new Error('No conversations were updated.');
  }

  /** Re-reads the affected rows so the list reflects what the server now says. */
  async #refresh(conversationIds: ConversationId[]): Promise<void> {
    for (const id of conversationIds) {
      const conversation = await this.getConversation(id);
      if (conversation) this.#emit({ type: 'conversation:updated', conversation });
      // Gone from this member's list - archived away, or deleted.
      else this.#emit({ type: 'conversation:removed', conversationId: id });
    }
  }

  // -- custom lists ----------------------------------------------------------

  async listChatLists(): Promise<ChatList[]> {
    const me = await this.#userId();

    const [{ data: lists }, { data: members }] = await Promise.all([
      this.#client.from('chat_lists').select('*').eq('owner_id', me).order('name'),
      // RLS already restricts this to lists I own, so no second filter is needed.
      this.#client.from('chat_list_members').select('list_id'),
    ]);

    const counts = new Map<string, number>();
    for (const row of members ?? []) {
      counts.set(row.list_id, (counts.get(row.list_id) ?? 0) + 1);
    }

    return (lists ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      count: counts.get(row.id) ?? 0,
    }));
  }

  async createChatList(name: string): Promise<ChatList> {
    const me = await this.#userId();
    const { data, error } = await this.#client
      .from('chat_lists')
      .insert({ owner_id: me, name: name.trim() })
      .select()
      .single();

    if (error) throw error;
    return { id: data.id, name: data.name, count: 0 };
  }

  async renameChatList(listId: string, name: string): Promise<void> {
    const { error } = await this.#client
      .from('chat_lists')
      .update({ name: name.trim() })
      .eq('id', listId);
    if (error) throw error;
  }

  async deleteChatList(listId: string): Promise<void> {
    // Membership rows go with it by cascade; the conversations are untouched,
    // because a list is a view of chats rather than a container holding them.
    const { error } = await this.#client.from('chat_lists').delete().eq('id', listId);
    if (error) throw error;
  }

  async setChatListMembership(
    listId: string,
    conversationIds: ConversationId[],
    member: boolean,
  ): Promise<void> {
    if (conversationIds.length === 0) return;

    if (member) {
      const { error } = await this.#client
        .from('chat_list_members')
        .upsert(
          conversationIds.map((conversation_id) => ({ list_id: listId, conversation_id })),
          // Filing a chat twice is not an error, it is a no-op.
          { onConflict: 'list_id,conversation_id', ignoreDuplicates: true },
        );
      if (error) throw error;
    } else {
      const { error } = await this.#client
        .from('chat_list_members')
        .delete()
        .eq('list_id', listId)
        .in('conversation_id', conversationIds);
      if (error) throw error;
    }

    await this.#refresh(conversationIds);
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
    /*
     * Only the newest page is cached, and only that page is served offline.
     *
     * A `before` cursor is a request for history that is not held locally  - 
     * answering it from a cache of the newest fifty would hand back the wrong
     * messages and let the caller believe it had paged. So paging simply fails
     * offline, which the thread already renders as "no more history".
     */
    if (options?.before) return this.#listMessagesFromNetwork(conversationId, options);

    /*
     * Milestone 3: ask what changed, not for the page again.
     *
     * The old path refetched fifty messages every time a conversation was
     * opened, whether or not anything had happened in it. This asks a single
     * indexed question instead - and for a quiet conversation the answer is
     * zero rows, so opening it costs one small query rather than a page of
     * history and a page of decryption.
     *
     * Everything here is conditional on already having a trustworthy local
     * copy. Without a cursor, without a cached page, or if the delta cannot be
     * answered cleanly, it falls through to the full fetch below, which is
     * slower and always correct. That asymmetry is deliberate: the fast path
     * is allowed to decline, and the correct path is not allowed to be skipped.
     */
    const cursor = await this.#syncCursor(conversationId);
    const cached = cursor ? await this.cachedMessages(conversationId) : undefined;

    /*
     * A cached page carrying the placeholder is not an answer.
     *
     * `openRow` writes "sent before you added this device" into the body when a
     * message cannot be opened, and a page holding one used to be corrected by
     * the next open, because every open refetched. The delta path removed that
     * safety net: when nothing has changed it returns the cached page and asks
     * the server for nothing, so a placeholder that reached the disk once was
     * served forever and the real message never came back.
     *
     * Declining here costs one fetch and is the difference between a temporary
     * failure and a permanent one.
     */
    const poisoned = cached?.some((message) => message.body === UNREADABLE) ?? false;

    if (cursor && cached && !poisoned) {
      const changed = await this.#deltaMessages(conversationId, cursor);

      if (changed) {
        if (changed.length === 0) {
          // Nothing has happened here since last time. The cached page is the
          // answer, and no message was fetched or decrypted to establish that.
          this.#deltaStats.hits += 1;
          return cached;
        }

        const decrypted = await openRows(changed);
        if (decrypted) {
          const merged = mergeMessages(cached, changed.map((row) => toMessage(row, undefined)));
          this.#deltaStats.hits += 1;
          this.#deltaStats.rowsFetched += changed.length;

          void sealRecord(merged).then((sealed) =>
            localSet(STORE.messages, conversationId, sealed),
          );
          void writeMessageRows(conversationId, merged);
          void this.#setSyncCursor(conversationId, newestUpdatedAt(changed, cursor));

          return this.#signPhotos(changed, merged);
        }
      }
    }

    this.#deltaStats.misses += 1;

    try {
      const live = await this.#listMessagesFromNetwork(conversationId, options);
      // Sealed with this device's database key before it reaches the disk.
      /*
       * Only cache what was fully readable.
       *
       * A page containing a placeholder must not be written to disk: the
       * placeholder would be served ahead of the network next time and a
       * temporary decryption failure would look permanent. Skipping the write
       * costs one refetch and keeps the message recoverable.
       */
      if (this.#pageFullyDecrypted) {
        void sealRecord(live).then((sealed) => localSet(STORE.messages, conversationId, sealed));

        /*
         * Milestone 2: the same page, written again as individual rows.
         *
         * Beside the blob rather than instead of it. Nothing reads these for
         * display yet - they exist so the two representations can be compared
         * on real data before anything depends on the new one. A storage
         * migration nobody can check is one that loses messages quietly.
         *
         * Not awaited, and failures inside are swallowed: a shadow copy under
         * evaluation must not be able to affect what the user sees.
         */
        void writeMessageRows(conversationId, live).then((written) =>
          verifyRowStore(conversationId, live).then((integrity) => {
            this.#rowStoreIntegrity.set(conversationId, { ...integrity, written });
          }),
        );

        /*
         * Seed the cursor from what was just stored, so the next open can take
         * the delta path. Set only when the page decrypted completely - a
         * cursor implies the local copy is trustworthy, and claiming that over
         * a page with a placeholder in it would let the delta path skip past
         * the very message that failed.
         */
        void this.#setSyncCursor(conversationId, this.#pageNewestUpdatedAt);
      } else {
        // Drop any previously poisoned copy, so the stale placeholder cannot
        // outlive the failure that produced it.
        void localDelete(STORE.messages, conversationId);
      }
      return live;
    } catch (cause) {
      const cached = await openRecord<Message[]>(
        await localGet<unknown>(STORE.messages, conversationId),
      );
      if (cached) return cached;
      throw cause;
    }
  }

  /**
   * The last completed load, from disk. Sealed, like everything else here.
   *
   * Costs one IndexedDB read and one AES-GCM decrypt - measured at 0.41ms for
   * a comparable record - against a median 2311.8ms for the three network
   * calls it stands in for. That ratio is the entire point of this method.
   */
  async cachedStartup(): Promise<StartupSnapshot | undefined> {
    const snapshot = await openRecord<StartupSnapshot>(
      await localGet<unknown>(STORE.meta, 'startup'),
    );

    // A snapshot with no conversations is indistinguishable from a fresh
    // account, and painting an empty list that fills in a second later is
    // worse than waiting. Treated as absent.
    return snapshot && snapshot.conversations.length > 0 ? snapshot : undefined;
  }

  async cacheStartup(snapshot: StartupSnapshot): Promise<void> {
    await localSet(STORE.meta, 'startup', await sealRecord(snapshot));
  }

  async cachedMessages(conversationId: ConversationId): Promise<Message[] | undefined> {
    const cached = await openRecord<Message[]>(
      await localGet<unknown>(STORE.messages, conversationId),
    );

    // An empty array is not worth rendering - it looks like an empty chat, and
    // an empty chat that turns out to have fifty messages is a worse first
    // frame than a brief spinner.
    return cached && cached.length > 0 ? cached : undefined;
  }

  /**
   * Everything that changed in this conversation since we last looked.
   *
   * One cursor, not two, because `updated_at` already covers both cases: an
   * insert defaults it to now and the trigger moves it on any edit or
   * deletion. So a single `updated_at > cursor` returns new messages *and*
   * messages whose text changed, which is the whole reason that column exists.
   *
   * Returns `undefined` when the answer cannot be trusted - no cursor yet, an
   * error, or a full page of changes, which means more remain and merging a
   * partial answer would leave a hole no later sync would notice. The caller
   * falls back to a normal fetch, which is slower and always correct.
   */
  async #deltaMessages(
    conversationId: ConversationId,
    since: string,
  ): Promise<MessageRow[] | undefined> {
    const { data, error } = await this.#client
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(DELTA_LIMIT);

    if (error || !data) return undefined;
    // A full page means there is more; a gap is worse than a slow path.
    if (data.length >= DELTA_LIMIT) return undefined;
    return data;
  }

  /** The newest `updated_at` this device has stored for a conversation. */
  async #syncCursor(conversationId: ConversationId): Promise<string | undefined> {
    return openRecord<string>(await localGet<unknown>(STORE.meta, `sync:${conversationId}`));
  }

  async #setSyncCursor(conversationId: ConversationId, at: string): Promise<void> {
    await localSet(STORE.meta, `sync:${conversationId}`, await sealRecord(at));
  }

  async #listMessagesFromNetwork(
    conversationId: ConversationId,
    options?: { limit?: number; before?: MessageId },
  ): Promise<Message[]> {
    /*
     * Opening a thread is what subscribes to its typing channel. Doing it here
     * rather than in the UI means every screen that shows a conversation gets
     * it, and none of them has to remember to.
     */
    this.#presenceHub.watchTyping(conversationId);

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

    /*
     * What I deleted for myself.
     *
     * RLS cannot filter this - the row is still legitimately mine to read, and
     * the other people in the thread must keep seeing it. So the hiding is a
     * join the client does, and the cache keeps a live removal from reappearing
     * when the thread is reopened.
     */
    const { data: hiddenRows } = await this.#client
      .from('hidden_messages')
      .select('message_id')
      .eq('user_id', me);
    for (const row of hiddenRows ?? []) this.#hidden.add(row.message_id);

    const limit = options?.limit ?? 50;

    /** Newest-first while paging; reversed once the page is complete. */
    const collected: MessageRow[] = [];
    let cursor: string | undefined;

    if (options?.before) {
      const { data: anchor } = await this.#client
        .from('messages')
        .select('created_at')
        .eq('id', options.before)
        .maybeSingle();
      // No anchor means the cursor names a message this reader cannot see, and
      // paging from the newest end would silently hand back the wrong page.
      if (!anchor) return [];
      cursor = anchor.created_at;
    }

    /*
     * Keep reading until the page is full, or the thread runs out.
     *
     * The hidden filter runs after the database limit, so a raw page of 50
     * containing two of my own deletions yields 48 - and a caller deciding
     * "fewer than asked for means there is no more history" would stop early
     * and lose everything before it. Filling the page here keeps that test
     * true, which is what the whole pagination contract rests on.
     */
    for (let attempt = 0; collected.length < limit && attempt < MAX_PAGE_READS; attempt++) {
      let query = this.#client
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (cursor) query = query.lt('created_at', cursor);

      const { data } = await query;
      const batch = data ?? [];
      // A short read from the database itself is the real end of the thread.
      if (batch.length === 0) break;

      collected.push(...batch.filter((row) => !this.#hidden.has(row.id)));
      cursor = batch[batch.length - 1]!.created_at;
      if (batch.length < limit) break;
    }

    const rows = collected.slice(0, limit).reverse();

    /*
     * Reactions for the whole page in one query.
     *
     * `Message.reactions` is the single source of truth, so the bar renders
     * from the model and never asks the server what the current state is - the
     * shape already carries all three things it needs: grouped by emoji, count
     * from `userIds.length`, and "mine" from whether my id is in there.
     */
    const reactions = await this.#reactionsFor(rows.map((row) => row.id));
    // The cache is filled here and mutated from then on. docs/13 § 8.1.
    for (const row of rows) this.#reactions.set(row.id, reactions.get(row.id) ?? []);

    // Decrypted as a batch before anything reads a body. Concurrent, because
    // each row carries its own wrapped key and none depends on another.
    // Whether every row opened decides whether this page may be cached. See
    // openRows: caching a page that failed to decrypt makes the placeholder
    // permanent.
    this.#pageFullyDecrypted = await openRows(rows);
    // The high-water mark this page establishes, for the delta on the next open.
    this.#pageNewestUpdatedAt = newestUpdatedAt(rows, EPOCH);

    // Fetched newest-first for the limit; returned newest-last so the UI can
    // append without re-sorting.
    const page = rows.map((row) => ({
      ...toMessage(row, row.sender_id === me ? theirReadAt : undefined),
      reactions: this.#reactions.get(row.id) ?? [],
    }));

    return this.#signPhotos(rows, page);
  }

  /**
   * Reconciles one incoming reaction change. docs/13 § 8.2-8.3.
   *
   * For somebody else's change there is nothing to reconcile - apply it. For
   * our own, it is a confirmation, and the three cases are: it matches the
   * newest intent (clear pending), it does not but something newer is still in
   * flight (ignore - that echo is still coming), or nothing is pending (the
   * server has the truth and we do not).
   */
  async #onReactionChange(
    messageId: MessageId,
    userId: UserId,
    emoji: string | undefined,
  ): Promise<void> {
    const me = await this.#userId().catch(() => undefined);
    const pending = this.#pending.get(messageId);

    if (userId === me && pending) {
      if (pending.emoji === emoji) this.#pending.delete(messageId);
      // Newer intent outstanding: its own echo decides, not this one.
      else return;
    }

    this.#applyLocal(messageId, userId, emoji);
    this.#emitFromCache(messageId, await this.#messageRow(messageId));
  }

  /** Applies one person's choice to a message's grouped reactions. */
  #applyLocal(messageId: MessageId, userId: UserId, emoji: string | undefined): void {
    const list = (this.#reactions.get(messageId) ?? []).map((r) => ({
      emoji: r.emoji,
      userIds: r.userIds.filter((id) => id !== userId),
    }));

    if (emoji) {
      const group = list.find((r) => r.emoji === emoji);
      if (group) group.userIds.push(userId);
      else list.push({ emoji, userIds: [userId] });
    }

    // Emptied groups are dropped here; the UI animates them out before this
    // lands, which is why removal is not visible as a jump.
    this.#reactions.set(
      messageId,
      list.filter((r) => r.userIds.length > 0),
    );
  }

  /** What this user currently has on a message, per the cache. */
  #mine(messageId: MessageId, userId: UserId): string | undefined {
    return this.#reactions.get(messageId)?.find((r) => r.userIds.includes(userId))?.emoji;
  }

  /**
   * Re-emits a message from the cache, without reading it back.
   *
   * docs/13 § 8.1: no reads after a successful toggle. The row itself has not
   * changed - only its reactions have - so re-fetching it would be asking the
   * server to repeat something we already know.
   */
  #emitFromCache(messageId: MessageId, base: Message): void {
    this.#emit({
      type: 'message:updated',
      message: { ...base, reactions: this.#reactions.get(messageId) ?? [] },
    });
  }

  /** Grouped by emoji, in the shape `Message.reactions` already expects. */
  async #reactionsFor(messageIds: MessageId[]): Promise<Map<MessageId, Reaction[]>> {
    const grouped = new Map<MessageId, Reaction[]>();
    if (messageIds.length === 0) return grouped;

    const { data } = await this.#client
      .from('message_reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', messageIds);

    for (const row of data ?? []) {
      const list = grouped.get(row.message_id) ?? [];
      const existing = list.find((r) => r.emoji === row.emoji);
      if (existing) existing.userIds.push(row.user_id);
      else list.push({ emoji: row.emoji, userIds: [row.user_id] });
      grouped.set(row.message_id, list);
    }

    return grouped;
  }

  // -- sending -------------------------------------------------------------

  /**
   * Puts a snap in the private bucket and returns its **path**, not a URL.
   *
   * A signed URL stored on the message would be a copy the viewer keeps, and
   * the two-view limit would mean nothing. The path is useless on its own - a
   * URL is minted per view by `openPing`, and minting it is what spends one.
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

  async #uploadPhoto(image: Blob): Promise<string> {
    const me = await this.#userId();
    // The uploader's id leads the path, which is what the storage policy checks.
    const path = `${me}/${crypto.randomUUID()}.jpg`;

    const { error } = await this.#client.storage
      .from(PHOTO_BUCKET)
      .upload(path, image, { contentType: image.type || 'image/jpeg' });

    if (error) throw error;
    return path;
  }

  /**
   * Signs every unlimited photo in a page, in one request.
   *
   * Limited photos are skipped deliberately: their URL only exists after the
   * reader spends a view, and handing one out here would let the picture be
   * seen without the limit ever being consulted.
   */
  async #signPhotos(rows: MessageRow[], messages: Message[]): Promise<Message[]> {
    const paths = rows
      .filter((row) => row.kind === 'photo' && row.photo_path && !row.view_limit)
      .map((row) => row.photo_path!);

    // No photos on this page still leaves the voice pass to run - returning
    // here outright would silently skip it for any thread of only voice notes.
    if (paths.length === 0) return this.#signVoice(rows, messages);

    const { data } = await this.#client.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);

    const urlByPath = new Map((data ?? []).map((entry) => [entry.path, entry.signedUrl]));

    const withPhotos = messages.map((message, index) => {
      const row = rows[index];
      if (!message.photo || !row?.photo_path) return message;
      const url = urlByPath.get(row.photo_path);
      return url ? { ...message, photo: { ...message.photo, url } } : message;
    });

    return this.#signVoice(rows, withPhotos);
  }

  /**
   * Fills in the URL on every voice note in a page, in one request.
   *
   * Separate from the photo pass only because they live in different buckets
   * and `createSignedUrls` signs one bucket at a time. A message can never be
   * both, so the two never contend.
   */
  async #signVoice(rows: MessageRow[], messages: Message[]): Promise<Message[]> {
    const paths = rows
      .filter((row) => row.kind === 'voice' && row.voice_path)
      .map((row) => row.voice_path!);

    if (paths.length === 0) return this.#signDocuments(rows, messages);

    const { data } = await this.#client.storage
      .from(VOICE_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);

    const urlByPath = new Map((data ?? []).map((entry) => [entry.path, entry.signedUrl]));

    const signed = messages.map((message, index) => {
      const row = rows[index];
      if (!row?.voice_path) return message;
      const url = urlByPath.get(row.voice_path);
      if (!url) return message;

      return {
        ...message,
        attachments: message.attachments.map((attachment) =>
          attachment.kind === 'audio' ? { ...attachment, url } : attachment,
        ),
      };
    });

    return this.#signDocuments(rows, signed);
  }

  /**
   * Fills in the URL on every document in a page, in one request.
   *
   * A third pass rather than a merged one, because `createSignedUrls` signs a
   * single bucket at a time. Each kind lives in its own bucket, and a message
   * is only ever one kind, so the passes never contend.
   */
  async #signDocuments(rows: MessageRow[], messages: Message[]): Promise<Message[]> {
    const paths = rows
      .filter((row) => row.kind === 'document' && row.file_path)
      .map((row) => row.file_path!);

    if (paths.length === 0) return messages;

    const { data } = await this.#client.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);

    const urlByPath = new Map((data ?? []).map((entry) => [entry.path, entry.signedUrl]));

    return messages.map((message, index) => {
      const row = rows[index];
      if (!row?.file_path) return message;
      const url = urlByPath.get(row.file_path);
      if (!url) return message;

      return {
        ...message,
        attachments: message.attachments.map((attachment) =>
          attachment.kind === 'file' ? { ...attachment, url } : attachment,
        ),
      };
    });
  }

  async #uploadVoice(audio: Blob): Promise<string> {
    const me = await this.#userId();
    // Extension follows the codec the browser actually produced, so the file is
    // playable when fetched back by something that trusts it.
    const extension = audio.type.includes('mp4') ? 'm4a' : 'webm';
    // The uploader's id leads the path, which is what the storage policy checks.
    const path = `${me}/${crypto.randomUUID()}.${extension}`;

    const { error } = await this.#client.storage
      .from(VOICE_BUCKET)
      .upload(path, audio, { contentType: audio.type || 'audio/webm' });

    if (error) throw error;
    return path;
  }

  async #uploadDocument(file: File): Promise<string> {
    const me = await this.#userId();
    /*
     * The original name is kept in a column, not in the path. Filenames carry
     * spaces, accents and slashes, and a storage key made from one is a key
     * that eventually fails to round-trip.
     */
    const path = me + '/' + crypto.randomUUID();

    const { error } = await this.#client.storage
      .from(DOCUMENT_BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream' });

    if (error) throw error;
    return path;
  }

  async openPhoto(
    messageId: MessageId,
  ): Promise<{ url: string; viewsLeft?: number } | undefined> {
    const { data, error } = await this.#client.rpc('open_photo', { target: messageId });
    const row = data?.[0];
    if (error || !row?.path) return undefined;

    const { data: signed } = await this.#client.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(row.path, PHOTO_URL_TTL_SECONDS);

    if (!signed?.signedUrl) return undefined;
    return {
      url: signed.signedUrl,
      ...(row.views_left !== null ? { viewsLeft: row.views_left } : {}),
    };
  }

  async openPing(messageId: MessageId): Promise<PingView | undefined> {
    const { data, error } = await this.#client.rpc('open_snap', { snap_id: messageId });
    const row = data?.[0];
    if (error || !row?.path) return undefined;

    /*
     * A minute. The URL only has to survive the fetch that follows it - anything
     * longer is a window in which a shared link still works after the Ping is
     * supposed to be gone.
     */
    const signed = await this.#client.storage
      .from(SNAP_BUCKET)
      .createSignedUrl(row.path, SNAP_URL_TTL_SECONDS);

    if (signed.error || !signed.data) return undefined;
    return { url: signed.data.signedUrl, viewsLeft: row.views_left };
  }

  async savePing(messageId: MessageId): Promise<Blob | undefined> {
    const opened = await this.openPing(messageId);
    if (!opened) return undefined;

    const response = await fetch(opened.url);
    if (!response.ok) return undefined;
    const blob = await response.blob();

    /*
     * Destroyed only once the bytes are in hand. Marking it saved first would
     * mean a dropped connection costs the receiver the Ping entirely.
     */
    await this.#client.rpc('download_snap', { snap_id: messageId });
    return blob;
  }

  async sendMessage(draft: OutgoingMessage): Promise<Message> {
    /*
     * Queued rather than refused when there is no connection.
     *
     * The message still appears in the thread - emitted below as `sending`  - 
     * and goes out on reconnect. Without this, a message typed in a tunnel is
     * lost with the tab, and that is exactly the message somebody assumes was
     * sent.
     *
     * Media is deliberately excluded. A photo or voice note is a file handle
     * that does not survive a reload, so queueing one would promise a delivery
     * the outbox cannot keep. Those still fail immediately and visibly.
     */
    const hasMedia = Boolean(
      draft.photo ?? draft.ping ?? draft.voice ?? draft.document ?? draft.sticker,
    );
    if (!navigator.onLine && !hasMedia) {
      const entry = await enqueue(draft);
      const queued: Message = {
        id: entry.id,
        conversationId: draft.conversationId,
        authorId: await this.#userId(),
        body: draft.body,
        createdAt: entry.queuedAt,
        status: 'sending',
        attachments: [],
        reactions: [],
        ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
      };
      this.#emit({ type: 'message:new', message: queued });
      return queued;
    }

    return this.#sendNow(draft);
  }

  async #sendNow(draft: OutgoingMessage): Promise<Message> {
    const me = await this.#userId();

    /*
     * Uploaded before the row is inserted, deliberately. A message row whose
     * media never arrived is a permanently broken bubble in someone's thread;
     * a failed upload that inserts nothing is a retry.
     */
    /*
     * A Ping's `views` chooses the mechanism, not merely a number.
     *
     * One or two goes down the ephemeral path: its own bucket, a path rather
     * than a URL on the row, and `open_ping` as the only way to the bytes.
     * `null` is Keep in Chat, which *is* a photo message - so it takes the
     * photo path rather than teaching the ephemeral one to never expire.
     */
    const keptPing = draft.ping && draft.ping.views === null ? draft.ping : undefined;
    const ephemeralPing = draft.ping && draft.ping.views !== null ? draft.ping : undefined;

    const snapPath = ephemeralPing ? await this.#uploadSnap(ephemeralPing.image) : undefined;
    const photoPath = draft.photo
      ? await this.#uploadPhoto(draft.photo.image)
      : keptPing
        ? await this.#uploadPhoto(keptPing.image)
        : undefined;
    const voicePath = draft.voice ? await this.#uploadVoice(draft.voice.audio) : undefined;
    const filePath = draft.document ? await this.#uploadDocument(draft.document.file) : undefined;
    const snapExpiry = snapPath
      ? new Date(Date.now() + SNAP_EXPIRY_MS).toISOString()
      : undefined;

    /*
     * Encrypted here, at the last moment before the row leaves.
     *
     * Everything above this line - uploads, ping paths, expiry - is about
     * media, which this phase does not encrypt yet. The body does, and doing it
     * at the insert rather than at the top of `sendMessage` means the offline
     * queue holds plaintext it can re-seal on flush, when the recipient list
     * may well have changed.
     */
    const sealed = await sealBody(this.#client, draft.conversationId, draft.body);

    const { data, error } = await this.#client
      .from('messages')
      .insert({
        conversation_id: draft.conversationId,
        sender_id: me,
        body: sealed.body,
        encryption: sealed.encryption,
        envelope: sealed.envelope,
        ...(draft.replyToId ? { reply_to_id: draft.replyToId } : {}),
        ...(draft.sticker ? { kind: 'sticker', media_url: draft.sticker.url } : {}),
        ...(filePath && draft.document
          ? {
              kind: 'document' as const,
              file_path: filePath,
              file_name: draft.document.file.name,
              file_size: draft.document.file.size,
              file_mime: draft.document.file.type,
            }
          : {}),
        ...(draft.location ? { kind: 'location' as const, meta: draft.location } : {}),
        ...(draft.contact ? { kind: 'contact' as const, meta: draft.contact } : {}),
        ...(draft.event ? { kind: 'event' as const, meta: draft.event } : {}),
        ...(draft.call ? { kind: 'call' as const, meta: draft.call } : {}),
        /*
         * A story reply stays an ordinary text message - no `kind` of its own.
         *
         * That is the point: the product has no story comments, and giving the
         * reply its own kind would be the first step towards inventing them.
         * The tag in `meta` is what lets the author's insights count replies
         * and lets the bubble say which story it is answering.
         */
        ...(draft.storyReply ? { meta: { storyId: draft.storyReply.storyId } } : {}),
        ...(voicePath && draft.voice
          ? {
              kind: 'voice' as const,
              voice_path: voicePath,
              voice_duration: draft.voice.seconds,
              voice_waveform: draft.voice.waveform,
            }
          : {}),
        ...(photoPath
          ? {
              kind: 'photo',
              photo_path: photoPath,
              ...(draft.photo?.viewLimit ? { view_limit: draft.photo.viewLimit } : {}),
            }
          : {}),
        ...(snapPath
          ? {
              kind: 'snap',
              /*
               * `media_url` is written but never read for this kind. It once
               * carried the snap's URL; the lifecycle moved to storing the path
               * and minting a signed URL per view, which is what made the limit
               * real. Kept populated because a row with neither is harder to
               * recognise in the database than one with a redundant copy.
               */
              media_url: snapPath,
              snap_path: snapPath,
              snap_expires_at: snapExpiry,
              // The sender's choice. `open_ping` clamps and defaults it.
              view_limit: ephemeralPing?.views ?? 2,
            }
          : {}),
      })
      .select('*')
      .single();

    if (error) throw error;

    /*
     * The row that came back holds the ciphertext this method just wrote, and
     * the sender already has the plaintext in hand. Putting it back is both
     * cheaper than a decrypt and immune to the one failure that would matter
     * here - a sender who cannot read their own message the instant they send
     * it has no way to tell that from the message not sending.
     */
    data.body = draft.body;

    // Signed here too, or the sender stares at their own photo as a blank frame
    // until the thread is reloaded.
    const [message] = await this.#signPhotos([data], [toMessage(data, undefined)]);
    if (!message) throw new Error('Message could not be prepared.');

    /*
     * Emitted here, not left to Realtime.
     *
     * `useMessages` sets no state of its own - its `send` awaits this and waits
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
    /*
     * Through the function rather than straight at the column.
     *
     * The cursor and its history have to move together - a client that updated
     * `last_read_at` on its own would leave no record of *when* it caught up,
     * and the message-info screen would have nothing to show. Doing both in one
     * `security definer` call also means the cursor cannot be set to a time the
     * caller did not earn.
     */
    await this.#client.rpc('mark_conversation_read', { conv: conversationId });

    const conversation = await this.getConversation(conversationId);
    if (conversation) this.#emit({ type: 'conversation:updated', conversation });
  }

  // -- groups ---------------------------------------------------------------
  //
  // Every one of these is an RPC rather than a table write, and for one reason:
  // each has a condition attached, and a condition about `conversation_members`
  // expressed as a policy *on* `conversation_members` is the recursion this
  // schema already hit once. The rules live in `security definer` functions;
  // the table stays readable and, apart from your own personal state, not
  // writable at all.

  async createGroup(input: {
    title: string;
    memberIds: UserId[];
    avatarUrl?: string;
  }): Promise<ConversationId> {
    const { data, error } = await this.#client.rpc('create_group', {
      title: input.title,
      member_ids: input.memberIds,
      avatar_url: input.avatarUrl ?? null,
    });
    if (error) throw groupError(error);

    const conversation = await this.getConversation(data as string);
    if (conversation) this.#emit({ type: 'conversation:updated', conversation });
    return data as string;
  }

  async addGroupMembers(conversationId: ConversationId, memberIds: UserId[]): Promise<void> {
    const { error } = await this.#client.rpc('add_group_members', {
      conv: conversationId,
      member_ids: memberIds,
    });
    if (error) throw groupError(error);
    await this.#announce(conversationId);
  }

  async removeGroupMember(conversationId: ConversationId, userId: UserId): Promise<void> {
    const { error } = await this.#client.rpc('remove_group_member', {
      conv: conversationId,
      target: userId,
    });
    if (error) throw groupError(error);
    await this.#announce(conversationId);
  }

  async leaveGroup(conversationId: ConversationId): Promise<void> {
    const { error } = await this.#client.rpc('leave_group', { conv: conversationId });
    if (error) throw groupError(error);
    // Not `#announce`: the row is gone from this person's list entirely, and
    // re-reading it would hand back nothing and leave the old one on screen.
    this.#emit({ type: 'conversation:removed', conversationId });
  }

  async setGroupAdmin(
    conversationId: ConversationId,
    userId: UserId,
    admin: boolean,
  ): Promise<void> {
    const { error } = await this.#client.rpc('set_group_admin', {
      conv: conversationId,
      target: userId,
      make_admin: admin,
    });
    if (error) throw groupError(error);
    await this.#announce(conversationId);
  }

  async updateGroup(
    conversationId: ConversationId,
    changes: { title: string; avatarUrl?: string },
  ): Promise<void> {
    const { error } = await this.#client.rpc('update_group', {
      conv: conversationId,
      title: changes.title,
      avatar_url: changes.avatarUrl ?? null,
    });
    if (error) throw groupError(error);
    await this.#announce(conversationId);
  }

  async groupInviteCode(conversationId: ConversationId): Promise<string> {
    const { data, error } = await this.#client.rpc('group_invite_code', {
      conv: conversationId,
    });
    if (error) throw groupError(error);
    return data as string;
  }

  async revokeGroupInvite(conversationId: ConversationId): Promise<void> {
    const { error } = await this.#client.rpc('revoke_group_invite', {
      conv: conversationId,
    });
    if (error) throw groupError(error);
  }

  async previewGroupInvite(code: string) {
    const { data } = await this.#client.rpc('preview_group_invite', { invite_code: code });
    const row = (data ?? [])[0] as
      | { conversation_id: string; title: string | null; avatar_url: string | null; member_count: number }
      | undefined;
    if (!row) return undefined;

    return {
      conversationId: row.conversation_id,
      title: row.title ?? 'Group',
      memberCount: row.member_count,
      ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    };
  }

  async joinGroupWithCode(code: string): Promise<ConversationId> {
    const { data, error } = await this.#client.rpc('join_group_with_code', {
      invite_code: code,
    });
    if (error) throw groupError(error);

    const conversation = await this.getConversation(data as string);
    if (conversation) this.#emit({ type: 'conversation:updated', conversation });
    return data as string;
  }

  /**
   * Re-reads a group and tells the app.
   *
   * A roster change is not a message, so nothing on the socket announces it  - 
   * without this, promoting somebody leaves the screen you did it from showing
   * the roles as they were.
   */
  /**
   * Sends everything queued, oldest first, and tells the app what went.
   *
   * Each message is re-emitted on success so the bubble that has been sitting
   * at 'sending' since a tunnel becomes a real message with the server's own
   * id and timestamp - otherwise the thread would hold a ghost that never
   * resolves and a duplicate would arrive beside it over realtime.
   */
  async #flushOutbox(): Promise<void> {
    await flush(async (draft) => {
      const sent = await this.#sendNow(draft);
      this.#emit({ type: 'message:new', message: sent });
    });
  }

  async #announce(conversationId: ConversationId): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (conversation) this.#emit({ type: 'conversation:updated', conversation });
  }

  /**
   * Everyone else's read cursor, newest state.
   *
   * Excludes me, so the thread never has to filter it and can never draw a
   * second tick because of its own reading.
   */
  async listReceipts(conversationId: ConversationId): Promise<ReadReceipt[]> {
    const me = await this.#userId();

    const { data } = await this.#client
      .from('conversation_members')
      .select('user_id,last_read_at')
      .eq('conversation_id', conversationId);

    return (data ?? [])
      .filter((row) => row.user_id !== me)
      .map((row) => ({ userId: row.user_id, readAt: Date.parse(row.last_read_at) }));
  }

  async messageReceipts(messageId: MessageId): Promise<MessageReceipt[]> {
    const { data } = await this.#client.rpc('message_receipts', { msg: messageId });
    const rows = (data ?? []) as { user_id: string; read_at: string | null }[];

    // The names come from the same cache the thread already filled, so opening
    // message info costs one round trip rather than one per reader.
    await this.#loadPeople(rows.map((row) => row.user_id));

    return rows.map((row) => ({
      userId: row.user_id,
      ...(row.read_at ? { readAt: Date.parse(row.read_at) } : {}),
    }));
  }

  /** Not persisted - typing needs a realtime presence channel, not a table. */
  async setTyping(conversationId: ConversationId, typing: boolean): Promise<void> {
    await this.#presenceHub.setTyping(conversationId, typing);
  }

  /**
   * Optimistic, then confirmed. docs/13 § 8.
   *
   * The client already knows whether the tap is an add, a swap or a remove, so
   * the cache is updated and emitted before the request leaves. The realtime
   * echo confirms rather than informs, and no read follows either one.
   *
   * On failure the cache is restored to what it was and the error is rethrown,
   * so the bar can put back the previous state rather than showing one the
   * server never accepted.
   */
  async toggleReaction(messageId: MessageId, emoji: string): Promise<Message> {
    const me = await this.#userId();
    const base = await this.#messageRow(messageId);

    const before = this.#mine(messageId, me);
    // Tapping what you already have removes it; anything else replaces it.
    const after = before === emoji ? undefined : emoji;

    const revision = ++this.#revision;
    this.#pending.set(messageId, { revision, emoji: after });

    this.#applyLocal(messageId, me, after);
    this.#emitFromCache(messageId, base);

    const { error } = await this.#client.rpc('toggle_reaction', {
      target: messageId,
      symbol: emoji,
    });

    if (error) {
      // Only roll back if nothing newer has been asked for since.
      if (this.#pending.get(messageId)?.revision === revision) {
        this.#pending.delete(messageId);
        this.#applyLocal(messageId, me, before);
        this.#emitFromCache(messageId, base);
      }
      throw error;
    }

    return { ...base, reactions: this.#reactions.get(messageId) ?? [] };
  }

  /** The row only - reactions come from the cache, never from a re-read. */
  async #messageRow(messageId: MessageId): Promise<Message> {
    const { data, error } = await this.#client
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error(`No message ${messageId}`);
    await openRow(data);
    return toMessage(data, undefined);
  }

  // -- message actions ------------------------------------------------------

  /*
   * Every one of these delegates the *rule* to the database. Who may edit, who
   * may delete for everyone, who may pin - all of it is enforced there, so a
   * client that gets it wrong is refused rather than obeyed.
   */

  /**
   * Edit re-seals, because the row it is replacing may be encrypted.
   *
   * Sending the new text as-is left `encryption` and the old envelope in place,
   * so the message described itself as ciphertext it no longer contained and
   * every reader -- including the author -- got the "sent before you added this
   * device" placeholder over a message that had just been edited. The server
   * cannot re-seal on our behalf, so it happens here, the same way it does on
   * send.
   */
  async editMessage(messageId: MessageId, body: string): Promise<void> {
    /*
     * The conversation is read first because sealing needs the recipient list,
     * and `editMessage` is given only a message id. One keyed lookup is a
     * cheaper price than widening the signature through every caller.
     */
    const { data, error } = await this.#client
      .from('messages')
      .select('conversation_id')
      .eq('id', messageId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error(`No message ${messageId}`);

    const sealed = await sealBody(this.#client, data.conversation_id, body);

    const { error: sealedError } = await this.#client.rpc('edit_message', {
      target: messageId,
      new_body: sealed.body,
      new_encryption: sealed.encryption,
      new_envelope: sealed.envelope,
    });

    if (sealedError) {
      /*
       * The four-argument function may not be deployed yet.
       *
       * Client and database ship separately, and PostgREST answers a call it
       * has no signature for with PGRST202 rather than anything more specific.
       * Failing outright here would take editing away entirely on a database
       * that is merely a migration behind, which is worse than the defect being
       * fixed. So an unencrypted body falls back to the two-argument form,
       * which is exactly what it did before and cannot corrupt a row that
       * carries no envelope.
       *
       * An encrypted body does *not* fall back. The old function leaves
       * `encryption` and the envelope in place while replacing the ciphertext
       * with something the envelope no longer describes, which is the bug this
       * whole change exists to remove. Refusing is the honest outcome: the edit
       * visibly does not happen, rather than silently destroying the message.
       */
      if (sealedError.code !== 'PGRST202') throw sealedError;

      if (sealed.encryption !== null) {
        throw new Error(
          'This chat is end-to-end encrypted and the server has not been updated to accept edited ciphertext yet. Your message has not been changed.',
        );
      }

      const { error: legacyError } = await this.#client.rpc('edit_message', {
        target: messageId,
        new_body: sealed.body,
      });
      if (legacyError) throw legacyError;
    }

    this.#emit({ type: 'message:updated', message: await this.#messageRow(messageId) });
  }

  async deleteMessage(messageId: MessageId, forEveryone: boolean): Promise<void> {
    await this.#client.rpc('delete_message', {
      target: messageId,
      for_everyone: forEveryone,
    });

    /*
     * Two different outcomes, so two different events.
     *
     * For everyone, the row is still there with an empty body and a
     * `deleted_at`, which every reader renders as a tombstone. For me, the row
     * is untouched and a `hidden_messages` entry says I should not see it - a
     * `message:updated` carrying the unchanged row would leave it on screen,
     * which is how this quietly did nothing before.
     */
    if (forEveryone) {
      this.#emit({ type: 'message:updated', message: await this.#messageRow(messageId) });
    } else {
      this.#hidden.add(messageId);
      this.#emit({ type: 'message:removed', messageId });
    }
  }

  async toggleStar(messageId: MessageId): Promise<boolean> {
    const me = await this.#userId();
    const { data } = await this.#client
      .from('starred_messages')
      .select('message_id')
      .eq('message_id', messageId)
      .eq('user_id', me)
      .maybeSingle();

    if (data) {
      await this.#client
        .from('starred_messages')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', me);
      return false;
    }

    await this.#client
      .from('starred_messages')
      .insert({ message_id: messageId, user_id: me });
    return true;
  }

  async togglePin(messageId: MessageId): Promise<boolean> {
    const me = await this.#userId();
    const { data: existing } = await this.#client
      .from('pinned_messages')
      .select('message_id')
      .eq('message_id', messageId)
      .maybeSingle();

    if (existing) {
      await this.#client.from('pinned_messages').delete().eq('message_id', messageId);
      return false;
    }

    // The conversation comes from the message rather than the caller, so a pin
    // cannot be filed against a thread the message is not in.
    const { data: row } = await this.#client
      .from('messages')
      .select('conversation_id')
      .eq('id', messageId)
      .maybeSingle();
    if (!row) return false;

    await this.#client.from('pinned_messages').insert({
      message_id: messageId,
      conversation_id: row.conversation_id,
      pinned_by: me,
    });
    return true;
  }

  async remindAboutMessage(messageId: MessageId, at: number): Promise<void> {
    const me = await this.#userId();
    await this.#client.from('message_reminders').insert({
      message_id: messageId,
      user_id: me,
      remind_at: new Date(at).toISOString(),
    });
  }

  async reportMessage(messageId: MessageId): Promise<void> {
    const me = await this.#userId();
    // Duplicates are a unique-constraint violation, and re-reporting is not an
    // error worth showing anyone - it means the same thing as reporting once.
    await this.#client
      .from('message_reports')
      .insert({ message_id: messageId, reporter_id: me });
  }

  // -- people --------------------------------------------------------------

  async getUser(id: UserId): Promise<User | undefined> {
    const cached = this.#people.get(id);
    if (cached) return cached;

    const [{ data }, lastSeen] = await Promise.all([
      this.#client.from('profiles').select('*').eq('id', id).maybeSingle(),
      this.#lastSeenFor([id]),
    ]);
    if (!data) return undefined;

    const user = toUser(data, lastSeen.get(id));
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

    /*
     * Called with an explicit row, never passed straight to `.map`.
     *
     * `.map(toUser)` hands the callback (value, index, array), so the moment
     * `toUser` grew a second parameter the array index started arriving as
     * `lastSeenAt` - and the first contact in the list reported "last seen
     * Jan 1", the epoch, rendered with total confidence.
     */
    const rows = data ?? [];
    const lastSeen = await this.#lastSeenFor(rows.map((row) => row.id));
    const users = rows.map((row) => toUser(row, lastSeen.get(row.id)));
    for (const user of users) this.#people.set(user.id, user);
    return users;
  }

  // -- not yet backed by schema -------------------------------------------

  /**
   * Every call, newest first, across every conversation this user is in.
   *
   * Reads the same rows the threads render. RLS on  already limits
   * this to conversations they belong to, so there is no second visibility rule
   * to keep in step with the first.
   */
  async listCalls(): Promise<CallRecord[]> {
    const me = await this.#userId();

    const { data } = await this.#client
      .from('messages')
      .select('*')
      .eq('kind', 'call')
      .order('created_at', { ascending: false })
      .limit(100);

    return (data ?? []).flatMap((row) => {
      const meta = row.meta as unknown as Message['call'];
      if (!meta) return [];

      // The author rang; everyone else was rung.
      const outgoing = row.sender_id === me;
      return [
        {
          id: row.id,
          kind: meta.callKind,
          direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
          outcome: meta.outcome,
          withUserId: outgoing ? meta.calleeId : row.sender_id,
          conversationId: row.conversation_id,
          startedAt: Date.parse(row.created_at),
          duration: meta.durationSeconds,
        },
      ];
    });
  }

  async logCall(entry: {
    conversationId: string;
    calleeId: string;
    callKind: 'voice' | 'video';
    outcome: CallOutcome;
    durationSeconds: number;
  }): Promise<void> {
    /*
     * Sent as an ordinary message, so it lands in the thread, reaches the other
     * end over realtime, and updates the conversation list - all the machinery
     * a call log needs already exists for messages.
     */
    await this.sendMessage({
      conversationId: entry.conversationId,
      body: '',
      call: {
        callKind: entry.callKind,
        outcome: entry.outcome,
        durationSeconds: entry.durationSeconds,
        calleeId: entry.calleeId,
      },
    });
  }

  /** No gallery table. */
  async listGallery(): Promise<GalleryItem[]> {
    return [];
  }

  /** No moments table. */
  async listMoments(): Promise<Moment[]> {
    return [];
  }

  /** No notifications table - push is delivered, not stored, for now. */
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
      /*
       * The column still says `snap`; the product says Ping.
       *
       * Renamed on the way out rather than in the database. A migration over
       * live notification rows buys nothing a reader would notice, and the one
       * thing it could do is fail halfway.
       */
      const kind = row.kind === 'snap' ? ('ping' as const) : row.kind;
      const copy = NOTIFICATION_COPY[kind] ?? { title: who, body: 'Something happened.' };

      return {
        id: row.id,
        kind,
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
   * Not on `ChatService` yet - starting a conversation is a Phase 3 screen that
   * does not exist. It is here because the RPC does, and because the first
   * thing anyone will want to do with this service is talk to somebody.
   */
  async startDirectConversation(otherUserId: UserId): Promise<ConversationId> {
    const { data, error } = await this.#client.rpc('start_direct_conversation', {
      other_user: otherUserId,
    });

    if (error) throw error;

    /*
     * Announce it before returning.
     *
     * The RPC creates the conversation server-side, but the client's list is
     * whatever it last fetched - so navigating straight to `/chats/{id}` found
     * no conversation and rendered nothing. The caller had done everything
     * right and landed on an empty screen.
     *
     * Realtime does not cover this: it carries message inserts, not
     * conversation ones, and there is no message yet.
     */
    const conversation = await this.getConversation(data);
    if (conversation) this.#emit({ type: 'conversation:updated', conversation });

    return data;
  }
}
