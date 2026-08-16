import {
  STORE,
  localDelete,
  localEntries,
  localGet,
  localKeys,
  localPutMany,
  localRange,
  localSet,
  messageRowKey,
  messageRowRange,
  rowKeyBoundsBefore,
} from '../local/db.js';
import { activityStatusOn } from '../../features/settings/privacy-flags.js';
import { deviceLabel } from '../../features/settings/device-label.js';
import { BUILD_ID } from '../build-id.js';
import type { PingoSupabaseClient } from '../supabase/client.js';
import type { MessageRow } from '../supabase/types.js';
import { decryptMessage, encryptMessage, type RecipientDevice } from './envelope.js';
import { databaseKey, deviceIdentity, fromBase64, toBase64 } from './keys.js';

/**
 * Where the crypto meets the chat service.
 *
 * `keys.ts` owns this device's keys and `envelope.ts` owns the construction;
 * neither knows what a conversation is. This module is the only place that
 * does, which keeps the primitives testable without a database and keeps the
 * chat service free of curve names.
 */

/** Published once per session. A second publish in the same tab is wasted work. */
let published: Promise<void> | undefined;

/** Which account this device's keys belong to. See `publishDeviceKey`. */
const OWNER = 'identity-owner';

/** The live slots. Archived per account when somebody else signs in. */
const LIVE_KEYS = ['identity:v1', 'database:v1', 'device-id'] as const;

/**
 * Hand the device over to another account without destroying anything.
 *
 * This used to call `localClear()`, and that was a bad mistake with a real
 * consequence: the `keys` store holds the device identity, so signing a second
 * account in wiped the *first* account's private key. Every message already
 * encrypted to it became permanently unreadable on that device - which is
 * exactly the "Sent before you added this device" placeholder appearing over a
 * message that had arrived perfectly well. The reasoning was that a shared
 * device should not leak one person's data to the next; the reasoning was
 * right and the implementation threw away far more than it needed to.
 *
 * Now each account's keys are parked under its own name and brought back if it
 * returns. Nothing is destroyed by switching, so a message encrypted before a
 * switch is still readable after switching back.
 *
 * The cached *conversations* are still cleared, because those genuinely do
 * belong to the previous account and are what the shared-device concern was
 * actually about. They cost a refetch; a key costs the history.
 */
async function switchAccount(previous: string, next: string): Promise<void> {
  // Park the outgoing account's keys under its own id.
  for (const slot of LIVE_KEYS) {
    const value = await localGet<unknown>(STORE.keys, slot);
    if (value !== undefined) await localSet(STORE.keys, `${slot}@${previous}`, value);
  }

  /*
   * Clear only what belongs to the previous account's *content*.
   *
   * `messageRows` was missing from this list for as long as it has existed: the
   * store arrived with milestone 2, after this function was written, and
   * nothing pointed at the gap. The rows survived an account switch sealed
   * under the outgoing account's parked database key, so they were unreadable
   * rather than exposed - but they were another person's messages sitting in
   * this account's store, and they came back the moment that key was restored.
   *
   * Found by building an archive on a real device: 50 of 52 records would not
   * open, all of them rows left behind by a switch.
   */
  for (const store of [
    STORE.conversations,
    STORE.messages,
    STORE.messageRows,
    STORE.outbox,
    STORE.drafts,
    STORE.meta,
  ]) {
    for (const [key] of await localEntries<unknown>(store)) await localDelete(store, key);
  }

  // Bring back the incoming account's keys if this device has seen it before,
  // otherwise leave the slots empty so a fresh identity is generated.
  for (const slot of LIVE_KEYS) {
    const parked = await localGet<unknown>(STORE.keys, `${slot}@${next}`);
    if (parked !== undefined) await localSet(STORE.keys, slot, parked);
    else await localDelete(STORE.keys, slot);
  }
}

