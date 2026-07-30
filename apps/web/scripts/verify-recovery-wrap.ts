/**
 * Recovery wrapping, exercised through `sealBody` as shipped.
 *
 * The question this answers is narrow and worth stating: does a message sent
 * today carry a wrap that a device which does not yet exist could open
 * tomorrow? Wrapping is the whole of recovery — a recovery key that no message
 * was ever wrapped for restores nothing.
 *
 * `sealBody` is called for real. Only the Supabase client is a stand-in, and it
 * returns the same shapes PostgREST does, so the keying logic, the envelope and
 * both crypto paths are the shipping ones. Node's Web Crypto is the same API
 * the browser and the Android WebView expose.
 *
 * Run with `pnpm verify:recovery-wrap`.
 */
import { decryptMessage } from '../src/lib/crypto/envelope.js';
import { createRecoveryKey, generateRecoveryCode, restoreRecoveryKey } from '../src/lib/crypto/recovery.js';
import { conversationKeying, recoveryWrapId, sealBody } from '../src/lib/crypto/session.js';
import type { PingoSupabaseClient } from '../src/lib/supabase/client.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const toBase64 = (bytes: ArrayBuffer) => Buffer.from(new Uint8Array(bytes)).toString('base64');

/** A device, as `device_keys` would hand it back. */
async function makeDevice(deviceId: string, userId: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
  return {
    row: {
      device_id: deviceId,
      user_id: userId,
      public_key: toBase64(await crypto.subtle.exportKey('spki', pair.publicKey)),
    },
    pair,
  };
}

/**
 * Enough of the client for `conversationKeying` and `hasEncryptedHistory`.
 *
 * Every builder method returns the builder and the object is thenable, which is
 * how postgrest-js behaves — awaiting the chain is what runs it.
 */
function stubClient(tables: Record<string, { data: unknown; error: unknown }>): PingoSupabaseClient {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'limit', 'order', 'maybeSingle']) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
      return builder;
    },
  } as unknown as PingoSupabaseClient;
}

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CONVERSATION = 'c0000000-0000-4000-8000-000000000003';

const alice = await makeDevice('11111111-1111-4111-8111-111111111111', ALICE);
const bob = await makeDevice('22222222-2222-4222-8222-222222222222', BOB);

const code = generateRecoveryCode();
const bobRecovery = await createRecoveryKey(code);

const members = { data: [{ user_id: ALICE }, { user_id: BOB }], error: null };
const devices = { data: [alice.row, bob.row], error: null };
const noHistory = { data: [], error: null };

console.log('— with Secure Backup enabled —');

const enrolled = stubClient({
  conversation_members: members,
  device_keys: devices,
  recovery_packages: {
    data: [{ user_id: BOB, public_key: bobRecovery.publicKey }],
    error: null,
  },
  messages: noHistory,
});

const keying = await conversationKeying(enrolled, CONVERSATION);
check(keying.everyoneReady, 'everyoneReady still decided by devices alone');
check(keying.recovery.length === 1, 'one recovery recipient, for the enrolled member only');
check(keying.recovery[0]?.deviceId === recoveryWrapId(BOB), 'recovery wrap id is namespaced');

const sealed = await sealBody(enrolled, CONVERSATION, 'the cat sat on the mat');
check(sealed.encryption === 'v1', 'still encrypts as v1');
check(sealed.body !== 'the cat sat on the mat', 'body is ciphertext, not the plaintext');

const wrapped = Object.keys(sealed.envelope?.keys ?? {});
check(wrapped.includes(alice.row.device_id), "wrapped for the sender's device");
check(wrapped.includes(bob.row.device_id), "wrapped for the recipient's device");
check(wrapped.includes(recoveryWrapId(BOB)), 'wrapped for the recovery key');
check(wrapped.length === 3, 'exactly three wraps, no extras');

console.log('\n— the wraps actually open —');

const viaDevice = await decryptMessage(
  sealed.body,
  sealed.envelope!,
  bob.row.device_id,
  bob.pair,
);
check(viaDevice === 'the cat sat on the mat', "recipient's device opens it");

/*
 * The restore path, as a new device would run it: the private key comes back
 * out of the package with the code, and nothing of the old device is used.
 * `decryptMessage` reads only `privateKey`, so a bare key stands in for a pair.
 */
const restored = await restoreRecoveryKey(bobRecovery.package, code);
const viaRecovery = await decryptMessage(
  sealed.body,
  sealed.envelope!,
  recoveryWrapId(BOB),
  { privateKey: restored } as CryptoKeyPair,
);
check(viaRecovery === 'the cat sat on the mat', 'the recovery key opens it on a device that never saw the message');

const wrongCode = generateRecoveryCode();
let refused = false;
try {
  await restoreRecoveryKey(bobRecovery.package, wrongCode);
} catch {
  refused = true;
}
check(refused, 'a wrong code cannot reach the recovery key');

console.log('\n— without Secure Backup, nothing changes —');

const plain = stubClient({
  conversation_members: members,
  device_keys: devices,
  recovery_packages: { data: [], error: null },
  messages: noHistory,
});

const plainKeying = await conversationKeying(plain, CONVERSATION);
check(plainKeying.recovery.length === 0, 'no recovery recipients');
check(plainKeying.everyoneReady, 'everyoneReady unaffected');

const plainSealed = await sealBody(plain, CONVERSATION, 'hello');
const plainWraps = Object.keys(plainSealed.envelope?.keys ?? {});
check(plainSealed.encryption === 'v1', 'still encrypts');
check(plainWraps.length === 2, 'exactly the two devices, as before');
check(
  !plainWraps.some((id) => id.startsWith('recovery:')),
  'no recovery entry appears in the envelope',
);

console.log('\n— guarantees that must not have moved —');

/*
 * A member with no device keeps the conversation unencrypted, whether or not
 * anybody has recovery. Recovery adds a reader; it must never be mistaken for
 * a member being ready.
 */
const missingDevice = stubClient({
  conversation_members: members,
  device_keys: { data: [alice.row], error: null },
  recovery_packages: {
    data: [{ user_id: BOB, public_key: bobRecovery.publicKey }],
    error: null,
  },
  messages: noHistory,
});

/*
 * A conversation of its own, deliberately.
 *
 * `sealBody` remembers that a conversation has carried an encrypted message and
 * refuses to fall back to plaintext in it afterwards — reusing the id above
 * would exercise that rule rather than this one, which is exactly what it did
 * the first time this was written.
 */
const UNREADY_CONVERSATION = 'c0000000-0000-4000-8000-000000000004';

const notReady = await conversationKeying(missingDevice, UNREADY_CONVERSATION);
check(!notReady.everyoneReady, 'a member without a device is still not ready');

const legacy = await sealBody(missingDevice, UNREADY_CONVERSATION, 'hello');
check(legacy.encryption === null, 'a recovery key does not make a chat encryptable');
check(legacy.envelope === null, 'and writes no envelope');

/*
 * A recovery lookup that fails must cost recoverability and nothing else. The
 * message still has to send, and it still has to be encrypted for the devices.
 */
const brokenRecovery = stubClient({
  conversation_members: members,
  device_keys: devices,
  recovery_packages: { data: null, error: { message: 'boom' } },
  messages: noHistory,
});

const degraded = await sealBody(brokenRecovery, 'c0000000-0000-4000-8000-000000000005', 'hello');
check(degraded.encryption === 'v1', 'a failed recovery lookup still sends, encrypted');
check(
  Object.keys(degraded.envelope?.keys ?? {}).length === 2,
  'and falls back to devices only',
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
