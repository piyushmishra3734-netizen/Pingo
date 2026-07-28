import { STORE, localClear, localDelete, localEntries, localGet, localSet } from '../local/db.js';
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
      await localClear();
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
export async function openRow(row: MessageRow): Promise<void> {
  if (row.encryption !== 'v1' || !row.envelope) return;

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
  } catch {
    /*
     * A stated sentence, never an error and never an empty bubble. An empty
     * bubble is a bug report; a sentence is information.
     */
    row.body = UNREADABLE;
  }
}

/** Decrypts a page. Concurrent because each row is independent. */
export async function openRows(rows: MessageRow[]): Promise<void> {
  await Promise.all(rows.map(openRow));
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