/**
 * What a device throws away when it learns it has been removed.
 *
 * Not `localClear()`, which would take the *parked* keys of every other account
 * that has ever signed in on this browser with it - and those messages would be
 * unreadable for ever, on a device nobody asked to punish. See the note above
 * `switchAccount`, which is the same mistake in the other direction.
 *
 * So: this account's content, and this account's live keys. The keys go because
 * the rows on disk are sealed with them - clearing the stores without the key
 * would be tidying rather than destroying, and a copy of somebody's messages is
 * exactly what the owner removed this device to be rid of.
 */
async function wipeRevokedDevice(userId: string): Promise<void> {
  for (const store of [
    STORE.conversations,
    STORE.messages,
    STORE.messageRows,
    STORE.outbox,
    STORE.drafts,
    STORE.meta,
  ]) {
    for (const [key] of await localEntries<unknown>(store)) await localDelete(store, key);
  }

  for (const slot of LIVE_KEYS) {
    await localDelete(STORE.keys, slot);
    // The parked copy of *this* account's keys goes too, or signing back in
    // here would restore the identity that was just thrown off.
    await localDelete(STORE.keys, `${slot}@${userId}`);
  }
  await localDelete(STORE.keys, OWNER);
}

/**
 * Announce this device's public key.
 *
 * Idempotent by primary key, so a reload updates `last_seen_at` rather than
 * accumulating rows. Failure is swallowed deliberately: not publishing means
 * other people cannot encrypt *to* this device yet, which is a degraded state,
 * not a broken one - the app still reads and sends. Blocking sign-in on it
 * would turn a sync hiccup into a login failure.
 */
export function publishDeviceKey(client: PingoSupabaseClient, userId: string): Promise<void> {
  published ??= (async () => {
    /*
     * Whose device is this?
     *
     * Now that signing out leaves the keys in place, the same browser can see
     * a second account sign in - a shared laptop, or someone switching between
     * their own two accounts. Handing the new account the previous one's
     * identity would republish that device under a new owner and quietly move
     * a key between people, which is the sort of thing that is obvious only
     * once it has happened.
     *
     * A different owner therefore wipes the slate first. The same owner
     * returning finds everything where they left it, which is the whole point
     * of not clearing on logout.
     */
    const previous = await localGet<string>(STORE.keys, OWNER);
    if (previous && previous !== userId) {
      await switchAccount(previous, userId);
    }

    const identity = await deviceIdentity();

    /*
     * Has this device been thrown off the account?
     *
     * Asked before publishing, because publishing is what a revoked device
     * would otherwise do to undo its own revocation - the upsert runs every
     * launch, and the policy would refuse it, silently, leaving somebody
     * believing they had removed a device that was still reading its own local
     * copy of everything.
     *
     * So the device signs itself out and wipes what it holds. Ordinary sign-out
     * deliberately leaves the local database alone - "your chats stay on this
     * device" - and this is the case where that promise is the wrong one: the
     * owner removed this device precisely so it would stop having them.
     */
    const { data: revoked } = await client
      .from('revoked_devices')
      .select('device_id')
      .eq('device_id', identity.deviceId)
      .maybeSingle();

    if (revoked) {
      await wipeRevokedDevice(userId).catch(() => undefined);
      await client.auth.signOut().catch(() => undefined);
      return;
    }

    await localSet(STORE.keys, OWNER, userId);

    /*
     * The key is published either way; the timestamp is not.
     *
     * This upsert runs once per launch, and `last_seen_at` is the column
     * presence falls back to - so with activity status off it was announcing
     * "here, just now" every time the app opened, and holding it there for the
     * two minutes the presence window lasts. The switch was working and this
     * was undoing it, which is the worst of both: quiet enough to look fixed,
     * loud enough to still be visible from another account.
     *
     * Omitted rather than backdated: on conflict only the columns sent are
     * written, so an existing row keeps whatever it last said honestly.
     */
    await client.from('device_keys').upsert(
      {
        device_id: identity.deviceId,
        user_id: userId,
        public_key: identity.publicKey,
        // So the owner's device list has a row they recognise rather than a
        // uuid. Sent every launch, because a browser can be upgraded.
        label: deviceLabel(),
        // Which bundle is running, so rollout is measurable - see build-id.ts.
        build: BUILD_ID,
        ...(activityStatusOn() ? { last_seen_at: new Date().toISOString() } : {}),
      },
      { onConflict: 'device_id' },
    );
  })().catch(() => undefined);

  return published;
}

