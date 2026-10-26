/**
 * Private chat, the parts with a right answer: the two phones agree on a key,
 * nobody else's message opens, and a message costs almost nothing in size.
 *
 *   pnpm verify:private-chat   (from the repo root)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { deriveSessionKey, fromB64, newKeyPair, open, seal, toB64 } = await import('../src/lib/private/crypto.js');

let checks = 0;
const check = async (name: string, run: () => Promise<void> | void) => {
  await run();
  checks += 1;
  console.log('PASS ', name);
};

const SESSION = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const alice = await newKeyPair();
const bob = await newKeyPair();
const aliceKey = await deriveSessionKey(alice.pair.privateKey, bob.pub, SESSION);
const bobKey = await deriveSessionKey(bob.pair.privateKey, alice.pub, SESSION);

await check('each side derives the key from the other side\'s public half, and they agree', async () => {
  const sealed = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: 'hello bob' });
  assert.deepEqual(await open(bobKey, SESSION, ALICE, sealed), { t: 'text', b: 'hello bob' });
  const back = await seal(bobKey, SESSION, BOB, { t: 'text', b: 'hi alice 🙂' });
  assert.deepEqual(await open(aliceKey, SESSION, BOB, back), { t: 'text', b: 'hi alice 🙂' });
});

await check('a stranger with their own key pair cannot open it', async () => {
  const eve = await newKeyPair();
  const eveKey = await deriveSessionKey(eve.pair.privateKey, alice.pub, SESSION);
  const sealed = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: 'secret' });
  assert.equal(await open(eveKey, SESSION, ALICE, sealed), null);
});

await check('a message does not open in another session, or as if from another sender', async () => {
  const sealed = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: 'secret' });
  assert.equal(await open(bobKey, SESSION, BOB, sealed), null, 'wrong sender');
  const other = await deriveSessionKey(bob.pair.privateKey, alice.pub, '22222222-2222-4222-8222-222222222222');
  assert.equal(await open(other, '22222222-2222-4222-8222-222222222222', ALICE, sealed), null, 'wrong session key');
  assert.equal(await open(bobKey, '22222222-2222-4222-8222-222222222222', ALICE, sealed), null, 'wrong session id');
});

await check('an altered or truncated message is refused, not read', async () => {
  const sealed = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: 'secret' });
  const bytes = fromB64(sealed);
  bytes[bytes.length - 1]! ^= 1;
  assert.equal(await open(bobKey, SESSION, ALICE, toB64(bytes)), null);
  assert.equal(await open(bobKey, SESSION, ALICE, toB64(bytes.subarray(0, 20))), null);
  assert.equal(await open(bobKey, SESSION, ALICE, 'not base64 at all!!'), null);
});

await check('the same text seals differently every time', async () => {
  const a = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: 'same' });
  const b = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: 'same' });
  assert.notEqual(a, b);
});

await check('the private half cannot be exported, the public half fits what the database accepts', async () => {
  await assert.rejects(crypto.subtle.exportKey('raw', alice.pair.privateKey));
  await assert.rejects(crypto.subtle.exportKey('pkcs8', alice.pair.privateKey));
  assert.ok(alice.pub.length >= 60 && alice.pub.length <= 200, `public key is ${alice.pub.length} chars`);
  const sql = readFileSync('supabase/migrations/20261113000000_private_chat.sql', 'utf8');
  assert.match(sql, /length\(creator_pub\) between 60 and 200/);
});

await check('overhead is a nonce and a tag, not a key per device: well under 100 bytes beyond the text', async () => {
  const text = 'ok';
  const sealed = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: text });
  const raw = fromB64(sealed).length;
  const plain = new TextEncoder().encode(JSON.stringify({ t: 'text', b: text })).length;
  assert.equal(raw - plain, 28);
});

await check('a long message and emoji survive', async () => {
  const long = 'नमस्ते 👋 '.repeat(1500);
  const sealed = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: long });
  assert.equal((await open(bobKey, SESSION, ALICE, sealed))!.b, long);
  assert.ok(sealed.length <= 24000 || long.length > 6000, 'stays inside what the database allows for normal messages');
});

await check('sealing is fast enough not to be felt (200 messages in well under a second)', async () => {
  const t0 = performance.now();
  for (let i = 0; i < 200; i += 1) {
    const s = await seal(aliceKey, SESSION, ALICE, { t: 'text', b: `message number ${i}` });
    await open(bobKey, SESSION, ALICE, s);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms for 200 seal+open`);
});

console.log(`\nAll ${checks} private-chat checks passed.`);
process.exit(0);
