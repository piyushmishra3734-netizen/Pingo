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
  PresenceState,
} from '@pingo/core';

import {
  openRecord,
  openRow,
  openRows,
  UNREADABLE,
  publishDeviceKey,
  purgeUnsealedCache,
  readMessageRowsBefore,
  verifyRowStore,
  writeMessageRows,
  type RowStoreIntegrity,
  sealBody,
  sealRecord,
} from '../crypto/session.js';
import { deviceIdentity } from '../crypto/keys.js';
import { shouldTrustCache } from '../egress-rules.js';
import { callRecordFrom } from '../../features/calls/call-log-rules.js';
import {
  STORE,
  extendRun,
  localDelete,
  localGet,
  localSet,
  messageRowKey,
  type RowRun,
} from '../local/db.js';
import { enqueue, flush } from '../local/outbox.js';
import { hasHeldRead, heldRead, holdRead, releaseRead } from '../../features/chat/read-cursor.js';
import { startMediaReaper, uploadClaims } from '../../features/chat/media-reaper.js';
import { mediaTooLarge, type MediaKind } from '@pingo/core';
import { cachePrivacyRules, readReceiptsOn } from '../../features/settings/privacy-flags.js';
import { getSupabaseClient, type PingoSupabaseClient } from './client.js';
import { startHeartbeat } from '../../features/presence/heartbeat.js';
import { PresenceHub, type ChatActivity } from './presence.js';
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
    presence: presenceFrom(lastSeenAt ?? Date.parse(row.created_at)),
  };
}

/**
 * How long after somebody's last heartbeat they are still called online.
 *
 * The heartbeat runs once a minute while the app is in front, so two minutes is
 * one missed beat plus room for a slow write - long enough that a tunnel or a
 * lock screen does not blink somebody offline and back, short enough that
 * "online" still means they are there. A person who quits is grey within two
 * minutes, which is the promise this makes.
 */
const PRESENCE_WINDOW_MS = 120_000;

/**
 * Presence from a timestamp, for everyone Realtime has not spoken about.
 *
 * This used to be a flat `offline`, on the reasoning that a green dot which
 * means nothing is worse than no dot at all. That was right when the column
 * behind it was the moment a session *started* - it could be hours stale and
 * said nothing about now. With a heartbeat keeping it to within a minute the
 * same column answers the question honestly, and a socket is no longer the only
 * evidence that somebody is here: presence is missed entirely for anyone whose
 * roster row loads before their presence event, and for anyone connected to a
 * different realtime node.
 *
 * A live socket still overrides this wherever there is one - it is instant and
 * this is not.
 */
function presenceFrom(lastSeenAt: number): { state: PresenceState; lastSeenAt: number } {
  const fresh = Number.isFinite(lastSeenAt) && Date.now() - lastSeenAt < PRESENCE_WINDOW_MS;
  return { state: fresh ? 'online' : 'offline', lastSeenAt };
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

/** Postgres real[] sometimes arrives as a number[], sometimes as a stringy list. */
function normalizeWaveform(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v))
      .map((v) => Math.max(0, Math.min(1, v)));
  }
  if (typeof raw === 'string' && raw.length > 2) {
    try {
      const parsed = JSON.parse(raw.replace(/^\{/, '[').replace(/\}$/, ']')) as unknown;
      return normalizeWaveform(parsed);
    } catch {
      return [];
    }
  }
  return [];
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
        waveform: normalizeWaveform(row.voice_waveform),
        // Path survives even when the signed URL is empty or expires.
        storagePath: row.voice_path,
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
        storagePath: row.file_path,
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

/**
 * How long one conversation read answers for the next.
 *
 * A blink. Long enough to fold the burst of realtime events a single send
 * produces, short enough that nobody could observe a row being stale.
 */
const CONVERSATION_COALESCE_MS = 300;

/**
 * How many messages the cached page keeps as live ones are appended.
 *
 * Matches the page `useMessages` asks for, so a thread opened from cache shows
 * the same window it would have fetched. Larger would make every open slower
 * for history the screen does not show; smaller would drop messages that were
 * on screen a moment ago.
 */
const MESSAGE_PAGE_CACHE = 50;

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

/**
 * The stretch of storage keys a page occupies.
 *
 * A page from the server is gapless within itself, which is the only reason
 * any of this can be tracked cheaply: the run bookkeeping never has to inspect
 * a page, only its two ends.
 */