/** Dropped on sign-out, so the next account publishes its own device. */
export function forgetPublication(): void {
  published = undefined;
}

/** What is known about a conversation's ability to carry encrypted messages. */
export interface Keying {
  /**
   * Every device that should be able to read messages here, the sender's own
   * included. Leaving those out would mean writing messages you cannot read
   * back - the sent thread would go blank on reload, which is a spectacular
   * way to lose a conversation.
   */
  devices: RecipientDevice[];
  /**
   * True only when *every* member has at least one published device.
   *
   * The distinction that matters. Encrypting for the devices that happen to
   * exist would produce a message the other side is cryptographically unable
   * to open - not a downgrade, which is at least readable, but mail nobody can
   * deliver. A conversation becomes encrypted when everyone in it can read it,
   * and not one message sooner.
   */
  everyoneReady: boolean;
  /**
   * One wrap recipient per member who has enabled Secure Backup.
   *
   * Additional recipients, never a substitute for a device. A recovery key
   * does not make a conversation encryptable - `everyoneReady` is decided by
   * devices alone, exactly as before - it only means that a member who later
   * loses every device can still read what was sent while they had one.
   *
   * Members without Secure Backup contribute nothing, so their envelopes are
   * byte-for-byte what they were before this existed.
   */
  recovery: RecipientDevice[];
}

/**
 * Recovery wraps are namespaced so they can never collide with a device.
 *
 * The envelope's `keys` map is keyed by opaque id and device ids are UUIDs, so
 * a prefix that is not a legal UUID keeps the two populations separate for
 * good. `openRow` looks up its own device id and therefore ignores these
 * entries without needing to know they exist.
 */
export const RECOVERY_WRAP_PREFIX = 'recovery:';

export function recoveryWrapId(userId: string): string {
  return `${RECOVERY_WRAP_PREFIX}${userId}`;
}

/**
 * PINGO AI is a server-side bot: it never publishes device keys, and it never
 * should. When it is a group member (so people can @pingoai), it must not
 * count toward "everyone has a key" - otherwise any group that already had
 * encrypted history becomes unsendable the moment AI is added.
 *
 * @pingoai asks are intentionally plaintext (see `sendMessage`); every other
 * group message still seals to the human members only.
 */
export const PINGO_AI_USER_ID = 'a1000000-0000-4000-8000-0000000000a1';

/** Members that take part in end-to-end keying (people, not the AI bot). */
function keyingMemberIds(userIds: string[]): string[] {
  return userIds.filter((id) => id !== PINGO_AI_USER_ID);
}

/**
 * Errors propagate rather than being swallowed.
 *
 * A failed lookup means *not known*, and treating it as *nobody has keys* is
 * how a network blip turns into a message sent in the clear. The caller decides
 * what an unknown answer is worth; this refuses to invent a confident one.
 */
/**
 * Keying reads in flight, so a burst of messages pays for one.
 *
 * Sealing a message costs two sequential network stages - the roster, then
 * everybody's device and recovery keys - and it ran once per message. Typing
 * three lines quickly meant six round trips for keys that had not changed
 * between them, which on a slow connection is most of the wait.
 *
 * The window is deliberately tiny. Cached keys are a correctness question, not
 * a performance one: seal against a stale roster and a device that joined a
 * moment ago cannot read the message, permanently. A second is short enough
 * that it only ever merges sends that were already in flight together, and long
 * enough to collapse the burst that made this noticeable.
 */
const KEYING_COALESCE_MS = 1000;
const keyingReads = new Map<string, { at: number; work: Promise<Keying> }>();

