/**
 * The encryption construction, exercised against real Web Crypto.
 *
 * Node exposes the same API the browser and the Android WebView do, so these
 * are the actual primitives rather than a mock. That matters: a mocked AES-GCM
 * would happily "pass" the tamper test below while the real one is what has to
 * reject it.
 *
 * It reproduces the pipeline from `src/lib/crypto/` rather than importing it,
 * because that module reaches into IndexedDB for key storage and there is no
 * IndexedDB in Node. The duplication is deliberate and is half the value: if
 * the two ever drift apart, one of them is wrong, and this is where that shows
 * up instead of in somebody's unreadable chat.
 *
 * Run with `pnpm verify:crypto`.
 */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (b) => Buffer.from(b).toString('base64');
const un64 = (s) => { const b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const INFO = enc.encode('pingo/v1/message-key-wrap');
const P = { name: 'ECDH', namedCurve: 'P-256' };

async function wrapFor(eph, pub, contentKey) {
  const theirs = await crypto.subtle.importKey('spki', un64(pub), P, true, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, eph.privateKey, 256);
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const wk = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const raw = await crypto.subtle.exportKey('raw', contentKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: b64(iv), key: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wk, raw)) };
}

async function encryptMessage(text, devices) {
  const ck = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, enc.encode(text));
  const eph = await crypto.subtle.generateKey(P, false, ['deriveBits']);
  const keys = {};
  for (const d of devices) keys[d.deviceId] = await wrapFor(eph, d.publicKey, ck);
  return { body: b64(ct), envelope: { epk: b64(await crypto.subtle.exportKey('spki', eph.publicKey)), iv: b64(iv), keys } };
}

async function decryptMessage(body, env, deviceId, identity) {
  const wrap = env.keys[deviceId];
  if (!wrap) return undefined;
  const epk = await crypto.subtle.importKey('spki', un64(env.epk), P, true, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, identity.privateKey, 256);
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const wk = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO }, hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const rawCk = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(wrap.iv) }, wk, un64(wrap.key));
  const ck = await crypto.subtle.importKey('raw', rawCk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(env.iv) }, ck, un64(body)));
}

const mk = async () => {
  const kp = await crypto.subtle.generateKey(P, false, ['deriveKey', 'deriveBits']);
  return { deviceId: crypto.randomUUID(), keyPair: kp, publicKey: b64(await crypto.subtle.exportKey('spki', kp.publicKey)) };
};

let fail = 0;
const say = (ok, what) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); };

const alice = await mk(), bobPhone = await mk(), bobLaptop = await mk(), mallory = await mk();
const text = 'Pings disappear. 🔥 Ünïcødé and a fairly long line to push past one AES block.';

const msg = await encryptMessage(text, [alice, bobPhone, bobLaptop]);

say(msg.body !== text && !msg.body.includes('Pings'), 'server body is ciphertext, not plaintext');
say(Object.keys(msg.envelope.keys).length === 3, 'one wrap per recipient device');
say(await decryptMessage(msg.body, msg.envelope, bobPhone.deviceId, bobPhone.keyPair) === text, "bob's phone decrypts");
say(await decryptMessage(msg.body, msg.envelope, bobLaptop.deviceId, bobLaptop.keyPair) === text, "bob's laptop decrypts the same message");
say(await decryptMessage(msg.body, msg.envelope, alice.deviceId, alice.keyPair) === text, 'sender can read it back');
say(await decryptMessage(msg.body, msg.envelope, mallory.deviceId, mallory.keyPair) === undefined, 'a device with no wrap gets undefined, not an error');

// Mallory holds a wrap id she is not the key for.
let rejected = false;
try { await decryptMessage(msg.body, msg.envelope, bobPhone.deviceId, mallory.keyPair); } catch { rejected = true; }
say(rejected, "wrong private key cannot open another device's wrap");

// Tamper with one byte of ciphertext.
const bad = Buffer.from(msg.body, 'base64'); bad[10] ^= 0xff;
let caught = false;
try { await decryptMessage(bad.toString('base64'), msg.envelope, bobPhone.deviceId, bobPhone.keyPair); } catch { caught = true; }
say(caught, 'tampered ciphertext is rejected by GCM, not silently decrypted');

const again = await encryptMessage(text, [bobPhone]);
say(again.envelope.epk !== msg.envelope.epk, 'a fresh ephemeral key per message');
say(again.body !== msg.body, 'same plaintext encrypts differently each time');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);

// Non-zero, so `pnpm check` actually stops. A test that only prints is
// decoration -- it passes silently on the day it should have caught something.
process.exitCode = fail === 0 ? 0 : 1;
