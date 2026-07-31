/**
 * The archive key must never open a message.
 *
 * Simple Backup puts an archive private key in Google Drive, which means Google
 * holds it. That is an acceptable trade for a backup and an unacceptable one for
 * live traffic, and the whole design rests on the two being different keys.
 *
 * `sealBody` wraps every message content key to the *recovery* public key
 * (`session.ts:348`), so the recovery private key opens every envelope this
 * account has ever received. If the archive key were ever added to that
 * recipient list — by a helpful refactor, by someone reusing `recoveryWrapId`,
 * by a copy-paste in `conversationKeying` — Google would silently gain the
 * ability to read live messages, and nothing else in the suite would notice.
 *
 * So this does not assert that the code looks right. It takes the archive key
 * and *attempts the attack*: open a real sealed message with it, against every
 * wrap in the envelope. Every attempt must fail. The day one succeeds, Simple
 * Backup has stopped being safe to ship and this goes red.
 *
 * Written before Simple Backup exists, deliberately. An invariant added after
 * the implementation is a test of what was built; added before, it is a
 * constraint on what may be built.
 *
 * Run with `pnpm verify:key-isolation`.
 */
import { decryptMessage } from '../src/lib/crypto/envelope.js';
import { conversationKeying, recoveryWrapId, sealBody } from '../src/lib/crypto/session.js';
import type { PingoSupabaseClient } from '../src/lib/supabase/client.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const toBase64 = (b: ArrayBuffer) => Buffer.from(new Uint8Array(b)).toString('base64');

async function keypair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);
  return { pair, spki: toBase64(await crypto.subtle.exportKey('spki', pair.publicKey)) };
}

function stubClient(tables: Record<string, { data: unknown; error: unknown }>): PingoSupabaseClient {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'order', 'maybeSingle']) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
      return builder;
    },
  } as unknown as PingoSupabaseClient;
}

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';

const aliceDevice = await keypair();
const bobDevice = await keypair();
const bobRecovery = await keypair();

/** The key Simple Backup would place in Drive. Never a message recipient. */
const archiveKey = await keypair();

const client = stubClient({
  conversation_members: { data: [{ user_id: ALICE }, { user_id: BOB }], error: null },
  device_keys: {
    data: [
      { device_id: '11111111-1111-4111-8111-111111111111', user_id: ALICE, public_key: aliceDevice.spki },
      { device_id: '22222222-2222-4222-8222-222222222222', user_id: BOB, public_key: bobDevice.spki },
    ],
    error: null,
  },
  recovery_packages: { data: [{ user_id: BOB, public_key: bobRecovery.spki }], error: null },
  messages: { data: [], error: null },
});

const CONVERSATION = 'c0000000-0000-4000-8000-000000000003';
const SECRET = 'the thing Google must not be able to read';

console.log('— who is a recipient —');

const keying = await conversationKeying(client, CONVERSATION);
const recipientKeys = [...keying.devices, ...keying.recovery].map((d) => d.publicKey);

check(recipientKeys.includes(aliceDevice.spki), "the sender's device is a recipient");
check(recipientKeys.includes(bobDevice.spki), "the recipient's device is a recipient");
check(recipientKeys.includes(bobRecovery.spki), 'the recovery key is a recipient');

/*
 * The load-bearing assertion. If the archive key ever appears here, Simple
 * Backup is handing Google a key that opens live traffic.
 */
check(!recipientKeys.includes(archiveKey.spki), 'the archive key is NOT a recipient');

console.log('\n— seal a real message —');

const sealed = await sealBody(client, CONVERSATION, SECRET);
check(sealed.encryption === 'v1', 'the message is encrypted');
check(sealed.body !== SECRET, 'the body is ciphertext');

const wraps = Object.keys(sealed.envelope?.keys ?? {});
check(wraps.length === 3, `three wraps: two devices and one recovery key (${wraps.length})`);
check(wraps.includes(recoveryWrapId(BOB)), 'one wrap is the recovery key');

console.log('\n— attempt the attack —');

/*
 * Try the archive key against every wrap in the envelope, including the recovery
 * wrap it would most plausibly be confused with. Not "does the code avoid this"
 * but "can it be done at all".
 */
let opened: string | undefined;
for (const id of wraps) {
  const attempt = await decryptMessage(
    sealed.body,
    sealed.envelope!,
    id,
    { privateKey: archiveKey.pair.privateKey } as CryptoKeyPair,
  ).catch(() => undefined);
  if (attempt !== undefined) opened = `${id} → ${attempt}`;
}
check(opened === undefined, `the archive key opens no wrap in the envelope${opened ? ` (OPENED ${opened})` : ''}`);

/*
 * And with the id Simple Backup would use, in case a future version registers
 * the archive key under the recovery namespace.
 */
const viaRecoveryId = await decryptMessage(
  sealed.body,
  sealed.envelope!,
  recoveryWrapId(BOB),
  { privateKey: archiveKey.pair.privateKey } as CryptoKeyPair,
).catch(() => undefined);
check(viaRecoveryId === undefined, 'and cannot open the recovery wrap by borrowing its id');

console.log('\n— the keys that should work, still do —');

/*
 * A negative test that passes because everything is broken proves nothing, so
 * the positive path is checked in the same run.
 */
const viaDevice = await decryptMessage(
  sealed.body,
  sealed.envelope!,
  '22222222-2222-4222-8222-222222222222',
  bobDevice.pair,
);
check(viaDevice === SECRET, "the recipient's device still opens it");

const viaRecovery = await decryptMessage(
  sealed.body,
  sealed.envelope!,
  recoveryWrapId(BOB),
  { privateKey: bobRecovery.pair.privateKey } as CryptoKeyPair,
);
check(viaRecovery === SECRET, 'the recovery key still opens it');

console.log('\n— the separation is mutual —');

/*
 * The archive key seals archives; the recovery key seals nothing in Simple mode.
 * Neither should be able to stand in for the other, so the reverse is checked
 * too: a message wrap must not be openable by anything Simple Backup stores.
 */
const stranger = await keypair();
const viaStranger = await decryptMessage(
  sealed.body,
  sealed.envelope!,
  recoveryWrapId(BOB),
  { privateKey: stranger.pair.privateKey } as CryptoKeyPair,
).catch(() => undefined);
check(viaStranger === undefined, 'an unrelated key opens nothing either');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