export async function conversationKeying(
  client: PingoSupabaseClient,
  conversationId: string,
): Promise<Keying> {
  const pending = keyingReads.get(conversationId);
  if (pending && Date.now() - pending.at < KEYING_COALESCE_MS) return pending.work;

  const work = readConversationKeying(client, conversationId);
  keyingReads.set(conversationId, { at: Date.now(), work });

  // Dropped when the window is up, and a failed read is never left behind as
  // the answer a later send would get.
  void work
    .catch(() => undefined)
    .finally(() => {
      setTimeout(() => {
        if (keyingReads.get(conversationId)?.work === work) {
          keyingReads.delete(conversationId);
        }
      }, KEYING_COALESCE_MS);
    });

  return work;
}

async function readConversationKeying(
  client: PingoSupabaseClient,
  conversationId: string,
): Promise<Keying> {
  const { data: members, error: membersError } = await client
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  if (membersError) throw membersError;

  const userIds = (members ?? []).map((m) => m.user_id);
  // AI is listed on the roster for @mentions, but has no keys to publish.
  const humans = keyingMemberIds(userIds);
  if (humans.length === 0) return { devices: [], everyoneReady: false, recovery: [] };

  /*
   * Both lookups together, because they answer one question.
   *
   * The recovery read is the same shape as the device read and neither depends
   * on the other, so serialising them would add a round trip to every send for
   * no benefit.
   */
  const [{ data: rows, error: devicesError }, { data: packages, error: recoveryError }] =
    await Promise.all([
      client.from('device_keys').select('device_id,public_key,user_id').in('user_id', humans),
      client.from('recovery_packages').select('user_id,public_key').in('user_id', humans),
    ]);

  if (devicesError) throw devicesError;

  /*
   * A failed recovery lookup is not a failed send.
   *
   * Errors propagate for devices because *not known* must never be read as
   * *nobody has keys* - that is how a blip becomes a message in the clear.
   * Recovery is different: it adds a recipient rather than deciding whether to
   * encrypt at all. Losing it costs recoverability of this one message and
   * changes nothing about who can read it, so a message that would otherwise
   * send correctly still sends.
   */
  const covered = new Set((rows ?? []).map((row) => row.user_id));

  return {
    devices: (rows ?? []).map((row) => ({
      deviceId: row.device_id,
      publicKey: row.public_key,
    })),
    everyoneReady: humans.every((id) => covered.has(id)),
    recovery: recoveryError
      ? []
      : (packages ?? []).map((row) => ({
          deviceId: recoveryWrapId(row.user_id),
          publicKey: row.public_key,
        })),
  };
}

/** What `sendMessage` merges into the row it inserts. */
export interface SealedBody {
  body: string;
  encryption: 'v1' | null;
  envelope: MessageRow['envelope'];
}

/**
 * Conversations known to have carried an encrypted message.
 *
 * A one-way latch. Nothing ever removes an entry, because the property it
 * records - this conversation has been encrypted at least once - cannot stop
 * being true.
 */
const encrypted = new Set<string>();

/**
 * Has this conversation ever carried a `v1` message?
 *
 * Asked of the server only when the in-memory latch has not already been set,
 * and only when a plaintext send is on the table - so the happy path never pays
 * for it. A tab opened fresh has an empty latch, which is exactly the case that
 * needs the server's memory rather than its own.
 */
async function hasEncryptedHistory(
  client: PingoSupabaseClient,
  conversationId: string,
): Promise<boolean> {
  if (encrypted.has(conversationId)) return true;

  const { data, error } = await client
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('encryption', 'v1')
    .limit(1);

  // Unknown is treated as yes. Refusing to send is recoverable; sending in the
  // clear because a query failed is not.
  if (error) return true;

  if ((data ?? []).length > 0) {
    encrypted.add(conversationId);
    return true;
  }

  return false;
}

/**
 * Encrypt a body for a conversation, or hand it back untouched.
 *
 * Plaintext is permitted in exactly one situation: this conversation has never
 * been encrypted, and somebody in it still has no published key. That is a
 * recipient on an older build, and refusing would make PINGO look broken to the
 * person who did nothing wrong.
 *
 * Once a conversation has carried a single encrypted message, that door shuts
 * for good. A send that cannot be encrypted then **throws** rather than
 * quietly reverting - a thread that silently drops back to plaintext is the
 * worst failure this system can have, because it looks exactly like a thread
 * that is working.
 */
