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
    const identity = await deviceIdentity();
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

/**
 * Every device that should be able to read messages in this conversation.
 *
 * Includes the sender's own devices. Leaving them out would mean writing
 * messages you cannot read back — the sent thread would go blank on reload,
 * which is a spectacular way to lose a conversation.
 */
export async function recipientDevices(
  client: PingoSupabaseClient,
  conversationId: string,
): Promise<RecipientDevice[]> {
  const { data: members } = await client
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  const userIds = (members ?? []).map((m) => m.user_id);
  if (userIds.length === 0) return [];

  const { data: rows } = await client
    .from('device_keys')
    .select('device_id,public_key')
    .in('user_id', userIds);

  return (rows ?? []).map((row) => ({
    deviceId: row.device_id,
    publicKey: row.public_key,
  }));
}

/** What `sendMessage` merges into the row it inserts. */
export interface SealedBody {
  body: string;
  encryption: 'v1' | null;
  envelope: MessageRow['envelope'];
}

/**
 * Encrypt a body for a conversation, or hand it back untouched.
 *
 * Falls back to legacy plaintext in exactly one case: nobody in the
 * conversation has published a key, so there is no one to encrypt to. That
 * happens for a recipient still on an old build, and refusing to send would
 * make PINGO look broken to the person who did nothing wrong.
 *
 * The fallback is narrow on purpose. Any *failure* of the crypto propagates
 * rather than silently downgrading — an encryption bug that quietly posts
 * plaintext is worse than one that stops the send, because nobody finds out.
 */
export async function sealBody(
  client: PingoSupabaseClient,
  conversationId: string,
  body: string,
): Promise<SealedBody> {
  const devices = await recipientDevices(client, conversationId);
  if (devices.length === 0) return { body, encryption: null, envelope: null };

  const sealed = await encryptMessage(body, devices);
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
 * Reads a record back, tolerating one written before this existed.
 *
 * An unsealed value is returned as-is rather than rejected. The cache predates
 * encryption, and treating the old plaintext records as corrupt would empty
 * every existing user's offline history on the day they update.
 */
export async function openRecord<T>(stored: unknown): Promise<T | undefined> {
  if (stored === undefined) return undefined;
  if (!isSealed(stored)) return stored as T;

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
