import {
  STORE,
  localDelete,
  localEntries,
  localGet,
  localPutMany,
  localRange,
  localSet,
  messageRowKey,
  messageRowRange,
} from '../local/db.js';
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
 * encrypted to it became permanently unreadable on that device — which is
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

  // Clear only what belongs to the previous account's *content*.
  for (const store of [STORE.conversations, STORE.messages, STORE.outbox, STORE.drafts, STORE.meta]) {
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
 * Announce this device's public key.
 *
 * Idempotent by primary key, so a reload updates `last_seen_at` rather than
 * accumulating rows. Failure is swallowed deliberately: not publishing means
 * other people cannot encrypt *to* this device yet, which is a degraded state,
 * not a broken one — the app still reads and sends. Blocking sign-in on it
 * would turn a sync hiccup into a login failure.
 */
export function publishDeviceKey(client: PingoSupabaseClient, userId: string): Promise<void> {
  published ??= (async () => {
    /*
     * Whose device is this?
     *
     * Now that signing out leaves the keys in place, the same browser can see
     * a second account sign in — a shared laptop, or someone switching between
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
    await localSet(STORE.keys, OWNER, userId);
    await client.from('device_keys').upsert(
      {
        device_id: identity.deviceId,
        user_id: userId,
        public_key: identity.publicKey,
        last_seen_at: new Date().toISOString(),
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
   * back — the sent thread would go blank on reload, which is a spectacular
   * way to lose a conversation.
   */
  devices: RecipientDevice[];
  /**
   * True only when *every* member has at least one published device.
   *
   * The distinction that matters. Encrypting for the devices that happen to
   * exist would produce a message the other side is cryptographically unable
   * to open — not a downgrade, which is at least readable, but mail nobody can
   * deliver. A conversation becomes encrypted when everyone in it can read it,
   * and not one message sooner.
   */
  everyoneReady: boolean;
}

/**
 * Errors propagate rather than being swallowed.
 *
 * A failed lookup means *not known*, and treating it as *nobody has keys* is
 * how a network blip turns into a message sent in the clear. The caller decides
 * what an unknown answer is worth; this refuses to invent a confident one.
 */
export async function conversationKeying(
  client: PingoSupabaseClient,
  conversationId: string,
): Promise<Keying> {
  const { data: members, error: membersError } = await client
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  if (membersError) throw membersError;

  const userIds = (members ?? []).map((m) => m.user_id);
  if (userIds.length === 0) return { devices: [], everyoneReady: false };

  const { data: rows, error: devicesError } = await client
    .from('device_keys')
    .select('device_id,public_key,user_id')
    .in('user_id', userIds);

  if (devicesError) throw devicesError;

  const covered = new Set((rows ?? []).map((row) => row.user_id));

  return {
    devices: (rows ?? []).map((row) => ({
      deviceId: row.device_id,
      publicKey: row.public_key,
    })),
    everyoneReady: userIds.every((id) => covered.has(id)),
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
 * records — this conversation has been encrypted at least once — cannot stop
 * being true.
 */
const encrypted = new Set<string>();

/**
 * Has this conversation ever carried a `v1` message?
 *
 * Asked of the server only when the in-memory latch has not already been set,
 * and only when a plaintext send is on the table — so the happy path never pays
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
 * quietly reverting — a thread that silently drops back to plaintext is the
 * worst failure this system can have, because it looks exactly like a thread
 * that is working.
 */
export async function sealBody(
  client: PingoSupabaseClient,
  conversationId: string,
  body: string,
): Promise<SealedBody> {
  const { devices, everyoneReady } = await conversationKeying(client, conversationId);

  if (!everyoneReady) {
    if (await hasEncryptedHistory(client, conversationId)) {
      throw new Error(
        'This chat is end-to-end encrypted, but a key for everyone in it is not available right now. Your message has not been sent.',
      );
    }
    return { body, encryption: null, envelope: null };
  }

  const sealed = await encryptMessage(body, devices);
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
 * copy was fine — the ciphertext and a wrap for that device were both present
 * — so the failure was local and, in principle, temporary.
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

// -- row-per-message, dual-written -----------------------------------------
//
// Milestone 2. These write beside the page blob rather than instead of it, and
// nothing reads from them for display yet. The blob stays authoritative until
// the two are shown to agree on real data, because a storage migration that
// cannot be checked is a storage migration that silently loses messages.

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
 * must not affect what the user sees, so it resolves rather than throwing —
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

/** Reads back the newest rows for a conversation, oldest-first. */
export async function readMessageRows<T>(
  conversationId: string,
  limit = 50,
): Promise<T[]> {
  const sealed = await localRange<unknown>(
    STORE.messageRows,
    messageRowRange(conversationId),
    limit,
  );

  const rows: T[] = [];
  for (const record of sealed) {
    const opened = await openRecord<StoredRow>(record);
    if (opened) rows.push(opened.message as T);
  }
  return rows;
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
 * tolerated them — read them back as-is and let them be replaced whenever that
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
  })().catch(() => undefined);

  return purged;
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
    // The database key was regenerated — a cleared origin, a new sign-in. The
    // cache is an optimisation, so a miss costs a network round trip.
    return undefined;
  }
}