export async function sealBody(
  client: PingoSupabaseClient,
  conversationId: string,
  body: string,
): Promise<SealedBody> {
  const { devices, everyoneReady, recovery } = await conversationKeying(client, conversationId);

  if (!everyoneReady) {
    if (await hasEncryptedHistory(client, conversationId)) {
      throw new Error(
        'This chat is end-to-end encrypted, but a key for everyone in it is not available right now. Your message has not been sent.',
      );
    }
    return { body, encryption: null, envelope: null };
  }

  /*
   * Devices first, then recovery keys, in one envelope.
   *
   * Recovery is an extra wrap of the same content key, not a second copy of the
   * message and not a different cipher - one more ECDH per enrolled member and
   * no format change, because the `keys` map was always keyed by opaque id.
   *
   * This is not retroactive and cannot be. A message sent before a member
   * enrolled carries no wrap for their recovery key, so enabling Secure Backup
   * makes future messages recoverable and does nothing for past ones. The
   * product has to say so at the moment of enabling rather than leave it to be
   * discovered later.
   */
  const sealed = await encryptMessage(body, [...devices, ...recovery]);
  encrypted.add(conversationId);
  return { body: sealed.body, encryption: 'v1', envelope: sealed.envelope };
}

/** Shown in place of a message this device was never given a key for. */
export const UNREADABLE = 'Sent before you added this device.';

/**
 * Decrypt a row in place, if it needs it.
 *
 * Mutating the row rather than returning a new one is deliberate: `toMessage`
 * and every caller downstream already read `row.body`, and threading a second
 * body through all of them would be a wide change for no gain.
 */
export async function openRow(row: MessageRow): Promise<boolean> {
  if (row.encryption !== 'v1' || !row.envelope) return true;

  /*
   * Receiving one is proof too, and cheaper proof than asking. A tab that has
   * read an encrypted message in this conversation never needs the server's
   * memory to know it must not send plaintext into it.
   */
  encrypted.add(row.conversation_id);

  try {
    const identity = await deviceIdentity();
    const plaintext = await decryptMessage(
      row.body,
      row.envelope,
      identity.deviceId,
      identity.keyPair,
    );
    row.body = plaintext ?? UNREADABLE;
    return plaintext !== undefined;
  } catch {
    /*
     * A stated sentence, never an error and never an empty bubble. An empty
     * bubble is a bug report; a sentence is information.
     */
    row.body = UNREADABLE;
    return false;
  }
}

/**
 * Decrypts a page, and reports whether every row actually opened.
 *
 * The return value exists because of a real incident: a message that had
 * arrived perfectly well was seen turning into the placeholder. The server
 * copy was fine - the ciphertext and a wrap for that device were both present
 * - so the failure was local and, in principle, temporary.
 *
 * What made it permanent was the cache. `openRow` writes the placeholder into
 * `row.body`, and the page is then sealed to disk as if it were the message.
 * One transient failure therefore became the stored text, served ahead of the
 * network on every later open. A momentary problem was promoted to a
 * permanent one by the thing meant to make reading faster.
 *
 * So the caller is told, and declines to cache a page it could not fully read.
 */
export async function openRows(rows: MessageRow[]): Promise<boolean> {
  const results = await Promise.all(rows.map(openRow));
  return results.every(Boolean);
}

// -- row-per-message --------------------------------------------------------
//
// Written beside the page blob rather than instead of it. The blob is still
// what the newest page is served from; the rows are what everything *older*
// than it is served from, which is the part the blob was never able to hold.
//
// Milestone 2 wrote these without reading them, so the two representations
// could be compared on real data before anything depended on the new one - see
// `verifyRowStore`, which still runs. Milestone 4 is that dependency: reads.

/** What the row store holds per message. Sealed, like every other record. */
export interface StoredRow {
  id: string;
  conversationId: string;
  createdAt: number;
  /** The decrypted body. Same trust boundary as the blob it mirrors. */
  message: unknown;
}