function runOf(conversationId: ConversationId, page: Message[]): RowRun {
  const oldest = page[0]!;
  const newest = page[page.length - 1]!;
  return {
    from: messageRowKey(conversationId, oldest.createdAt, oldest.id),
    to: messageRowKey(conversationId, newest.createdAt, newest.id),
  };
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

export function toMessage(row: MessageRow, readAt: number | undefined): Message {
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
    // Group membership lines ("Ali added Baani") — plaintext, centred captions.
    ...(row.kind === 'system' ? { system: true as const } : {}),
    ...(row.edited_at ? { editedAt: Date.parse(row.edited_at) } : {}),
    // The conversation's timer, stamped onto this message when it was sent. The
    // client hides it the moment this passes rather than waiting for the sweep.
    ...(row.expires_at ? { expiresAt: Date.parse(row.expires_at) } : {}),
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
      ? {
          photo: {
            ...(row.view_limit ? { viewLimit: row.view_limit } : {}),
            // Kept even though the URL is not: this is what a cached page
            // re-signs from once the hour is up.
            storagePath: row.photo_path,
          },
        }
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
    // Same shape of thing as a story reply: a note on an ordinary message
    // rather than a kind of its own, so it is keyed on presence, not on `kind`.
    ...((row.meta as { videoEdit?: Message['videoEdit'] } | null)?.videoEdit
      ? { videoEdit: (row.meta as { videoEdit: Message['videoEdit'] }).videoEdit }
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
 * A picture's file extension, from what it actually is.
 *
 * Anything unrecognised becomes `jpg`, which is what the upload's content type
 * falls back to as well - the name and the type saying the same wrong thing is
 * better than them disagreeing.
 */
function imageExtension(mime: string | undefined): string {
  const subtype = (mime ?? '').toLowerCase().split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return 'jpg';
  if (subtype === 'jpeg') return 'jpg';
  return /^[a-z0-9]+$/.test(subtype) ? subtype : 'jpg';
}

/**
 * The bucket key hiding inside a signed storage URL.
 *
 * For threads cached before the path was kept alongside the URL. Their entries
 * carry an expired URL and nothing to re-sign from, so without this they stay
 * broken until something else in the conversation changes - which on a quiet
 * chat may be never. The path is right there in the URL; taking it back is
 * exact, and it makes every already-cached thread heal on its next read.
 */
function pathFromSignedUrl(url: string | undefined, bucket: string): string | undefined {
  if (!url) return undefined;
  try {
    const { pathname } = new URL(url);
    const marker = `/object/sign/${bucket}/`;
    const at = pathname.indexOf(marker);
    if (at === -1) return undefined;
    return decodeURIComponent(pathname.slice(at + marker.length)) || undefined;
  } catch {
    // Not a URL we minted. Nothing to recover, and nothing to report either.
    return undefined;
  }
}

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
  mention: { body: 'mentioned you' },
  voice: { body: 'sent a voice note' },
  call: { body: 'missed call' },
  // No actor, so this one is the whole sentence rather than a predicate hung
  // off somebody's name - see how the feed composes the others.
  new_device: { body: 'A new device signed in to your account' },
};

/*
 * Both live in `features/ai/ai-mentions` now.
 *
 * `mentionsPingoAi` is the test that decides whether a group message is
 * encrypted at all, and it could not be asserted from here - importing this
 * module pulls in the Supabase client, which needs a browser. A rule that
 * important should be checkable without one.
 */
import { mentionsPingoAi, PINGO_AI_USER_ID } from '../../features/ai/ai-mentions.js';

export { mentionsPingoAi, PINGO_AI_USER_ID };

/**
 * Handles from a message body (`@anaya`, `@pingoai`).
 *
 * Used client-side for mention notifications: encrypted group bodies are not
 * readable on the server, so the sender resolves ids while plaintext is local
 * and ships them in `meta.mentionedUserIds`.
 */
export function extractMentionHandles(text: string): string[] {
  const found = new Set<string>();
  const re = /@([a-zA-Z0-9_]{2,32})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const handle = match[1]!.toLowerCase();
    // Both product forms of the bot — never a person to notify.
    if (handle === 'pingoai' || handle === 'pingo_ai') continue;
    found.add(handle);
  }
  return [...found];
}

export class SupabaseChatService implements ChatService {
  readonly #client: PingoSupabaseClient;

  #listeners = new Set<(event: ChatEvent) => void>();
  #connection: ConnectionState = 'connecting';
  #settings: UserSettings = { ...DEFAULT_SETTINGS };
  #channel: ReturnType<PingoSupabaseClient['channel']> | undefined;

  /** Cached so message mapping and conversation titles do not refetch people. */
  #people = new Map<UserId, User>();

  /**
   * Who the socket says is here, kept apart from the roster.
   *
   * Separate because the two are refreshed on different clocks: the roster is
   * re-read from the database and would otherwise overwrite live state every
   * time it loaded.
   */
  #livePresence = new Map<UserId, { state: PresenceState; lastSeenAt: number }>();

  /** Who is typing or recording, per conversation. Same argument as presence. */
  #liveTyping = new Map<ConversationId, { userIds: UserId[]; activity: ChatActivity }>();

  /**
   * AI conversation ids known to this session.
   *
   * Kind is also re-checked on the server row, but the set is the fast path and
   * a belt for cases where a re-select races membership. AI threads must never
   * go through E2EE - the model cannot read ciphertext.
   */
  #aiConversationIds = new Set<ConversationId>();
  /** The other answer, cached for the same reason. See `#isAiConversation`. */
  #nonAiConversationIds = new Set<ConversationId>();

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

  /**
   * The newest message of each conversation, as the list last drew it.
   *
   * Decrypted once and held, because a preview only changes when a new message
   * arrives or that one is edited - and both arrive by realtime, which is what
   * evicts from here. Without it every hydrate refetched the same twenty rows.
   */
  #previewRows = new Map<string, MessageRow>();

  /** Drops a preview whose message changed, so the next hydrate refetches it. */
  #forgetPreview(messageId: string): void {
    this.#previewRows.delete(messageId);
  }

  /**
   * The list rows as this session last built them.
   *
   * What lets an arriving message patch a conversation instead of rebuilding
   * it from fourteen queries. See `#bumpConversation`.
   */
  #known = new Map<ConversationId, Conversation>();

  /** The whole-list read in flight or just finished. See `listConversations`. */
  #conversationListRead: { at: number; work: Promise<Conversation[]> } | undefined;

  /** Conversation reads in flight or just finished. See `getConversation`. */
  #conversationReads = new Map<
    ConversationId,
    { at: number; work: Promise<Conversation | undefined> }
  >();

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
        /*
         * A person who has hidden their activity is never lit by this stream.
         *
         * Their own app does not track any more, so this only fires for a
         * client that has not been updated - and the reader is the one place
         * that can refuse an old build's broadcast. Silence, not "offline":
         * writing offline here would fight the roster's own answer for
         * everybody else who genuinely is away.
         */
        if (this.#hiddenActivityIds.has(userId)) return;

        const presence = { state, lastSeenAt: Date.now() };

        /*
         * Recorded whether or not the person is in the roster yet.
         *
         * This used to be `if (cached)`, and presence that arrived before the
         * contact list finished loading was simply dropped - then the roster
         * landed, wrote `offline` for everybody from the database, and the
         * online state was gone. Which of the two won came down to which
         * request returned first, so somebody was online "sometimes".
         *
         * The live map is the authority now: the socket knows who is here and
         * a table read never does.
         */
        this.#livePresence.set(userId, presence);

        const cached = this.#people.get(userId);
        if (cached) this.#people.set(userId, { ...cached, presence });
        this.#emit({ type: 'presence:changed', userId, presence });
      },
      onTyping: (conversationId, userIds, activity) => {
        this.#emit({ type: 'typing:changed', conversationId, userIds, activity });
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
      /*
       * The remembered id follows the session, or it becomes the way this
       * device serves one account's cache to the next person to sign in. Two
       * accounts on one phone is ordinary here, not exotic - `cachedStartup`
       * exists in the shape it does because of it.
       */
      this.#me = session?.user.id;

      if (session) {
        /*
         * The socket needs the user's token, and needs it again on every
         * refresh.
         *
         * This was never called. A Realtime connection opened without it
         * carries the anon key, so anything the socket does on the user's
         * behalf - presence `track`, a broadcast into a channel with policies
         * on `realtime.messages` - is done by nobody in particular. Worse, the
         * access token expires every hour (`jwt_expiry` in config.toml) and the
         * socket keeps the stale one: the channel stays "joined" and silently
         * stops carrying anything.
         *
         * That is the shape of the bug it caused. Presence appeared on one side
         * and not the other, depending on which socket happened to be
         * authorised when it tracked; typing arrived once and then never again.
         * Both look like intermittent bugs in two separate features and are one
         * missing line.
         *
         * `onAuthStateChange` fires on TOKEN_REFRESHED as well as sign-in,
         * which is exactly when this has to run.
         */
        this.#client.realtime.setAuth(session.access_token);

        this.#openChannel();
        this.#presenceHub.start(session.user.id);
      } else {
        this.#closeChannel();
        this.#presenceHub.stop();
      }
    });
    this.#authWatcher = data.subscription;

    /*
     * Coming back to the app has to rejoin everything.
     *
     * Android suspends a backgrounded WebView - timers stop, the websocket goes
     * with it - and nothing on the other side notices, so on resume the app
     * looks connected while carrying nothing. That is why messages, presence
     * and typing all appeared only after force-closing and reopening: a cold
     * start was the sole thing that ever rebuilt the socket.
     *
     * The browser has the same problem in a milder form when a tab sleeps, so
     * this is not gated on being native. `visibilitychange` covers the web and
     * Capacitor's `appStateChange` covers the app, because a WebView does not
     * reliably fire the former when the whole process is paused.
     *
     * `setAuth` first: the token may well have expired while away, and a
     * reconnect carrying a dead one rejoins into the same silence.
     */
    const resume = () => {
      void this.#client.auth.getSession().then(({ data: current }) => {
        if (!current.session) return;
        this.#client.realtime.setAuth(current.session.access_token);
        this.#closeChannel();
        this.#openChannel();
        this.#presenceHub.stop();
        this.#presenceHub.start(current.session.user.id);
      });
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resume();
    });

    /*
     * And the third way back: the network returning while the app is open.
     *
     * The other two triggers are both "the app came forward", which covers
     * closing and reopening but not the case somebody actually tests - sitting
     * on the chat list and turning airplane mode off. Nothing was listening for
     * that. The socket stayed closed, and because draining the outbox is keyed
     * on the socket reconnecting, a message queued offline stayed queued while
     * the person watched a working connection do nothing with it.
     *
     * `online` is not proof of reachability - it fires for a captive portal
     * too - but `resume` is idempotent and a subscribe that fails leaves the
     * state exactly where it was.
     */
    window.addEventListener('online', resume);

    void import('@capacitor/app')
      .then(({ App }) => {
        void App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) resume();
        });
      })
      .catch(() => undefined);

    // Covers the already-signed-in case, where the listener above fires late.
    void this.#client.auth.getSession().then(({ data: current }) => {
      if (current.session) {
        // Same reason as the listener above: an already-signed-in tab reaches
        // here instead, and a socket without the token is the same dead socket.
        this.#client.realtime.setAuth(current.session.access_token);
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

  /**
   * Who is signed in - answerable on a plane, and answerable without asking.
   *
   * ## What this used to be
   *
   * `auth.getUser()`, and nothing else. That call is documented as validating
   * the token *with the server*, which means it is a network round trip, and
   * this method is on the path of thirty-five others - including
   * `cachedStartup`, whose entire purpose is to paint the app from disk without
   * waiting for the network. It was measured against 2311.8ms of network calls
   * and then made to wait for one of its own.
   *
   * With the connection off it does not merely wait, it fails: `getUser`
   * returns a null user for a fetch error exactly as it does for a signed-out
   * session, and this threw `Not signed in.` on both. That single line is what
   * a cold launch in airplane mode actually hit, and it took three things down
   * with it - the conversation list never painted, because the throw landed in
   * an unhandled rejection; the notification feed could not reach its own
   * cache; and a message typed offline was queued to the outbox and *then*
   * reported as a failed send, which is the worst of both answers.
   *
   * ## Why the stored session is the right source
   *
   * The distinction `getUser` buys is whether the server agrees the token is
   * still valid. In a browser that is not a security boundary: every query this
   * id is used for is authorised again by RLS, against the token, on the
   * server. Someone editing their own session in devtools can mislead their own
   * interface and nothing else. So the id is read from the session that is
   * already on disk - and remembered, because it does not change while the app
   * is running, and thirty-five calls should not be thirty-five reads.
   *
   * The last resort is the id this device recorded for itself. A token expires
   * after an hour and refreshing one needs the network, so a cold launch the
   * next morning with no signal has a stored session that `getSession` will
   * decline to return. That is precisely the moment somebody opens the app on a
   * flight, and "who am I" is not a question that should need a server.
   */
  #me: string | undefined;

  async #resolveUserId(): Promise<string | undefined> {
    try {
      const { data } = await this.#client.auth.getSession();
      if (data.session?.user.id) return data.session.user.id;
    } catch {
      // A refresh it could not make. The disk still knows.
    }
    return openRecord<string>(await localGet<unknown>(STORE.meta, 'user-id'));
  }

  async #userId(): Promise<string> {
    const id = this.#me ?? (await this.#resolveUserId());
    if (!id) throw new Error('Not signed in.');

    if (this.#me !== id) {
      this.#me = id;
      // Sealed, like every other record. Cleared with the rest on sign-out,
      // which is what stops it answering for the previous account.
      void sealRecord(id).then((sealed) => localSet(STORE.meta, 'user-id', sealed));
    }

    /*
     * Publishing rides along with the first thing that needs an identity,
     * rather than being a step sign-in has to remember. It runs once per
     * session and never blocks: a device that has not published yet can still
     * read and send, it just cannot be encrypted *to* until it has.
     */
    void publishDeviceKey(this.#client, id);

    /*
     * And then keep that row's timestamp honest.
     *
     * `publishDeviceKey` is memoised, so it writes `last_seen_at` once per page
     * load - which is what made "last seen" report the moment the app was
     * opened rather than the moment the person left. The heartbeat is what
     * turns that column into an answer to the question the header actually
     * asks. Idempotent, so calling it on every session resolve is safe.
     */
    startHeartbeat();

    /*
     * And the collector, which is the other half of storage being a buffer.
     *
     * The database parks objects that have been delivered or have expired; only
     * their uploader can remove them, so the sweep runs here, quietly, a while
     * after launch. See `media-reaper.ts`.
     */
    startMediaReaper(this.#client);

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

  /**
   * Tear the channel down and build it again.
   *
   * `#openChannel` is deliberately idempotent - it returns early when a channel
   * exists - which is right for token refreshes and wrong for this: after the
   * OS has killed the socket the channel object is still there, still claiming
   * to be subscribed, and asking to open one is a no-op. Closing first is what
   * makes the reopen mean anything.
   */
  reconnect(): void {
    this.#closeChannel();
    this.#openChannel();
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
           * A new message is the conversation's new preview, so the one this
           * session is holding for that thread is no longer the newest.
           * Evicting by id is enough: the next hydrate asks for whatever the
           * preview row now names, and only that one is missing.
           */
          this.#forgetPreview(row.id);
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
              if (message) {
                void this.#appendToCachedPage(message);
                /*
                 * And as a row, so history stays complete without a fetch to
                 * rebuild it.
                 *
                 * Deliberately without extending the contiguous run - see
                 * `#extendRowRun`. A socket message is adjacent to the newest
                 * end only if the socket never dropped, and a dropped socket is
                 * exactly how a hole gets into the store. Writing the row is
                 * free; claiming it joins the run is not.
                 */
                void writeMessageRows(row.conversation_id, [message]);
                this.#emit({ type: 'message:new', message });
              }
            });

          /*
           * The list needs the new preview and a bumped position - and that is
           * all it needs, so it is patched rather than rebuilt.
           *
           * This used to refetch, on every device, for every message. See
           * `#bumpConversation` for what that cost. The refetch is still here
           * for the only case that needs it: a conversation this device has
           * never loaded, where there is nothing to patch.
           */
          void openRow(row)
            .then(() => this.#signPhotos([row], [toMessage(row, undefined)]))
            .then(async ([message]) => {
              if (!message) return;
              const mine = message.authorId === (await this.#userId().catch(() => undefined));
              const patched = this.#bumpConversation(row.conversation_id, message, mine);
              if (patched) {
                this.#emit({ type: 'conversation:updated', conversation: patched });
                return;
              }
              const rebuilt = await this.getConversation(row.conversation_id);
              if (rebuilt) this.#emit({ type: 'conversation:updated', conversation: rebuilt });
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
          // An edit or a deletion changes what the list should say under this
          // conversation's name, so the held copy has to go.
          this.#forgetPreview(row.id);
          // Signed for the same reason as the insert above.
          void openRow(row)
            .then(() => this.#signPhotos([row], [toMessage(row, undefined)]))
            .then(([signed]) => {
              if (!signed) return;
              /*
               * Over the stored row as well as onto the screen.
               *
               * The key is conversation, time and id - none of which an edit
               * changes - so this overwrites in place. Without it, an edit or a
               * "delete for everyone" would be corrected in the thread and then
               * undone the next time that message was paged back to from disk,
               * which is the one way local history could show text the sender
               * had retracted.
               */
              void writeMessageRows(row.conversation_id, [signed]);
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
      /*
       * The privacy rules, live.
       *
       * These are per account and the app caches them locally so the heartbeat
       * and the presence channel can read them without a query. A cache is only
       * as good as its news: switching activity status off on a phone left this
       * laptop broadcasting until something happened to re-read the row, which
       * is the "sometimes it does not update" - so the row itself is watched,
       * and `cachePrivacyRules` announces the change to whoever is listening.
       */
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'privacy_settings' },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { user_id?: string; online_status?: boolean }
            | null;
          if (!row?.user_id) return;

          void this.#userId().then((me) => {
            if (row.user_id === me) {
              cachePrivacyRules({ onlineStatus: row.online_status !== false });
            }
          });


          /*
           * Somebody else's rule changed: forget what was drawn for them.
           *
           * Turning it off has to take their dot away from everybody watching,
           * not only from their own screen - and turning it back on has to
           * bring it back without waiting for a reload.
           */
          if (row.online_status === false) this.#hiddenActivityIds.add(row.user_id);
          else this.#hiddenActivityIds.delete(row.user_id);

          const cached = this.#people.get(row.user_id);
          if (cached) {
            const presence =
              row.online_status === false
                ? ({ state: 'offline', lastSeenAt: cached.presence.lastSeenAt } as const)
                : cached.presence;
            this.#people.set(row.user_id, { ...cached, presence });
            this.#emit({ type: 'presence:changed', userId: row.user_id, presence });
          }
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
    for (const row of data ?? []) {
      const user = toUser(row, lastSeen.get(row.id));
      /*
       * Whatever the socket already told us wins over the row.
       *
       * `toUser` fills in `offline` from a `last_seen_at` column, which is the
       * best a table can do and is wrong the moment somebody is actually
       * connected. Without this overlay, loading the roster turned every online
       * person grey until their next presence event - which for somebody just
       * sitting in a chat could be minutes.
       */
      const live = this.#livePresence.get(row.id);
      this.#people.set(row.id, live ? { ...user, presence: live } : user);
    }
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

    const [keys, hidden] = await Promise.all([
      this.#client.from('device_keys').select('user_id,last_seen_at').in('user_id', ids),
      this.#hiddenActivity(ids),
    ]);

    if (keys.error || !keys.data) return newest;

    for (const row of keys.data) {
      /*
       * Somebody who has hidden their activity has no last-seen at all here.
       *
       * The switch is enforced three times in the publisher's app and once in
       * the database, and it is enforced again on this side because none of
       * those reach a client that has not been updated. A reader that refuses
       * to draw it closes the last hole: even if some old build is still
       * writing, nobody with a current app is shown the result.
       */
      if (hidden.has(row.user_id)) continue;
      const at = Date.parse(row.last_seen_at);
      if (!Number.isFinite(at)) continue;
      const seen = newest.get(row.user_id);
      if (seen === undefined || at > seen) newest.set(row.user_id, at);
    }
    return newest;
  }

  /**
   * Everyone in this list who has switched activity status off.
   *
   * `privacy_settings` is world-readable by policy, which is what makes this
   * possible: a rule about what may be shown has to be knowable by whoever is
   * doing the showing. Absent rows mean the default, which is on.
   */
  async #hiddenActivity(ids: UserId[]): Promise<Set<UserId>> {
    const hidden = new Set<UserId>();
    if (ids.length === 0) return hidden;

    const { data, error } = await this.#client
      .from('privacy_settings')
      .select('user_id,online_status')
      .in('user_id', ids);

    if (error || !data) return hidden;

    for (const row of data) {
      if (row.online_status === false) hidden.add(row.user_id);
    }
    this.#hiddenActivityIds = hidden;
    return hidden;
  }

  /**
   * The last answer, for the presence stream to consult.
   *
   * The channel fires per person and cannot wait on a query each time; the
   * roster load that already asked is close enough, and a stale entry only
   * costs one refresh.
   */
  #hiddenActivityIds = new Set<UserId>();

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
      /*
       * Through the trim, like every other read - and only for the ones this
       * session has not already seen.
       *
       * This was the last `select('*')` on messages. Trimming it took a page of
       * twenty previews from 54 kB to 20.5 kB, and then measurement showed the
       * far larger problem: it ran **seventeen times** in a six-navigation
       * session, because every hydrate re-fetched the same twenty rows. 348 kB
       * to learn nothing new.
       *
       * A preview is the newest message of a conversation. It changes when a
       * new one arrives or that one is edited, and both of those already come
       * through realtime - which is what `#forgetPreview` hangs off. So holding
       * them by id for the life of the session is not a guess about staleness;
       * it is the same event that would have changed the answer.
       */
      const wanted = lastMessageIds.filter((id) => !this.#previewRows.has(id));
      if (wanted.length > 0) {
        const fetched = await this.#fetchMessagesById(wanted);
        // The list's previews are ciphertext too. Without this the home screen
        // would show base64 under every name.
        await openRows(fetched);
        for (const row of fetched) this.#previewRows.set(row.id, row);
      }
      for (const id of lastMessageIds) {
        const row = this.#previewRows.get(id);
        if (row) lastById.set(id, row);
      }
    }

    await this.#loadPeople((members ?? []).map((m) => m.user_id));

    // AI face: global public identity (same for everyone) + optional personal prefs.
    const hasAi = rows.some((r) => r.kind === 'ai');
    const { data: aiProfiles } = hasAi
      ? await this.#client.from('ai_profiles').select('*').eq('user_id', me)
      : { data: [] as { user_id: string; display_name: string; avatar_url: string | null }[] };
    const aiByUser = new Map((aiProfiles ?? []).map((p) => [p.user_id, p]));

    const { data: aiPublicRows } = hasAi
      ? await this.#client.rpc('get_ai_public_identity')
      : { data: null as null };
    const aiPublic = Array.isArray(aiPublicRows)
      ? (aiPublicRows[0] as
          | {
              display_name: string;
              avatar_url: string | null;
              bio: string | null;
            }
          | undefined)
      : (aiPublicRows as
          | {
              display_name: string;
              avatar_url: string | null;
              bio: string | null;
            }
          | null);

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

        const aiProfile = row.kind === 'ai' ? aiByUser.get(me) : undefined;
        if (row.kind === 'ai') this.#aiConversationIds.add(row.id);

        // Global face first (owner default for everyone), personal name/avatar
        // only as optional polish on top.
        const aiTitle =
          aiProfile?.display_name?.trim() ||
          aiPublic?.display_name?.trim() ||
          row.title ||
          'PINGO';
        const aiAvatar =
          aiProfile?.avatar_url || aiPublic?.avatar_url || undefined;

        return {
          id: row.id,
          kind: row.kind,
          // A direct chat is titled by whoever else is in it, per viewer.
          // AI is a person-shaped row: name from prefs, not a "bot" label.
          title: row.kind === 'ai' ? aiTitle : (row.title ?? otherUser?.name ?? 'Conversation'),
          /*
           * A group's own picture, or the other person's.
           *
           * Checked in that order rather than merged: a group that has had its
           * picture removed must fall back to nothing, not to whichever member
           * happens to sort first - which would give the group a face belonging
           * to somebody who might later leave it.
           */
          ...(row.kind === 'ai' && aiAvatar
            ? { avatarUrl: aiAvatar }
            : row.avatar_url
              ? { avatarUrl: row.avatar_url }
              : otherUser?.avatarUrl
                ? { avatarUrl: otherUser.avatarUrl }
                : {}),
          ...((row.kind === 'group' || row.kind === 'community') && row.description
            ? { description: row.description }
            : {}),
          ...((row.kind === 'group' || row.kind === 'community') && row.cover_url
            ? { coverUrl: row.cover_url }
            : {}),
          participantIds: roster.map((m) => m.user_id),
          // Only groups have ranks, so a direct chat carries an empty list
          // rather than an absent field the screens would have to guard.
          adminIds: roster.filter((m) => m.role === 'admin').map((m) => m.user_id),
          // Shared room backdrop - direct chats keep wallpaper on-device only.
          ...((row.kind === 'group' || row.kind === 'community') && row.wallpaper_id
            ? { wallpaperId: row.wallpaper_id }
            : {}),
          ...((row.kind === 'group' || row.kind === 'community') && row.wallpaper_photo_url
            ? { wallpaperPhotoUrl: row.wallpaper_photo_url }
            : {}),
          // Every kind of conversation, unlike the wallpaper: a timer is about
          // what is kept, and a direct chat is where that matters most.
          ...(row.disappear_seconds ? { disappearSeconds: row.disappear_seconds } : {}),
          ...(last ? { lastMessage: toMessage(last, theirReadAt) } : {}),
          /*
           * Counted in SQL over the real rows, not over whatever this client
           * happened to have fetched - unless this device has read the thread
           * without telling anybody. The server cannot know about that cursor,
           * by design, so it is applied here: read after the last message means
           * nothing is unread, whatever the row says.
           */
          unreadCount:
            heldRead(row.id) >= (last ? parseTimestamp(last.created_at) : 0)
              ? 0
              : (preview?.unread_count ?? 0),
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
          /*
           * Whoever the socket says is typing, not an empty list.
           *
           * This was hardcoded to `[]`, and that is why typing appeared for a
           * moment and vanished. The indicator was set correctly by the
           * `typing:changed` event - and then the next conversation reload,
           * which realtime triggers constantly, rebuilt the row from the
           * database and wiped it. The dots lasted exactly until the next
           * refresh, which is usually a fraction of a second.
           *
           * Typing lives on the socket and no table has it, so a rebuild must
           * carry it across rather than assume nobody is there.
           */
          typingUserIds: [...(this.#liveTyping.get(row.id)?.userIds ?? [])],
          ...(this.#liveTyping.get(row.id)?.activity
            ? { typingActivity: this.#liveTyping.get(row.id)!.activity }
            : {}),
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
      })
      /*
       * Remembered on the way out, so an arriving message does not have to ask
       * the server what this conversation looks like - see `#bumpConversation`.
       */
      .map((conversation) => {
        this.#known.set(conversation.id, conversation);
        return conversation;
      });
  }

  /**
   * The list row for a conversation a message just landed in.
   *
   * ## Why this exists
   *
   * The realtime handler used to call `getConversation`, whose comment said
   * "only a refetch can produce a correctly-shaped `Conversation`". That was
   * true and it was expensive: a rebuild is fourteen queries, and it ran once
   * per arriving message **on every recipient's device**. Measured over 15.8
   * hours of ordinary production traffic, that path was running at roughly 450
   * hydrations an hour - about 6 MB an hour, or 4 GB a month, to learn things
   * that had not changed.
   *
   * Nothing a new message changes is worth fourteen queries. The title is the
   * same, the roster is the same, the wallpaper is the same. What moves is the
   * preview line, the position in the list, and the unread count.
   *
   * ## What it does not do
   *
   * Invent a row it has never seen. Without a cached copy this returns
   * undefined and the caller falls back to the refetch, which is correct for
   * the one case that genuinely needs it: a conversation this device has not
   * loaded yet.
   *
   * The unread count is incremented rather than re-counted, so it can drift
   * from the server's own tally between rebuilds. That is the same arithmetic
   * the read cursor already does locally, and any real hydrate corrects it.
   */
  #bumpConversation(
    conversationId: ConversationId,
    message: Message,
    mine: boolean,
  ): Conversation | undefined {
    const known = this.#known.get(conversationId);
    if (!known) return undefined;

    const next: Conversation = {
      ...known,
      lastMessage: message,
      updatedAt: message.createdAt,
      unreadCount: mine ? known.unreadCount : known.unreadCount + 1,
    };
    this.#known.set(conversationId, next);
    return next;
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
    /*
     * Keyed by account, not by the word "all".
     *
     * One record per device meant the offline fallback below could hand a
     * signed-in account the previous account's conversation list - the same
     * crossing as the startup snapshot, and the list carries a preview line
     * from every chat. Two accounts on one phone is the ordinary case here.
     */
    const key = await this.#userId();

    /*
     * A burst of these is one query.
     *
     * The same rule as `getConversation`, and for a bigger reason: this one is
     * nine queries across the whole list, and navigating between the list and a
     * thread ran it thirteen times in a six-navigation session. Callers within
     * the window share the answer; anything after it is a fresh read, so the
     * list is never stale by more than a blink.
     */
    const inFlight = this.#conversationListRead;
    if (inFlight && Date.now() - inFlight.at < CONVERSATION_COALESCE_MS) return inFlight.work;

    const work = this.#listConversationsOnce(key);
    this.#conversationListRead = { at: Date.now(), work };
    void work
      .catch(() => undefined)
      .finally(() => {
        window.setTimeout(() => {
          if (this.#conversationListRead?.work === work) this.#conversationListRead = undefined;
        }, CONVERSATION_COALESCE_MS);
      });
    return work;
  }

  /** The read itself, so the coalescing above stays readable. */
  async #listConversationsOnce(key: string): Promise<Conversation[]> {
    try {
      const live = await this.#listConversationsFromNetwork();
      // Sealed too. The list carries message previews, which is to say it
      // carries the first line of every conversation you have.
      void sealRecord(live).then((sealed) => localSet(STORE.conversations, key, sealed));
      return live;
    } catch (cause) {
      const cached = await openRecord<Conversation[]>(
        await localGet<unknown>(STORE.conversations, key),
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

  /**
   * One conversation, rebuilt from the server.
   *
   * ## Why a burst of these has to become one
   *
   * `#hydrate` is nine queries - the row, the roster, the profiles behind it,
   * the previews, the streaks, the lists, the AI profile, the privacy flags -
   * and almost every caller here is a realtime event. Opening one thread of
   * fifty messages produced thirty reads of `conversation_members`, nineteen of
   * `conversations`, nineteen `conversation_previews`, seventeen `profiles`:
   * 289 requests for 53 distinct URLs, because each arriving row announced
   * itself separately and each announcement re-read the whole list.
   *
   * So calls made while one is already running share its answer, and a call
   * made within a blink of one finishing gets that answer rather than starting
   * again. The window is deliberately short - long enough to fold a burst of
   * events from one send, far too short for anybody to see a stale row.
   */
  async getConversation(id: ConversationId): Promise<Conversation | undefined> {
    const pending = this.#conversationReads.get(id);
    if (pending && Date.now() - pending.at < CONVERSATION_COALESCE_MS) return pending.work;

    const work = (async () => {
      const me = await this.#userId();
      const { data } = await this.#client
        .from('conversations')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!data) return undefined;
      const [conversation] = await this.#hydrate([data], me);
      return conversation;
    })();

    this.#conversationReads.set(id, { at: Date.now(), work });

    /*
     * The entry is dropped once the window is up rather than kept and checked,
     * so a conversation nobody is looking at stops occupying memory - and a
     * failed read is never the answer a later caller gets.
     */
    void work
      .catch(() => undefined)
      .finally(() => {
        window.setTimeout(() => {
          if (this.#conversationReads.get(id)?.work === work) {
            this.#conversationReads.delete(id);
          }
        }, CONVERSATION_COALESCE_MS);
      });

    return work;
  }

  async listMessages(
    conversationId: ConversationId,
    options?: { limit?: number; before?: MessageId },
  ): Promise<Message[]> {
    if (options?.before) return this.#listOlder(conversationId, options);

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
     *
     * ## Once, though. Not for ever.
     *
     * The reasoning above holds for a placeholder a refetch could clear. It
     * does not hold for the case that actually produces most of them: a message
     * sent before this device existed carries no wrapped key for it, so the
     * bytes to open it do not exist anywhere and no number of refetches will
     * invent them. That page is poisoned permanently, and this gate therefore
     * disabled the delta path permanently with it - measured at two full pages
     * and 610 kB on every open of a conversation the device already held in
     * full, for ever.
     *
     * So the retry is bounded. One full fetch to clear a placeholder that can
     * be cleared, and after that the cached page is accepted for what it is:
     * the best answer that exists on this device.
     */
    const hasPlaceholder = cached?.some((message) => message.body === UNREADABLE) ?? false;
    const trusted = shouldTrustCache({
      hasPlaceholder,
      alreadyRetried: await this.#placeholderRetried(conversationId),
    });

    if (cursor && cached && trusted) {
      const changed = await this.#deltaMessages(conversationId, cursor);

      if (changed) {
        if (changed.length === 0) {
          // Nothing has happened here since last time. The cached page is the
          // answer, and no message was fetched or decrypted to establish that.
          this.#deltaStats.hits += 1;
          /*
           * Still signed, though.
           *
           * The messages are unchanged; their URLs are not. A signature lasts
           * an hour and this cache lasts until the thread changes, so a quiet
           * conversation came back with every photo pointing at an expired
           * URL - a thread of broken images, from the one path that returned
           * without signing anything.
           */
          return this.#signPhotos([], cached);
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
          void this.#extendRowRun(conversationId, runOf(conversationId, merged));
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
       *
       * ## And exactly one refetch
       *
       * "Costs one refetch" was the intention and not what happened. A message
       * sent before this device existed has no wrapped key for it anywhere, so
       * its placeholder is permanent - and this gate then refused to cache the
       * page containing it for ever. A conversation with one such message never
       * had a local copy at all: no cache, no cursor, and therefore two full
       * network pages on every single open.
       *
       * So the second attempt accepts the page. The placeholder is stored with
       * it, which is honest - it is what this device can actually read - and
       * the thread stops paying 610 kB to rediscover that every time.
       */
      const retried = await this.#placeholderRetried(conversationId);
      if (!this.#pageFullyDecrypted && !retried) {
        await this.#notePlaceholderRetry(conversationId);
      }

      if (this.#pageFullyDecrypted || retried) {
        void sealRecord(live).then((sealed) => localSet(STORE.messages, conversationId, sealed));

        /*
         * The same page, written again as individual rows.
         *
         * Beside the blob rather than instead of it: the blob is this page, the
         * rows are the history it is the newest end of. The integrity check
         * stays - it is what proved the two agree on real data before anything
         * was allowed to read the rows, and it costs nothing to keep proving.
         *
         * Not awaited, and failures inside are swallowed: a copy that cannot be
         * written must not be able to affect what the user sees.
         */
        void writeMessageRows(conversationId, live).then((written) =>
          verifyRowStore(conversationId, live).then((integrity) => {
            this.#rowStoreIntegrity.set(conversationId, { ...integrity, written });
          }),
        );

        // How far back the device can now be trusted to page from disk. This
        // stretch may or may not join what was already stored; `extendRun`
        // decides, and drops the run rather than welding it across a gap.
        // An empty conversation has no stretch and leaves the run alone.
        if (live.length > 0) void this.#extendRowRun(conversationId, runOf(conversationId, live));

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
    if (!snapshot || snapshot.conversations.length === 0) return undefined;

    /*
     * And it has to belong to whoever is signed in now.
     *
     * There is one snapshot per device, not one per account, so after
     * switching accounts this handed the new session the previous account's
     * conversations, contacts and profile - painted instantly, before any
     * network call could correct it. It is why switching appeared not to work
     * at all: you tapped a different face and arrived at the same chat list.
     *
     * It is also the more serious half of that bug. The cache is sealed to the
     * device rather than to the account, so it opens perfectly well for the
     * wrong person - two accounts on one phone is the ordinary case here, not
     * an exotic one.
     *
     * Discarded rather than deleted: the other account's snapshot is still
     * correct for the other account, and leaving it is what keeps switching
     * back fast.
     */
    const me = await this.#userId();
    return snapshot.currentUser.id === me ? snapshot : undefined;
  }

  async cacheStartup(snapshot: StartupSnapshot): Promise<void> {
    await localSet(STORE.meta, 'startup', await sealRecord(snapshot));
  }

  /**
   * Keeps the cached page current as messages arrive.
   *
   * The cache was only ever written by a network load, so a thread you were
   * *watching* went stale the moment somebody replied: the live message
   * rendered, the stored page did not change, and closing and reopening the
   * thread painted the page from before it - then the network answered and the
   * missing messages appeared. That is the "old chat loads first, then the new
   * one" report, and it is not a race worth tuning; the cache was simply wrong.
   *
   * Only for threads that already have a page. A conversation nobody has opened
   * has nothing to keep current, and writing one here would build a cache for
   * every conversation on the account from the socket alone.
   */
  async #appendToCachedPage(message: Message): Promise<void> {
    try {
      const cached = await openRecord<Message[]>(
        await localGet<unknown>(STORE.messages, message.conversationId),
      );
      if (!cached) return;
      if (cached.some((m) => m.id === message.id)) return;

      // Trimmed from the front: the page is the newest window, and letting it
      // grow without bound would make every open slower than the last.
      const next = [...cached, message].slice(-MESSAGE_PAGE_CACHE);
      await localSet(STORE.messages, message.conversationId, await sealRecord(next));
    } catch {
      // A cache that cannot be updated is a cache that will be corrected by the
      // next load. It must never break delivery.
    }
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
   * Scrolling back, from this device first.
   *
   * The row store already holds every message this device has ever fetched or
   * backfilled - it was written on every load and read by nothing but the
   * backup builder. So the history was on the disk the whole time, and paging
   * asked the server for it anyway, once per screenful, and could not answer at
   * all without a connection.
   *
   * ## A short local page is not an answer
   *
   * The thread stops paging when a page comes back shorter than it asked for,
   * because that is what the end of history looks like. Serving four stored
   * messages to a request for fifty would therefore end the scrollback
   * permanently, with two years of conversation still on the server. So the
   * local copy is served only when it fills the page, and a partial one falls
   * through to the network exactly as before.
   *
   * The one exception is when the network has nothing to add: no rows came
   * back, and the device is holding some. That is the offline case, and there a
   * short page is the best answer there is.
   *
   * ponytail: a message deleted for everyone *while paged past* keeps its
   * stored text until something re-reads that row. Live edits and deletions are
   * written through below, so this needs a device that was offline for the
   * deletion and never reopens the thread near it.
   */
  async #listOlder(
    conversationId: ConversationId,
    options: { limit?: number; before?: MessageId },
  ): Promise<Message[]> {
    const limit = options.limit ?? 50;
    const run = await this.#rowRun(conversationId);
    const stored = options.before
      ? await readMessageRowsBefore<Message>(conversationId, options.before, limit, run?.from)
      : undefined;

    // Deleted-for-me is a client-side join, and a stored row knows nothing
    // about it. Filtering here is what stops a message you removed from
    // reappearing the moment you scroll past it.
    const local = stored?.filter((message) => !this.#hidden.has(message.id));

    if (local && local.length >= limit) {
      this.#deltaStats.hits += 1;
      // Signed, because the URLs in a stored page expired an hour after it was
      // stored even though the messages did not.
      return this.#signPhotos([], local);
    }

    this.#deltaStats.misses += 1;

    try {
      const page = await this.#listMessagesFromNetwork(conversationId, options);

      /*
       * History that was paged in used to be thrown away when the thread
       * closed: only the newest page was ever written. Persisting it here is
       * what makes the second scroll back through a conversation free.
       *
       * The run's top is the anchor rather than the page's own newest message,
       * because the server returned exactly the rows below that anchor - they
       * join it by construction, and dating the stretch from its own newest
       * message would make it look separated from the run by one message and
       * throw the whole run away on every page.
       */
      if (page.length > 0 && this.#pageFullyDecrypted) {
        void writeMessageRows(conversationId, page);
        const stretch = runOf(conversationId, page);
        const joinsAnchor = run !== undefined && run.from.endsWith(`|${options.before}`);
        await this.#extendRowRun(
          conversationId,
          joinsAnchor ? { ...stretch, to: run.from } : stretch,
        );
      }

      if (page.length === 0 && local && local.length > 0) return this.#signPhotos([], local);
      return page;
    } catch (cause) {
      if (local && local.length > 0) return this.#signPhotos([], local);
      throw cause;
    }
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
    const data = await this.#fetchMessagePage(conversationId, {
      limit: DELTA_LIMIT,
      since,
    });

    if (!data) return undefined;
    // A full page means there is more; a gap is worse than a slow path.
    if (data.length >= DELTA_LIMIT) return undefined;
    return data;
  }

  /**
   * A page of message rows, carrying only this device's own wrapped key.
   *
   * ## Why it goes through an RPC
   *
   * `select('*')` shipped the whole `envelope`, which is 95% of a message row
   * and holds one wrapped content key per device that could ever open it -
   * 15.46 of them on average. This device reads exactly one. `messages_page`
   * returns the same rows RLS would return with the other fifteen removed,
   * measured at 3383 bytes down to 1025.
   *
   * ## The fallback is not decoration
   *
   * A device that has not published its key yet - first launch, mid-enrolment -
   * is refused by the function, and so is any deployment where the migration
   * has not landed. Falling back to the old query means the worst case is the
   * bill we already had, rather than a thread that will not open.
   */
  /**
   * Named messages, trimmed the same way a page is.
   *
   * The conversation list's previews, which are the only read that asks for
   * rows across conversations. Falls back for the same reasons as a page.
   */
  async #fetchMessagesById(ids: string[]): Promise<MessageRow[]> {
    try {
      const identity = await deviceIdentity();
      const { data, error } = await this.#client.rpc('messages_page', {
        // The function ignores it when `ids` is set; null says so plainly
        // rather than passing a message id where a conversation is named.
        conv: null,
        device: identity.deviceId,
        ids,
      });
      if (!error && data) return data as unknown as MessageRow[];
    } catch {
      // Fall through.
    }

    const { data } = await this.#client.from('messages').select('*').in('id', ids);
    return data ?? [];
  }

  async #fetchMessagePage(
    conversationId: ConversationId,
    options: { limit: number; before?: string; since?: string },
  ): Promise<MessageRow[] | undefined> {
    try {
      const identity = await deviceIdentity();
      const { data, error } = await this.#client.rpc('messages_page', {
        conv: conversationId,
        device: identity.deviceId,
        page_limit: options.limit,
        before_at: options.before ?? null,
        since: options.since ?? null,
      });
      if (!error && data) return data as unknown as MessageRow[];
    } catch {
      // Fall through - the shape below is always correct, only larger.
    }

    let query = this.#client
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .limit(options.limit);

    if (options.since) {
      query = query.gt('updated_at', options.since).order('updated_at', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false });
      if (options.before) query = query.lt('created_at', options.before);
    }

    const { data, error } = await query;
    if (error) return undefined;
    return data ?? [];
  }

  /**
   * Whether the one refetch a placeholder is owed has already been spent.
   *
   * On disk beside the sync cursor rather than in memory, because the whole
   * point is to survive the reload - a flag that reset on every launch would
   * buy exactly one delta hit per session and then go back to full pages.
   */
  async #placeholderRetried(conversationId: ConversationId): Promise<boolean> {
    return (
      (await openRecord<boolean>(
        await localGet<unknown>(STORE.meta, `retried:${conversationId}`),
      )) === true
    );
  }

  /** Records that the refetch happened, so the next open may trust the cache. */
  async #notePlaceholderRetry(conversationId: ConversationId): Promise<void> {
    await localSet(STORE.meta, `retried:${conversationId}`, await sealRecord(true));
  }

  /** The newest `updated_at` this device has stored for a conversation. */
  async #syncCursor(conversationId: ConversationId): Promise<string | undefined> {
    return openRecord<string>(await localGet<unknown>(STORE.meta, `sync:${conversationId}`));
  }

  async #setSyncCursor(conversationId: ConversationId, at: string): Promise<void> {
    await localSet(STORE.meta, `sync:${conversationId}`, await sealRecord(at));
  }

  /**
   * The stretch of this conversation the device holds without a gap.
   *
   * Beside the sync cursor rather than in a store of its own: both are the same
   * kind of fact - how far the local copy can be trusted - and keeping them
   * together means one thing to clear on sign-out instead of two.
   *
   * Absent on every device that has not fetched a page since this shipped, and
   * absent is handled: paging falls back to the network exactly as it did
   * before, and the first fetch establishes the run.
   */
  async #rowRun(conversationId: ConversationId): Promise<RowRun | undefined> {
    return openRecord<RowRun>(await localGet<unknown>(STORE.meta, `rows:${conversationId}`));
  }

  async #extendRowRun(conversationId: ConversationId, next: RowRun): Promise<void> {
    const merged = extendRun(await this.#rowRun(conversationId), next);
    await localSet(STORE.meta, `rows:${conversationId}`, await sealRecord(merged));
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
      const batch =
        (await this.#fetchMessagePage(conversationId, {
          limit,
          ...(cursor ? { before: cursor } : {}),
        })) ?? [];
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
  /**
   * Every upload is announced, checked against its limit, and then made.
   *
   * The claim exists because of the gap this architecture cannot remove: the
   * object is written before the message row that names it, so an insert that
   * fails leaves bytes nothing points at. A row in `media_uploads` written
   * first turns that invisible orphan into a list its owner can collect - see
   * `abandoned_uploads()` and `media-reaper.ts`.
   *
   * The size check is here rather than only in the composer because not every
   * path goes through the composer: a share target, a paste, a forward and the
   * camera all arrive at these four methods.
   */
  async #claimAndUpload(
    bucket: string,
    path: string,
    body: Blob,
    contentType: string,
    kind: MediaKind,
  ): Promise<string> {
    const complaint = mediaTooLarge(body.size, kind);
    if (complaint) throw new Error(complaint);

    const me = await this.#userId();
    /*
     * Best effort, deliberately. A claim that fails to write must not stop
     * somebody sending a photograph; it only means that particular orphan
     * would have to wait for a future sweep rather than this account's own.
     */
    await Promise.resolve(uploadClaims(this.#client).insert({ path, bucket, user_id: me })).then(
      undefined,
      () => undefined,
    );

    const { error } = await this.#client.storage
      .from(bucket)
      .upload(path, body, { contentType });

    if (error) {
      // The claim outlives a failed upload harmlessly: there is no object, so
      // the sweeper deletes nothing and simply clears the row.
      throw new Error(error.message || 'Could not upload that file.');
    }
    return path;
  }

  /** The message that owns these objects exists now; they are not orphans. */
  async #releaseUploadClaims(paths: (string | undefined)[]): Promise<void> {
    const real = paths.filter((path): path is string => Boolean(path));
    if (real.length === 0) return;
    await Promise.resolve(uploadClaims(this.#client).delete().in('path', real)).then(
      undefined,
      () => undefined,
    );
  }

  async #uploadSnap(image: Blob): Promise<string> {
    if (!image || image.size === 0) {
      throw new Error('No image to send.');
    }
    const me = await this.#userId();
    const path = `${me}/${crypto.randomUUID()}.jpg`;

    return this.#claimAndUpload(SNAP_BUCKET, path, image, image.type || 'image/jpeg', 'snap');
  }

  async #uploadPhoto(image: Blob): Promise<string> {
    if (!image || image.size === 0) {
      throw new Error('No image to send.');
    }
    const me = await this.#userId();
    /*
     * The uploader's id leads the path, which is what the storage policy checks.
     *
     * The extension follows the bytes rather than always saying `.jpg`. Nothing
     * reads it - the stored content type is what decides how a picture is
     * served, and that was always right - but a GIF from the keyboard stored
     * under a `.jpg` name is a lie waiting to be believed by whoever saves it.
     */
    const path = `${me}/${crypto.randomUUID()}.${imageExtension(image.type)}`;

    return this.#claimAndUpload(PHOTO_BUCKET, path, image, image.type || 'image/jpeg', 'photo');
  }

  /**
   * Signs every unlimited photo in a page, in one request.
   *
   * Limited photos are skipped deliberately: their URL only exists after the
   * reader spends a view, and handing one out here would let the picture be
   * seen without the limit ever being consulted.
   *
   * ## Why the message carries the path and the row is only a hint
   *
   * These passes used to pair `messages[i]` with `rows[i]`, which holds on a
   * fresh page and nowhere else. The delta path calls this with every message
   * in the thread and only the handful of rows that changed, so the pairing
   * slid: most photos were skipped, and the ones at the start of the page were
   * handed a URL belonging to a different message. Matching on the id cannot
   * slide, and falling back to the path stored on the message itself is what
   * lets a page that has no rows at all - a cache hit - still be signed.
   */
  async #signPhotos(rows: MessageRow[], messages: Message[]): Promise<Message[]> {
    const rowById = new Map(rows.map((row) => [row.id, row]));

    /** Where this message's picture lives, or nothing if it has none to sign. */
    const pathOf = (message: Message): string | undefined => {
      if (!message.photo || message.photo.viewLimit !== undefined) return undefined;
      return (
        rowById.get(message.id)?.photo_path ??
        message.photo.storagePath ??
        pathFromSignedUrl(message.photo.url, PHOTO_BUCKET)
      );
    };

    const paths = [...new Set(messages.map(pathOf).filter((path) => path !== undefined))];

    // No photos on this page still leaves the voice pass to run - returning
    // here outright would silently skip it for any thread of only voice notes.
    if (paths.length === 0) return this.#signVoice(rows, messages);

    const urlByPath = await this.#signStoragePaths(PHOTO_BUCKET, paths);

    const withPhotos = messages.map((message) => {
      const path = pathOf(message);
      if (!path || !message.photo) return message;
      const url = urlByPath.get(path);
      // The path is kept alongside the URL so the next read can re-sign it
      // without needing the row back.
      return url ? { ...message, photo: { ...message.photo, url, storagePath: path } } : message;
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
    const rowById = new Map(rows.map((row) => [row.id, row]));

    /** By id, and by the path the attachment already carries. See `#signPhotos`. */
    const pathOf = (message: Message): string | undefined => {
      const audio = message.attachments.find((a) => a.kind === 'audio');
      return (
        rowById.get(message.id)?.voice_path ??
        audio?.storagePath ??
        pathFromSignedUrl(audio?.url, VOICE_BUCKET)
      );
    };

    const paths = [...new Set(messages.map(pathOf).filter((path) => path !== undefined))];

    if (paths.length === 0) return this.#signDocuments(rows, messages);

    const urlByPath = await this.#signStoragePaths(VOICE_BUCKET, paths);

    const signed = messages.map((message) => {
      const path = pathOf(message);
      if (!path) return message;
      const url = urlByPath.get(path);
      if (!url) return message;

      const row = rowById.get(message.id);

      // Guarantee an audio attachment even if mapping earlier dropped it.
      const attachments = message.attachments.some((a) => a.kind === 'audio')
        ? message.attachments.map((attachment) =>
            attachment.kind === 'audio'
              ? { ...attachment, url, storagePath: attachment.storagePath ?? path }
              : attachment,
          )
        : [
            {
              id: message.id,
              kind: 'audio' as const,
              url,
              duration: row?.voice_duration ?? 0,
              waveform: normalizeWaveform(row?.voice_waveform),
              storagePath: path,
            },
          ];

      return { ...message, attachments };
    });

    return this.#signDocuments(rows, signed);
  }

  /**
   * Fresh signed URL for a voice storage path — used when play finds no URL
   * or the previous one expired mid-thread.
   */
  async signVoiceUrl(path: string): Promise<string | undefined> {
    if (!path.trim()) return undefined;
    const { data, error } = await this.#client.storage
      .from(VOICE_BUCKET)
      .createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      console.warn('[voice] signVoiceUrl failed', path, error?.message);
      return undefined;
    }
    return data.signedUrl;
  }

  /**
   * Batch-sign private storage paths, with index + singular fallbacks.
   *
   * Supabase sometimes returns entries without a usable `path` key, or a null
   * `signedUrl` on one of a batch - either leaves the receiver with a silent
   * voice bubble. Zip by request index first, then retry failures one by one.
   */
  async #signStoragePaths(
    bucket: string,
    paths: string[],
  ): Promise<Map<string, string>> {
    const urlByPath = new Map<string, string>();
    if (paths.length === 0) return urlByPath;

    const { data } = await this.#client.storage
      .from(bucket)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);

    const failed: string[] = [];
    paths.forEach((path, index) => {
      const entry = data?.[index] as
        | { path?: string | null; signedUrl?: string | null; signedURL?: string | null; error?: string | null }
        | undefined;
      const url = entry?.signedUrl || entry?.signedURL || undefined;
      // Prefer the path we asked for; response path is only a secondary key.
      if (url && entry && !entry.error) {
        urlByPath.set(path, url);
        if (entry.path && entry.path !== path) urlByPath.set(entry.path, url);
      } else {
        failed.push(path);
      }
    });

    // Singular retry — batch signing can miss individual objects intermittently.
    await Promise.all(
      failed.map(async (path) => {
        const { data: one } = await this.#client.storage
          .from(bucket)
          .createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
        const url = one?.signedUrl;
        if (url) urlByPath.set(path, url);
      }),
    );

    return urlByPath;
  }

  /**
   * Fills in the URL on every document in a page, in one request.
   *
   * A third pass rather than a merged one, because `createSignedUrls` signs a
   * single bucket at a time. Each kind lives in its own bucket, and a message
   * is only ever one kind, so the passes never contend.
   */
  async #signDocuments(rows: MessageRow[], messages: Message[]): Promise<Message[]> {
    const rowById = new Map(rows.map((row) => [row.id, row]));

    /** By id, and by the path the attachment already carries. See `#signPhotos`. */
    const pathOf = (message: Message): string | undefined => {
      const file = message.attachments.find((a) => a.kind === 'file');
      return (
        rowById.get(message.id)?.file_path ??
        file?.storagePath ??
        pathFromSignedUrl(file?.url, DOCUMENT_BUCKET)
      );
    };

    const paths = [...new Set(messages.map(pathOf).filter((path) => path !== undefined))];

    if (paths.length === 0) return messages;

    const urlByPath = await this.#signStoragePaths(DOCUMENT_BUCKET, paths);

    return messages.map((message) => {
      const path = pathOf(message);
      if (!path) return message;
      const url = urlByPath.get(path);
      if (!url) return message;

      return {
        ...message,
        attachments: message.attachments.map((attachment) =>
          attachment.kind === 'file' ? { ...attachment, url, storagePath: path } : attachment,
        ),
      };
    });
  }

  async #uploadVoice(audio: Blob): Promise<string> {
    const me = await this.#userId();
    // Prefer WAV always (recorder produces it). Fallback types for legacy callers.
    const type = (audio.type || 'audio/wav').split(';')[0]!.toLowerCase();
    const isWav = type.includes('wav') || type.includes('wave');
    const extension = isWav
      ? 'wav'
      : type.includes('mpeg') || type.includes('mp3')
        ? 'mp3'
        : type.includes('mp4') || type.includes('m4a') || type.includes('aac')
          ? 'm4a'
          : type.includes('ogg')
            ? 'ogg'
            : 'webm';
    // The uploader's id leads the path, which is what the storage policy checks.
    const path = `${me}/${crypto.randomUUID()}.${extension}`;

    const contentType =
      extension === 'wav'
        ? 'audio/wav'
        : extension === 'mp3'
          ? 'audio/mpeg'
          : extension === 'm4a'
            ? 'audio/mp4'
            : extension === 'ogg'
              ? 'audio/ogg'
              : 'audio/webm';

    // Force correct Content-Type so receivers do not get octet-stream silence.
    const body =
      isWav && audio.type !== 'audio/wav'
        ? new Blob([audio], { type: 'audio/wav' })
        : audio;

    return this.#claimAndUpload(VOICE_BUCKET, path, body, contentType, 'voice');
  }

  async #uploadDocument(file: File): Promise<string> {
    const me = await this.#userId();
    /*
     * The original name is kept in a column, not in the path. Filenames carry
     * spaces, accents and slashes, and a storage key made from one is a key
     * that eventually fails to round-trip.
     */
    const path = me + '/' + crypto.randomUUID();

    return this.#claimAndUpload(
      DOCUMENT_BUCKET,
      path,
      file,
      file.type || 'application/octet-stream',
      'file',
    );
  }

  /**
   * "The whole file is on my device now." Releases PINGO's buffer copy.
   *
   * Deliberately not called from playback. See `20260911000000_media_receipts`
   * for why watching a video is not evidence of having received one.
   *
   * Failure is swallowed: the consequence of a lost receipt is that the server
   * keeps a copy slightly longer than it needed to, which is the safe direction
   * to fail in. Retrying hard would risk the unsafe one.
   */
  async confirmMediaReceived(messageId: MessageId): Promise<void> {
    /*
     * Cast because the generated database types are built from the deployed
     * schema, and this function ships in `20260911000000_media_receipts`. The
     * cast comes off the moment those types are regenerated against a database
     * that has the migration.
     */
    const rpc = this.#client.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: unknown }>;
    await rpc.call(this.#client, 'confirm_media_received', { target: messageId });
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
     * The bubble appears now, not six round trips from now.
     *
     * Sending a line of text used to wait on a chain of sequential requests
     * before anything reached the screen: is this an AI thread, then the whole
     * conversation with its members and previews, then the recipients' device
     * keys to seal with, then the insert. Each is a round trip, and on a slow
     * connection each is a second. The message did not appear until the last
     * one came back, so on 2G the app looked broken for the length of the
     * whole chain - while every other messenger has put the text on screen the
     * instant you press send and dealt with the network behind it.
     *
     * The id is generated here and handed to the insert, so the row the server
     * writes *is* this message rather than a second one to reconcile against.
     * `message:new` de-duplicates by id and `message:updated` replaces by id,
     * so the optimistic bubble becomes the real one in place, with no flicker
     * and nothing to merge.
     *
     * Text only. A photo or a voice note has to be uploaded before there is
     * anything to show, and an optimistic bubble for one would be a picture
     * that is not there yet - a different problem with a different answer.
     */
    const id = crypto.randomUUID();
    const optimistic =
      !draft.photo && !draft.ping && !draft.voice && !draft.document && !draft.sticker;

    if (optimistic) {
      this.#emit({
        type: 'message:new',
        message: {
          id,
          conversationId: draft.conversationId,
          authorId: me,
          body: draft.body,
          createdAt: Date.now(),
          status: 'sending',
          attachments: [],
          reactions: [],
          ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
        },
      });
    }

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
    /*
     * AI threads are never end-to-end encrypted: the server must read them to
     * reply. Group messages that @mention PINGO AI are also plaintext so the
     * model can see the ask — other group messages stay sealed as usual.
     */
    /*
     * The heavy read happens only when it can change the answer.
     *
     * `getConversation` is not one request - it hydrates members, previews,
     * streaks and profiles - and it was awaited on every single send, right
     * after a separate round trip asking whether the thread was an AI one.
     * Two sequential requests to answer one question, on the path where each
     * costs a second on a slow connection.
     *
     * `#isAiConversation` now remembers both answers, so it is one small query
     * per conversation per session rather than one per message. And the
     * conversation itself is only fetched when the body actually mentions the
     * assistant, which is what decides whether a *group* message goes in the
     * clear. No mention, nothing to look up, straight to sealing.
     */
    const mentioned = mentionsPingoAi(draft.body);
    const isAi = await this.#isAiConversation(draft.conversationId);

    const conversationSnap =
      mentioned && !isAi ? await this.getConversation(draft.conversationId) : undefined;

    const groupHasAi =
      (conversationSnap?.kind === 'group' || conversationSnap?.kind === 'community') &&
      Boolean(conversationSnap.participantIds.includes(PINGO_AI_USER_ID));
    const callAiInGroup = groupHasAi && mentioned;
    const plaintextForAi = isAi || callAiInGroup;

    const sealed = plaintextForAi
      ? { body: draft.body, encryption: null as string | null, envelope: null as null }
      : await sealBody(this.#client, draft.conversationId, draft.body);

    /*
     * Who was @mentioned in this body — resolved on-device, stored in meta.
     *
     * The server cannot read encrypted group bodies. Putting member ids in
     * meta is how `on_message_insert` fans out `mention` notifications without
     * ever decrypting the message.
     */
    const mentionedUserIds = await this.#resolveMentionedUserIds(
      draft.body,
      me,
      conversationSnap?.participantIds ?? [],
    );

    /*
     * One meta object. Location/contact/event/call *are* the meta payload;
     * story replies and mention lists are fields on a text message's meta.
     * Spreading two `{ meta: ... }` branches would drop the earlier one.
     */
    const meta: Record<string, unknown> | undefined = draft.location
      ? { ...draft.location }
      : draft.contact
        ? { ...draft.contact }
        : draft.event
          ? { ...draft.event }
          : draft.call
            ? { ...draft.call }
            : (() => {
                const bits: Record<string, unknown> = {};
                if (draft.storyReply) bits.storyId = draft.storyReply.storyId;
                // Playback marks, not content: the file is untouched and this
                // is what every reader applies to it.
                if (draft.videoEdit) bits.videoEdit = draft.videoEdit;
                if (mentionedUserIds.length > 0) bits.mentionedUserIds = mentionedUserIds;
                return Object.keys(bits).length > 0 ? bits : undefined;
              })();

    const { data, error } = await this.#client
      .from('messages')
      .insert({
        // Ours, so the row the server writes is the bubble already on screen.
        id,
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
        ...(draft.location ? { kind: 'location' as const } : {}),
        ...(draft.contact ? { kind: 'contact' as const } : {}),
        ...(draft.event ? { kind: 'event' as const } : {}),
        ...(draft.call ? { kind: 'call' as const } : {}),
        ...(meta ? { meta } : {}),
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

    if (error) {
      /*
       * The bubble stays, and says so.
       *
       * Removing it would make a failed send look like a message that was
       * never typed, which is the one outcome worse than a failure - somebody
       * would retype it, or worse, believe it went. `failed` is a state the
       * thread already knows how to draw.
       */
      if (optimistic) {
        this.#emit({
          type: 'message:updated',
          message: {
            id,
            conversationId: draft.conversationId,
            authorId: me,
            body: draft.body,
            createdAt: Date.now(),
            status: 'failed',
            attachments: [],
            reactions: [],
            ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
          },
        });
      }
      throw error;
    }

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
    /*
     * The objects now belong to a message, so they are not orphans.
     *
     * Released after the insert and not before: the claim's whole purpose is
     * to survive an insert that never happened.
     */
    void this.#releaseUploadClaims([snapPath, photoPath, voicePath, filePath]);

    /*
     * `updated` when the bubble is already there, `new` when it is not.
     *
     * Both carry the same id, and the hook replaces by id on one and
     * de-duplicates by id on the other - so the optimistic bubble turns into
     * the real row in place rather than blinking out and back.
     */
    this.#emit({ type: optimistic ? 'message:updated' : 'message:new', message });

    /*
     * Replying is the receipt.
     *
     * With read receipts off, everything read in this thread has been sitting
     * on this device unpublished. Answering says "I read it" more plainly than
     * any tick, so this is the moment the held cursor goes to the server -
     * which is exactly the rule the setting promises: not before I say
     * something, and never a surprise afterwards.
     */
    /*
     * Both of these are after-the-fact, so neither is awaited.
     *
     * The message is written and on screen by this point. Publishing the read
     * cursor and refreshing the chat-list row are housekeeping - two more round
     * trips that the send was waiting on for no reason anybody could see. On a
     * slow connection they were the difference between "sent" and "still
     * spinning", and neither can fail in a way the sender needs to know about.
     */
    if (hasHeldRead(draft.conversationId)) {
      void (async () => {
        try {
          await this.#client.rpc('mark_conversation_read', { conv: draft.conversationId });
          releaseRead(draft.conversationId);
        } catch {
          // The reply is sent either way; the cursor stays held and goes with
          // the next one rather than failing a send nobody asked to retry.
        }
      })();
    }

    void this.getConversation(draft.conversationId)
      .then((conversation) => {
        if (conversation) this.#emit({ type: 'conversation:updated', conversation });
      })
      .catch(() => undefined);

    // Person-shaped AI: 1:1 thread always replies; groups only on @pingoai.
    if ((isAi || callAiInGroup) && draft.body.trim()) {
      void this.#requestAiReply(draft.conversationId, draft.body).catch((cause) => {
        console.error('[pingo-ai]', cause);
      });
    }

    return message;
  }

  /**
   * True for `kind = 'ai'` threads. Cached so a flaky re-select cannot seal
   * ciphertext into a thread the server has to be able to read.
   *
   * Both answers are remembered, not only the yes. Caching only the positive
   * meant every message in every ordinary conversation paid a round trip to be
   * told "no" again - once per message, forever, on the path where a round trip
   * is the thing that makes a slow connection feel broken. A conversation's
   * `kind` does not change, so one query per conversation per session is the
   * honest cost of the question.
   */
  async #isAiConversation(conversationId: ConversationId): Promise<boolean> {
    if (this.#aiConversationIds.has(conversationId)) return true;
    if (this.#nonAiConversationIds.has(conversationId)) return false;

    const { data, error } = await this.#client
      .from('conversations')
      .select('kind')
      .eq('id', conversationId)
      .maybeSingle();

    // A failed read is not an answer. Left uncached so the next send asks
    // again rather than sealing a thread on the strength of a dropped request.
    if (error || !data) return false;

    if (data.kind === 'ai') {
      this.#aiConversationIds.add(conversationId);
      return true;
    }
    this.#nonAiConversationIds.add(conversationId);
    return false;
  }

  /**
   * Map `@handles` in a body to conversation members' user ids.
   *
   * Only people already in the room are notified — mentioning a stranger by
   * handle does not invent a membership or leak that they exist in the app.
   */
  async #resolveMentionedUserIds(
    body: string,
    me: string,
    participantIds: string[],
  ): Promise<string[]> {
    const handles = extractMentionHandles(body);
    if (handles.length === 0 || participantIds.length === 0) return [];

    const members = participantIds.filter(
      (id) => id !== me && id !== PINGO_AI_USER_ID,
    );
    if (members.length === 0) return [];

    // Prefer the in-memory roster (already loaded for the thread).
    const byHandle = new Map<string, string>();
    for (const id of members) {
      const person = this.#people.get(id);
      const handle = person?.handle?.toLowerCase().replace(/^@/, '');
      if (handle) byHandle.set(handle, id);
    }

    // Fill gaps with a single profiles query when the cache is incomplete.
    const missing = members.filter((id) => {
      const person = this.#people.get(id);
      return !person?.handle;
    });
    if (missing.length > 0) {
      const { data } = await this.#client
        .from('profiles')
        .select('id, username')
        .in('id', missing);
      for (const row of data ?? []) {
        if (row.username) byHandle.set(String(row.username).toLowerCase(), row.id);
      }
    }

    const ids: string[] = [];
    for (const handle of handles) {
      // Autocomplete uses `pingoai`; profile row is often `pingo_ai`.
      const id =
        byHandle.get(handle) ??
        (handle === 'pingoai' ? byHandle.get('pingo_ai') : undefined) ??
        (handle === 'pingo_ai' ? byHandle.get('pingoai') : undefined);
      if (id && id !== me && id !== PINGO_AI_USER_ID) ids.push(id);
    }
    return [...new Set(ids)];
  }


  /** Local typing dots for the AI person - not a Realtime presence channel. */
  #setAiTyping(conversationId: ConversationId, typing: boolean): void {
    this.#rememberAiPerson();
    this.#emit({
      type: 'typing:changed',
      conversationId,
      userIds: typing ? [PINGO_AI_USER_ID] : [],
    });
  }

  /** So "PINGO is typing" has a name even when the bot is not in contacts. */
  #rememberAiPerson(displayName = 'PINGO'): void {
    if (this.#people.has(PINGO_AI_USER_ID)) return;
    this.#people.set(PINGO_AI_USER_ID, {
      id: PINGO_AI_USER_ID,
      name: displayName,
      handle: 'pingo_ai',
      presence: { state: 'online', lastSeenAt: Date.now() },
    });
  }

  /**
   * Asks the Edge Function to generate a reply and insert it via `post_ai_reply`.
   * Realtime (or a follow-up refresh) puts the bubble on screen like any human.
   *
   * `userMessage` is the plaintext we just sent - the model must not depend only
   * on rows that might still be ciphertext from an earlier bug.
   */
  async #requestAiReply(conversationId: ConversationId, userMessage: string): Promise<void> {
    /*
     * This used to add the conversation to `#aiConversationIds`, and that one
     * line was the whole of a bad bug.
     *
     * That set is the cache behind `#isAiConversation`, which answers "is this
     * a one-to-one thread with the assistant" - a thread whose `kind` is `ai`,
     * where nothing is encrypted because the server has to read all of it.
     * Adding a *group* to it made every later message in that group answer yes.
     *
     * From then on `isAi` was true, so `plaintextForAi` was true, so every
     * message anybody typed in that group was sent unencrypted - not only the
     * ones mentioning @pingoai - and `#requestAiReply` ran on all of them.
     * `isAi` also short-circuits the membership test, which is why removing
     * the assistant from the group changed nothing: the typing indicator kept
     * appearing on every message, and only the server's refusal stopped a
     * reply. One @pingoai, once, and the group's encryption was off for that
     * device for the rest of the session.
     *
     * Nothing is cached here now. `#isAiConversation` reads `kind` and caches
     * only a genuine `ai` thread, which is what it was always for.
     */
    this.#setAiTyping(conversationId, true);
    // Anything older than this is a message the UI already has.
    const startedAt = Date.now();

    try {
      void this.#client.rpc('log_ai_user_turn', {
        target_conversation: conversationId,
        turn_body: userMessage.slice(0, 4000),
      });

      await this.#invokeAiChat(conversationId, userMessage.slice(0, 4000));

      // Ensure the new assistant row is in the list even if realtime lags.
      const conversation = await this.getConversation(conversationId);
      if (conversation) this.#emit({ type: 'conversation:updated', conversation });

      /*
       * The reply, not the last eight messages.
       *
       * This announced a whole page as `message:new` every time, so everything
       * that reacts to a new message - the sound, the badge, the unread mark -
       * fired again for messages already on screen. It is meant to be a safety
       * net for realtime lagging, and a net that catches things it already had
       * is how the app ends up announcing an assistant reply from an hour ago.
       */
      for (const msg of await this.listMessages(conversationId, { limit: 8 })) {
        if (msg.authorId !== PINGO_AI_USER_ID) continue;
        if (msg.createdAt < startedAt) continue;
        this.#emit({ type: 'message:new', message: msg });
      }
    } catch (cause) {
      console.error('[pingo-ai]', cause);

      /*
       * Nothing to apologise for when the assistant simply is not there.
       *
       * The fallback below exists for a model that failed, and it is wrong for
       * a group that has turned PINGO AI off: the server refuses correctly, and
       * writing "something glitched on my side" would be the assistant speaking
       * in a room it was removed from. Silence is the right answer, and the
       * conversation is re-read so this device stops believing otherwise.
       */
      if (String(cause).includes('not in this group')) {
        const fresh = await this.getConversation(conversationId);
        if (fresh) this.#emit({ type: 'conversation:updated', conversation: fresh });
        return;
      }

      // Last resort only - do not spam this if post_ai_reply already wrote one.
      try {
        await this.#client.rpc('post_ai_reply', {
          target_conversation: conversationId,
          reply_body: "Something glitched on my side. Say that again?",
        });
        for (const msg of await this.listMessages(conversationId, { limit: 5 })) {
          if (msg.authorId !== PINGO_AI_USER_ID) continue;
          if (msg.createdAt < startedAt) continue;
          this.#emit({ type: 'message:new', message: msg });
        }
      } catch {
        /* ignore double-failure */
      }
    } finally {
      this.#setAiTyping(conversationId, false);
    }
  }

  /**
   * Call the ai-chat Edge Function.
   *
   * Uses session-aware fetch rather than only `functions.invoke`, because the
   * invoke helper can surface opaque CORS/relay errors without the body that
   * already contains a successful `messageId`.
   */
  async #invokeAiChat(conversationId: ConversationId, userMessage: string): Promise<void> {
    const {
      data: { session },
    } = await this.#client.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Sign in required for AI reply.');
    }

    // Prefer invoke; on failure fall through to a direct fetch with the same JWT.
    const { data, error } = await this.#client.functions.invoke('ai-chat', {
      body: { conversationId, userMessage },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!error) {
      if (data && typeof data === 'object' && 'error' in data && data.error && !('messageId' in data)) {
        throw new Error(String((data as { error: string }).error));
      }
      return;
    }

    console.warn('[pingo-ai] functions.invoke failed, retrying with fetch', error);

    const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!base || !anon) throw error;

    const response = await fetch(`${base}/functions/v1/ai-chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: anon,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversationId, userMessage }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      messageId?: string;
      error?: string;
      reply?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? `ai-chat HTTP ${response.status}`);
    }
    if (payload.error && !payload.messageId) {
      throw new Error(payload.error);
    }
  }

  async ensureAiConversation(): Promise<ConversationId> {
    const { data, error } = await this.#client.rpc('ensure_ai_conversation');
    if (error) throw error;
    const id = data as ConversationId;
    this.#aiConversationIds.add(id);
    this.#rememberAiPerson();
    const conversation = await this.getConversation(id);
    if (conversation) this.#emit({ type: 'conversation:updated', conversation });
    return id;
  }

  async markConversationRead(conversationId: ConversationId): Promise<void> {
    /*
     * With receipts off, reading is this device's business and nobody else's.
     *
     * The cursor is held locally instead - which clears the badge here without
     * telling the sender anything - and published the moment a reply is sent,
     * because a reply says it louder than a tick does. See `read-cursor.ts`.
     */
    if (!readReceiptsOn()) {
      holdRead(conversationId);
      const held = await this.getConversation(conversationId);
      if (held) this.#emit({ type: 'conversation:updated', conversation: held });
      return;
    }

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
    releaseRead(conversationId);

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

  /**
   * Adds or removes PINGO AI from a group.
   *
   * A membership change, not a setting - see `set_group_ai`. `#announce`
   * re-reads the conversation so `participantIds` is right immediately, which
   * matters more than usual here: that list is what `sendMessage` consults
   * before deciding a message may go in plaintext, and a stale copy would keep
   * sending one to an assistant that had just been removed.
   */
  async setGroupAi(conversationId: ConversationId, enabled: boolean): Promise<void> {
    const { error } = await this.#client.rpc('set_group_ai', {
      conv: conversationId,
      enabled,
    });
    if (error) throw groupError(error);
    if (enabled) this.#rememberAiPerson('PINGO AI');
    await this.#announce(conversationId);
  }

  async updateGroup(
    conversationId: ConversationId,
    changes: {
      title: string;
      description?: string;
      avatarUrl?: string;
      coverUrl?: string;
      clearAvatar?: boolean;
      clearCover?: boolean;
    },
  ): Promise<void> {
    const { error } = await this.#client.rpc('update_group', {
      conv: conversationId,
      title: changes.title,
      avatar_url: changes.avatarUrl ?? null,
      description: changes.description ?? null,
      cover_url: changes.coverUrl ?? null,
      clear_avatar: Boolean(changes.clearAvatar),
      clear_cover: Boolean(changes.clearCover),
    });
    if (error) throw groupError(error);
    await this.#announce(conversationId);
  }

  async setGroupWallpaper(
    conversationId: ConversationId,
    wallpaperId: string,
    photoUrl?: string,
  ): Promise<void> {
    const { error } = await this.#client.rpc('set_group_wallpaper', {
      conv: conversationId,
      wallpaper_id: wallpaperId,
      wallpaper_photo_url: photoUrl ?? null,
    });
    if (error) throw groupError(error);
    await this.#announce(conversationId);
  }

  /**
   * Turns the conversation's timer on, changes it, or turns it off.
   *
   * `undefined` is off. The server validates membership and the range, posts the
   * system notice, and refuses to stamp anything retroactively - so this is a
   * decision about what gets said next, not a way to clear a thread.
   */
  async setDisappearing(
    conversationId: ConversationId,
    seconds: number | undefined,
  ): Promise<void> {
    const { error } = await this.#client.rpc('set_disappearing', {
      conv: conversationId,
      seconds: seconds ?? null,
    });
    if (error) throw error;
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
   * Announces that this user is holding the microphone.
   *
   * The same channel and the same expiry as typing, because it is the same kind
   * of fact: true for seconds, wrong forever after. A recorder that dies
   * mid-note never sends the stopping signal, and the sweeper is what takes the
   * indicator down rather than a promise that the sender will behave.
   */
  async setRecording(conversationId: ConversationId, recording: boolean): Promise<void> {
    await this.#presenceHub.setTyping(conversationId, recording, 'recording');
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
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Message cannot be empty.');

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

    if (error) throw new Error(error.message || 'Could not load the message.');
    if (!data) throw new Error('That message is no longer available.');

    const sealed = await sealBody(this.#client, data.conversation_id, trimmed);

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
      if (sealedError.code !== 'PGRST202') {
        throw new Error(sealedError.message || 'Could not save the edit.');
      }

      if (sealed.encryption !== null) {
        throw new Error(
          'This chat is end-to-end encrypted and the server has not been updated to accept edited ciphertext yet. Your message has not been changed.',
        );
      }

      const { error: legacyError } = await this.#client.rpc('edit_message', {
        target: messageId,
        new_body: sealed.body,
      });
      if (legacyError) {
        throw new Error(legacyError.message || 'Could not save the edit.');
      }
    }

    /*
     * Prefer a fresh row, but never fail the whole edit because the re-read
     * hiccuped - the RPC already committed. Emit a minimal update so the
     * bubble still refreshes.
     */
    try {
      this.#emit({ type: 'message:updated', message: await this.#messageRow(messageId) });
    } catch {
      this.#emit({
        type: 'message:updated',
        message: {
          id: messageId,
          conversationId: data.conversation_id,
          authorId: await this.#userId(),
          body: trimmed,
          createdAt: Date.now(),
          status: 'sent',
          attachments: [],
          reactions: [],
          editedAt: Date.now(),
        },
      });
    }
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
    /*
     * The socket's word wins here too.
     *
     * This is the list the provider hands every screen as `users`, and it was
     * writing `offline` for everybody from `last_seen_at` - so whoever was
     * actually connected went grey the moment contacts loaded or reloaded, and
     * stayed grey until their next presence event. Which side saw whom online
     * came down to timing, which is why it worked one way and not the other.
     *
     * The same overlay as the conversation roster. Both sites rebuild people
     * from the database; neither may claim to know who is connected.
     */
    const users = rows.map((row) => {
      const user = toUser(row, lastSeen.get(row.id));
      const live = this.#livePresence.get(row.id);
      return live ? { ...user, presence: live } : user;
    });
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

      // A room has no single other party, and that is how it is recognised -
      // see `callRecordFrom`, which the history screen and this share.
      return [callRecordFrom(row, meta, me)];
    });
  }

  async logCall(entry: {
    conversationId: string;
    calleeId?: string;
    callKind: 'voice' | 'video';
    outcome: CallOutcome;
    durationSeconds: number;
    callId?: string;
  }): Promise<Message> {
    /*
     * Sent as an ordinary message, so it lands in the thread, reaches the other
     * end over realtime, and updates the conversation list - all the machinery
     * a call log needs already exists for messages.
     */
    return this.sendMessage({
      conversationId: entry.conversationId,
      body: '',
      call: {
        callKind: entry.callKind,
        outcome: entry.outcome,
        durationSeconds: entry.durationSeconds,
        ...(entry.calleeId ? { calleeId: entry.calleeId } : {}),
        ...(entry.callId ? { callId: entry.callId } : {}),
      },
    });
  }

  /**
   * Turns a live group-call entry into history.
   *
   * The same row, edited. A second message would put two calls in the thread
   * for one, and the first would go on offering to join a room that emptied an
   * hour ago - which is worse than no entry at all, because it is an invitation
   * that leads nowhere.
   *
   * `meta` is rewritten whole rather than merged: it is this client's own
   * shape, written by `logCall` moments earlier, so there is nothing of anybody
   * else's in it to preserve. Dropping `callId` is what ends the offer.
   */
  async endCallLog(
    messageId: string,
    entry: { outcome: CallOutcome; durationSeconds: number },
  ): Promise<void> {
    const { data } = await this.#client
      .from('messages')
      .select('meta')
      .eq('id', messageId)
      .maybeSingle();

    const before = (data?.meta ?? {}) as Record<string, unknown>;

    await this.#client
      .from('messages')
      .update({
        meta: {
          callKind: before['callKind'] ?? 'voice',
          outcome: entry.outcome,
          durationSeconds: entry.durationSeconds,
          ...(before['calleeId'] ? { calleeId: before['calleeId'] } : {}),
        },
      })
      .eq('id', messageId);
  }

  /** No gallery table. */
  async listGallery(): Promise<GalleryItem[]> {
    return [];
  }

  /** No moments table. */
  async listMoments(): Promise<Moment[]> {
    return [];
  }

  /**
   * The feed, with actor names resolved.
   *
   * Titles are built here rather than stored, so a renamed user is not stuck
   * with their old name in every notification they ever caused. The row keeps
   * ids; the words are assembled at read time.
   *
   * ## Kept on the device, because it was the last screen that wasn't
   *
   * This was the one remaining feed that went blank without a connection: the
   * query failed, `[]` came back, and the screen said there was nothing rather
   * than that it could not ask. What is stored is the assembled list, names and
   * all - the words are cheap to rebuild but the ids they were built from are
   * not, and a cached feed that has to make three more queries to be readable
   * is not a cached feed.
   *
   * Keyed by account. There is one database per device and two accounts on one
   * phone is ordinary here, so an unkeyed feed would show the other person
   * theirs.
   */
  async listNotifications(): Promise<AppNotification[]> {
    const me = await this.#userId();
    const key = `notifications:${me}`;

    const { data, error } = await this.#client
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return (await openRecord<AppNotification[]>(await localGet<unknown>(STORE.meta, key))) ?? [];
    }

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

    const feed = rows.map((row) => {
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

      /*
       * The one kind with nobody behind it.
       *
       * Every other row is somebody doing something to you, so the title is
       * their name and the body finishes the sentence. A device signing in has
       * no actor - and `subject_id` is a device id, not a conversation, so
       * passing it on would give the row a tap that opens nothing.
       */
      const fromPingo = kind === 'new_device';

      return {
        id: row.id,
        kind,
        title: fromPingo ? 'PINGO' : who,
        body: copy.body,
        createdAt: Date.parse(row.created_at),
        read: row.read_at !== null,
        ...(row.subject_id && !fromPingo ? { conversationId: row.subject_id } : {}),
        ...(row.actor_id ? { actorId: row.actor_id } : {}),
      } satisfies AppNotification;
    });

    // Sealed like every other record on disk. Not awaited: the screen has its
    // answer and the copy is for next time.
    void sealRecord(feed).then((sealed) => localSet(STORE.meta, key, sealed));
    return feed;
  }

  async markNotificationRead(id: string): Promise<void> {
    await this.#client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
  }

  async unreadNotifications(): Promise<number> {
    const { data, error } = await this.#client.rpc('unread_notifications');
    if (!error) return data ?? 0;

    /*
     * Offline, the badge is counted from the stored feed instead of dropped.
     *
     * Zero used to be returned on any failure, on the grounds that a badge
     * showing a number it cannot justify is worse than no badge. It can justify
     * this one: it is the same list the screen will open to, counted the same
     * way. What it cannot do is see anything that arrived since, so this is a
     * floor rather than a guess, and the next successful call replaces it.
     */
    const me = await this.#userId().catch(() => undefined);
    if (!me) return 0;
    const cached = await openRecord<AppNotification[]>(
      await localGet<unknown>(STORE.meta, `notifications:${me}`),
    );
    return cached?.filter((item) => !item.read).length ?? 0;
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.#client.rpc('mark_notifications_read');
  }

  // -- search --------------------------------------------------------------

  async search(query: string): Promise<SearchResult[]> {
    const term = query.trim().replace(/^@/u, '');
    if (term.length === 0) return [];

    const me = await this.#userId();
    const lowered = term.toLowerCase();
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);

    const peopleQuery = this.#client.from('profiles').select('*').neq('id', me);
    const [{ data: people }, conversations] = await Promise.all([
      uuid
        ? peopleQuery.eq('id', term).limit(1)
        : peopleQuery
            .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
            .limit(10),
      this.listConversations(),
    ]);

    const results: SearchResult[] = (people ?? []).map((row) => ({
      kind: 'user' as const,
      user: toUser(row),
    }));

    for (const conversation of conversations) {
      const titleHit = conversation.title.toLowerCase().includes(lowered);
      const idHit = conversation.id.toLowerCase().includes(lowered);
      const memberHit = conversation.participantIds.some((id) =>
        id.toLowerCase().includes(lowered),
      );
      if (titleHit || idHit || memberHit) {
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
