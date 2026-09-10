/**
 * Re-addressing a message to a key it was never sent to.
 *
 * The claim being tested is narrow and load-bearing: a wrap made after the fact
 * opens the *same, unmodified* ciphertext, and making it never produces the
 * plaintext at all. If that is not true then the backfill is either useless or
 * it is a decryption pass wearing a repair's clothes.
 *
 * `rewrapContentKey`, `decryptMessage` and `encryptMessage` are the shipping
 * ones. Node's Web Crypto is the same API the browser and the Android WebView
 * expose, so this is the real construction and not a model of it.
 *
 *   node apps/web/scripts/run-ts.mjs apps/web/scripts/verify-account-backfill.ts
 */
import {
  decryptMessage,
  encryptMessage,
  keysArePair,
  rewrapContentKey,
  type Envelope,
} from '../src/lib/crypto/envelope.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const toBase64 = (bytes: ArrayBuffer) => Buffer.from(new Uint8Array(bytes)).toString('base64');

async function keypair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);
  return { pair, publicKey: toBase64(await crypto.subtle.exportKey('spki', pair.publicKey)) };
}

const OLD_PHONE = 'd1000000-0000-4000-8000-000000000001';
const TEXT = 'the message that predates the key that replaced the key';

const phone = await keypair();
const account = await keypair();
const stranger = await keypair();

// A message as it was actually sent: wrapped to one device, and to nothing else.
const sealed = await encryptMessage(TEXT, [{ deviceId: OLD_PHONE, publicKey: phone.publicKey }]);
const bodyBefore = sealed.body;
const envelopeBefore = JSON.stringify(sealed.envelope);

// -- the situation ----------------------------------------------------------

check(
  (await decryptMessage(sealed.body, sealed.envelope, OLD_PHONE, phone.pair)) === TEXT,
  'the old device reads the message',
);

check(
  (await decryptMessage(sealed.body, sealed.envelope, 'account-wrap', {
    privateKey: account.pair.privateKey,
  })) === undefined,
  'the account key does not - there is no wrap for it, which is the whole bug',
);

// -- the repair -------------------------------------------------------------

const made = await rewrapContentKey(
  sealed.envelope.keys[OLD_PHONE]!,
  sealed.envelope.epk,
  phone.pair.privateKey,
  account.publicKey,
);

check(
  sealed.body === bodyBefore && JSON.stringify(sealed.envelope) === envelopeBefore,
  'making the wrap changed neither the ciphertext nor the envelope',
);

check(typeof made.epk === 'string' && made.epk !== sealed.envelope.epk, 'the new wrap brings its own ephemeral');

const side: Envelope = { epk: made.epk, iv: sealed.envelope.iv, keys: { 'account-wrap': made } };

check(
  (await decryptMessage(sealed.body, side, 'account-wrap', {
    privateKey: account.pair.privateKey,
  })) === TEXT,
  'and the account key now reads the same message, byte for byte',
);

check(
  (await decryptMessage(sealed.body, sealed.envelope, OLD_PHONE, phone.pair)) === TEXT,
  'while the old device still reads it - nothing was taken away',
);

// -- the wrap is a wrap, not a leak -----------------------------------------

check(
  !Buffer.from(made.key, 'base64').toString('utf8').includes(TEXT.slice(0, 8)),
  'the wrap does not carry the plaintext',
);

check(
  Buffer.from(made.key, 'base64').length === 48,
  'the wrap is a 32-byte content key plus its GCM tag, and nothing else',
);

// -- wrapping to the wrong key ----------------------------------------------

check(await keysArePair(account.pair.privateKey, account.publicKey), 'a real pair is recognised');
check(
  !(await keysArePair(account.pair.privateKey, stranger.publicKey)),
  'and a mismatched one is refused, before any wrap is made to it',
);

const wrong = await rewrapContentKey(
  sealed.envelope.keys[OLD_PHONE]!,
  sealed.envelope.epk,
  phone.pair.privateKey,
  stranger.publicKey,
);
check(
  (await decryptMessage(sealed.body, { epk: wrong.epk, iv: sealed.envelope.iv, keys: { w: wrong } }, 'w', {
    privateKey: account.pair.privateKey,
  }).catch(() => undefined)) === undefined,
  'a wrap made to the wrong public key opens nothing - which is why the pair is checked first',
);

// -- backward compatibility --------------------------------------------------
//
// Every wrap written before `epk` existed has none, and must keep working from
// the envelope's. This is the one-line change in `decryptMessage`, tested
// rather than assumed, because getting it wrong breaks every message ever sent.

const legacy: Envelope = {
  epk: sealed.envelope.epk,
  iv: sealed.envelope.iv,
  keys: { [OLD_PHONE]: { iv: sealed.envelope.keys[OLD_PHONE]!.iv, key: sealed.envelope.keys[OLD_PHONE]!.key } },
};
check(
  (await decryptMessage(sealed.body, legacy, OLD_PHONE, phone.pair)) === TEXT,
  "a wrap with no epk of its own still falls back to the envelope's",
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