/**
 * Writes one page of messages as individual rows.
 *
 * Called after the blob is written, and never instead of it. A failure here
 * must not affect what the user sees, so it resolves rather than throwing  - 
 * the row store is a shadow copy under evaluation, not a source of truth.
 */
export async function writeMessageRows(
  conversationId: string,
  messages: Array<{ id: string; createdAt: number }>,
): Promise<number> {
  try {
    const entries: Array<[string, unknown]> = [];
    for (const message of messages) {
      const row: StoredRow = {
        id: message.id,
        conversationId,
        createdAt: message.createdAt,
        message,
      };
      entries.push([
        messageRowKey(conversationId, message.createdAt, message.id),
        await sealRecord(row),
      ]);
    }
    await localPutMany(STORE.messageRows, entries);
    return entries.length;
  } catch {
    return 0;
  }
}

/** Opens a run of sealed rows, dropping any that will not open. */
async function openStoredRows<T>(sealed: unknown[]): Promise<T[]> {
  const rows: T[] = [];
  for (const record of sealed) {
    const opened = await openRecord<StoredRow>(record);
    if (opened) rows.push(opened.message as T);
  }
  return rows;
}

/** Reads back the newest rows for a conversation, oldest-first. */
export async function readMessageRows<T>(
  conversationId: string,
  limit = 50,
): Promise<T[]> {
  return openStoredRows<T>(
    await localRange<unknown>(STORE.messageRows, messageRowRange(conversationId), limit),
  );
}

/**
 * The page immediately older than one message, oldest-first.
 *
 * This is the read that makes the row store worth writing. Until now it was
 * written on every fetch and read only by the backup builder, so scrolling back
 * through a conversation asked the server for history the device was already
 * holding - and asked in vain on a train.
 *
 * `undefined` rather than an empty array when the anchor is not stored: the two
 * mean different things. Empty is "nothing older is here", which a caller may
 * treat as the end of history; `undefined` is "this device cannot answer", and
 * the caller must ask the server instead.
 */
export async function readMessageRowsBefore<T>(
  conversationId: string,
  beforeId: string,
  limit = 50,
  /** The oldest key this device knows to be part of a gapless run. */
  floor?: string,
): Promise<T[] | undefined> {
  const bounds = rowKeyBoundsBefore(
    conversationId,
    await localKeys(STORE.messageRows, messageRowRange(conversationId)),
    beforeId,
    floor,
  );
  if (!bounds) return undefined;

  return openStoredRows<T>(
    await localRange<unknown>(
      STORE.messageRows,
      IDBKeyRange.bound(bounds.lower, bounds.upper, false, true),
      limit,
    ),
  );
}

/** What an integrity check found. Reported, not acted on. */
export interface RowStoreIntegrity {
  conversationId: string;
  blobCount: number;
  rowCount: number;
  /** Ids in the blob with no matching row. The failure that loses messages. */
  missingFromRows: string[];
  /** Ids in rows but not the blob. Usually eviction, not corruption. */
  extraInRows: string[];
  agrees: boolean;
}

/**
 * Compares the two representations for one conversation.
 *
 * The point of dual-write is that this can be run on real data before anything
 * depends on the new store. Ids only: comparing bodies would mean holding two
 * decrypted copies of a conversation in memory to prove a point about keys.
 */
export async function verifyRowStore(
  conversationId: string,
  blobMessages: Array<{ id: string }>,
): Promise<RowStoreIntegrity> {
  const rows = await readMessageRows<{ id: string }>(conversationId, 500);
  const blobIds = new Set(blobMessages.map((m) => m.id));
  const rowIds = new Set(rows.map((r) => r.id));

  const missingFromRows = [...blobIds].filter((id) => !rowIds.has(id));
  const extraInRows = [...rowIds].filter((id) => !blobIds.has(id));

  return {
    conversationId,
    blobCount: blobIds.size,
    rowCount: rowIds.size,
    missingFromRows,
    extraInRows,
    // Only the missing direction is a fault. Extra rows are history the blob
    // never held, which is what the row store exists to make possible.
    agrees: missingFromRows.length === 0,
  };
}

