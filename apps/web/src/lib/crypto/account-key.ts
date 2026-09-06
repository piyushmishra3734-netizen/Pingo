/**
 * One key per account, so the history belongs to the person and not the phone.
 *
 * ## What this replaces
 *
 * Messages used to be wrapped only to *devices*. A new phone mints a new
 * keypair, so nothing sent before it existed had a wrap it could open, and the
 * thread read "Sent before you added this device." from top to bottom. The
 * ciphertext was still on the server; it was simply unreadable by the one
 * person entitled to it.
 *
 * The per-user key that fixes it already existed - `recovery_packages`, and the
 * `recovery:` wrap that `conversationKeying` has been adding to every envelope
 * all along. Two things kept it out of reach, and both are gone:
 *
 *   - it was opt-in behind Secure Backup, so 37 of 41 accounts never made one;
 *   - claiming it needed a recovery request, a maturity delay, and an approval
 *     tapped on another device - which is exactly the device that somebody
 *     replacing a lost phone does not have.
 *
 * So the key is made on first run without asking, and a new device claims it by
 * signing in. Nothing to write down, nothing to keep safe for the rest of your
 * life, nothing to lose along with the phone.
 *
 * ## What it costs, stated plainly
 *
 * The package is wrapped under a random secret that the server stores beside
 * it. PINGO therefore holds material that can open message bodies. Bodies stay
 * encrypted - an RLS mistake still cannot leak them, and neither can a dump of
 * the message table on its own - but "operators see ciphertext, not readable
 * chat text" is no longer true, and the privacy policy says so.
 *
 * That is the trade the product asked for: a chat history that survives a lost
 * phone, against a guarantee that only ever held for the four people who
 * enrolled.
 *
 * ## Ordering
 *
 * `accountKey` is safe to call before the server has the functions this needs.
 * A missing RPC is treated as "no key yet, and none can be made", which leaves
 * the app behaving exactly as it did before - device wraps only. That is what
 * makes the client deployable ahead of the migration rather than after it.
 */

import { STORE, localGet, localSet } from '../local/db.js';
import type { PingoSupabaseClient } from '../supabase/client.js';

import { createRecoveryKey, restoreRecoveryKey } from './recovery.js';

/** Named like its neighbours in `keys.ts`, so a v2 can sit beside it. */
const ACCOUNT = 'account:v1';

/**
 * Hex, not base64, and that is load-bearing.
 *
 * `wrappingKey` runs the secret through `normaliseRecoveryCode`, which
 * lowercases - it exists so a person retyping twelve words is not punished for
 * capitals. Lowercasing base64 would fold `A` onto `a` and the secret would
 * not survive the round trip. Lowercase hex is already normalised, so the
 * whole recovery module is reused unchanged.
 *
 * 32 bytes. The wrap is only as strong as this, and nothing about it is typed
 * by a human, so there is no reason to pick less.
 */
function newSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * In flight once, however many callers ask.
 *
 * Opening a thread, sealing a send and the first realtime row all want this
 * within the same tick of a cold start. Without this they would each claim,
 * each unwrap, and two of them would write the same key back to IndexedDB.
 */
let pending: Promise<CryptoKey | undefined> | undefined;

/**
 * This account's key: from disk, from the server, or newly made.
 *
 * Resolves `undefined` rather than throwing when it cannot be had. Every caller
 * is on a path that has a correct answer without it - `openRow` falls back to
 * the device wrap, `sealBody` falls back to wrapping for devices only - and a
 * throw here would take out message decryption for a network blip.
 */
export function accountKey(client: PingoSupabaseClient): Promise<CryptoKey | undefined> {
  pending ??= load(client).finally(() => {
    // Cleared so a failed attempt is retried on the next message rather than
    // cached as "this account has no key" for the life of the tab.
    pending = undefined;
  });
  return pending;
}

async function load(client: PingoSupabaseClient): Promise<CryptoKey | undefined> {
  const stored = await localGet<CryptoKey>(STORE.keys, ACCOUNT);
  if (stored) return stored;

  if (unavailable) return undefined;

  const claimed = await claim(client);
  if (claimed === UNAVAILABLE) {
    unavailable = true;
    return undefined;
  }
  if (claimed) return claimed;

  return mint(client);
}

/**
 * The server has no account key functions yet.
 *
 * Distinct from "this account has no key", because the two want opposite
 * things: no key means make one, no *function* means this build is running
 * ahead of its migration and must not try. Without the distinction every
 * session would fire a doomed claim and then a doomed insert, twice per user
 * per launch, and log both.
 */
const UNAVAILABLE = Symbol('account key unavailable');

/**
 * Remembered, because the answer cannot change while this tab is open.
 *
 * A missing function is a migration that has not been applied, not a blip, and
 * `adoptAccountKey` is called from the session-resolve path - so without this
 * every load fired the same doomed claim again. Measured on a cold start: three
 * of them, before anyone had done anything.
 */
let unavailable = false;

/** The key this account already has, unwrapped and kept. */
async function claim(
  client: PingoSupabaseClient,
): Promise<CryptoKey | typeof UNAVAILABLE | undefined> {
  const { data, error } = await client.rpc('claim_account_key');

  // PGRST202: no such function. Anything else is a blip worth retrying later.
  if (error) return error.code === 'PGRST202' ? UNAVAILABLE : undefined;
  if (!data || data.length === 0) return undefined;

  const row = data[0];
  if (!row) return undefined;

  /*
   * A package from before this existed has no secret: it is wrapped under a
   * twelve-word code that only its owner has ever seen, and nothing here can
   * open it. Left alone rather than replaced - overwriting it would strand the
   * one person who did enrol, and `mint` refuses for the same reason.
   */
  if (!row.secret) return undefined;

  try {
    const key = await restoreRecoveryKey(
      { version: row.version, kdf: row.kdf, salt: row.salt, iv: row.iv, package: row.package },
      row.secret,
    );
    await localSet(STORE.keys, ACCOUNT, key);
    return key;
  } catch {
    // A package that will not open is a bug worth seeing, not a reason to mint
    // a second key over the top of the one every existing message is wrapped to.
    console.warn('pingo: the account key would not open.');
    return undefined;
  }
}

/** First run on this account: make one, publish the public half, keep the rest. */
async function mint(client: PingoSupabaseClient): Promise<CryptoKey | undefined> {
  const secret = newSecret();
  const created = await createRecoveryKey(secret, 1);

  const { error } = await client.rpc('upsert_account_key', {
    new_kdf: created.package.kdf,
    new_salt: created.package.salt,
    new_iv: created.package.iv,
    new_package: created.package.package,
    new_public_key: created.publicKey,
    new_secret: secret,
    new_version: created.package.version,
  });

  /*
   * Not stored locally when the upload failed, and that is the whole point of
   * the order. A key kept here but never published would open nothing - no
   * sender would have wrapped to it - while looking to every later call like a
   * key this account already has.
   */
  if (error) return undefined;

  await localSet(STORE.keys, ACCOUNT, created.privateKey);
  return created.privateKey;
}

/** Dropped on sign-out, with everything else this device knows. */
export function forgetAccountKey(): void {
  pending = undefined;
  // Not `unavailable`: whether the server has the function is a property of the
  // deployment, not of who is signed in.
}