// -- the local cache -------------------------------------------------------
//
// Encrypted at rest with this device's database key. A stolen laptop, a shared
// phone or a profile backup all reach IndexedDB, and "the server cannot read
// it" is a thin promise if the disk can.

interface SealedRecord {
  /** Marks a record as sealed, so an older plaintext one is still readable. */
  v: 1;
  iv: string;
  data: string;
}

function isSealed(value: unknown): value is SealedRecord {
  return typeof value === 'object' && value !== null && (value as SealedRecord).v === 1;
}

/** Encrypts any structured value for storage. */
export async function sealRecord(value: unknown): Promise<SealedRecord> {
  const key = await databaseKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );

  return { v: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

/**
 * Purges anything on disk that is not sealed.
 *
 * The cache predates encryption, so every existing device holds plaintext
 * records written by an older build. An earlier draft of this module simply
 * tolerated them - read them back as-is and let them be replaced whenever that
 * conversation next happened to be opened. Checking in the browser showed what
 * that means in practice: a conversation nobody reopens keeps its readable
 * copy on disk indefinitely. For a feature whose entire claim is that the disk
 * is not readable, "eventually, if you visit it" is not a claim at all.
 *
 * Losing them costs one network fetch. Keeping them costs the guarantee.
 */
let purged: Promise<void> | undefined;

export function purgeUnsealedCache(): Promise<void> {
  purged ??= (async () => {
    for (const store of [STORE.conversations, STORE.messages, STORE.outbox] as const) {
      for (const [key, value] of await localEntries<unknown>(store)) {
        if (!isSealed(value)) await localDelete(store, key);
      }
    }
    await purgeForeignRecords();
  })().catch(() => undefined);

  return purged;
}

/**
 * Drop records this device is sealed out of.
 *
 * Distinct from the purge above, which removes values that were never sealed.
 * These *are* sealed, correctly, under a database key this device no longer
 * holds - rows left behind when an account switch failed to clear
 * `message-rows`, which it did for as long as that store existed. They are
 * unreadable rather than exposed, but they are another account's messages
 * sitting in this one's store, and they made an archive carry two records out
 * of fifty-two while reporting success.
 *
 * ## The guard matters more than the sweep
 *
 * "Will not open" and "cannot be opened right now" look identical from here,
 * and deleting on the second would destroy good data on a transient failure.
 * So nothing is removed unless the key itself is available *and* at least one
 * record has been proven to open with it. If this device cannot read anything,
 * the right conclusion is that the key is wrong, not that every message is.
 */
async function purgeForeignRecords(): Promise<void> {
  let key: CryptoKey;
  try {
    key = await databaseKey();
  } catch {
    return;
  }

  const stores = [STORE.conversations, STORE.messages, STORE.messageRows] as const;
  const candidates: Array<{ store: (typeof stores)[number]; key: string }> = [];
  let proven = false;

  for (const store of stores) {
    for (const [id, value] of await localEntries<unknown>(store)) {
      if (!isSealed(value)) continue;
      try {
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(value.iv) },
          key,
          fromBase64(value.data),
        );
        proven = true;
      } catch {
        candidates.push({ store, key: id });
      }
    }
  }

  // Nothing opened: assume the key, not the data, is what is wrong.
  if (!proven) return;

  for (const { store, key: id } of candidates) await localDelete(store, id);
}

/**
 * Reads a record back.
 *
 * Unsealed values are refused rather than returned. They should already have
 * been purged above; this is the second lock on the same door, and it means no
 * future caller can reintroduce plaintext by writing to a store directly.
 */
export async function openRecord<T>(stored: unknown): Promise<T | undefined> {
  if (stored === undefined) return undefined;
  if (!isSealed(stored)) return undefined;

  try {
    const key = await databaseKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(stored.iv) },
      key,
      fromBase64(stored.data),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    // The database key was regenerated - a cleared origin, a new sign-in. The
    // cache is an optimisation, so a miss costs a network round trip.
    return undefined;
  }
}
