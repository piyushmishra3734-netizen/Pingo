/**
 * The lock that replaced the recovery code.
 *
 * Everything here is about one promise: **until the secret verifies, nothing
 * is recovered** — and that has to be true because the archive key is sealed
 * to it, not because a screen declined to show a button. So the checks are
 * cryptographic: a wrong passcode does not open it, a changed passcode does not
 * strand the old archive, and the stored envelope carries nothing that would
 * let anybody skip the step.
 *
 * Run with `pnpm verify:passkey-lock`.
 */
import {
  changeLock,
  createLock,
  lockExistingKey,
  openLock,
  passcodeStrength,
  LockError,
  PASSCODE_KDF,
  PASSKEY_KDF,
} from '../src/lib/backup/passkey-lock.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** A stand-in for what WebAuthn's PRF extension hands back: 32 uniform bytes. */
const prf = (seed: number) => new Uint8Array(32).map((_, i) => (seed * 31 + i * 7) % 251);

/**
 * Same shape as a real ECDH agreement, so "the key still works" is testable.
 *
 * The other party is generated once and reused: a fresh counterpart per call
 * would produce a different shared secret every time and the comparison would
 * be meaningless — which it was, the first time this was written.
 */
const counterpart = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
  'deriveBits',
]);

async function agree(privateKey: CryptoKey): Promise<string> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: counterpart.publicKey },
    privateKey,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

console.log('— a passcode locks it —');

{
  const { lock, publicKey } = await createLock({
    method: 'passcode',
    secret: 'correct horse battery staple',
    passcodeKind: 'password',
  });

  check(lock.method === 'passcode' && lock.kdf === PASSCODE_KDF, 'the envelope names how it was made');
  check(lock.version === 1, 'and starts at version one');
  check(publicKey.length > 40, 'a public key comes back for senders to seal to');

  const opened = await openLock(lock, 'correct horse battery staple');
  check(Boolean(opened), 'the right passcode opens it');

  let refused = false;
  try {
    await openLock(lock, 'correct horse battery stapl');
  } catch (error) {
    refused = error instanceof LockError && error.code === 'wrong-secret';
  }
  check(refused, 'one character wrong does not');

  /*
   * The point of the whole design. A passcode is not compared to anything —
   * there is nothing stored to compare it against — so "wrong" can only mean
   * "the archive key did not come out".
   */
  check(
    !JSON.stringify(lock).includes('correct horse'),
    'and the stored envelope contains no trace of the passcode',
  );
}

console.log('\n— a passkey locks it the same way —');

{
  const { lock } = await createLock({
    method: 'passkey',
    secret: prf(1),
    credentialId: 'cred-abc',
  });

  check(lock.kdf === PASSKEY_KDF, 'a passkey lock is stretched rather than hardened');
  check(lock.credentialId === 'cred-abc', 'and remembers which credential to ask for');

  check(Boolean(await openLock(lock, prf(1))), 'the same authenticator opens it');

  let refused = false;
  try {
    await openLock(lock, prf(2));
  } catch (error) {
    refused = error instanceof LockError && error.code === 'wrong-secret';
  }
  check(refused, 'a different one does not');
}

console.log('\n— changing it keeps the history —');

{
  const first = await createLock({ method: 'passcode', secret: '1234', passcodeKind: 'pin' });
  const before = await agree(await openLock(first.lock, '1234'));

  const second = await changeLock({
    lock: first.lock,
    current: '1234',
    next: { method: 'passcode', secret: 'a longer passphrase entirely', passcodeKind: 'password' },
  });

  const after = await agree(await openLock(second, 'a longer passphrase entirely'));
  check(before === after, 'the same recovery key comes out, so nothing already sealed breaks');
  check(second.version === 2, 'the version goes up');
  check(second.salt !== first.lock.salt, 'with a fresh salt');
  check(second.iv !== first.lock.iv, 'and a fresh IV');

  let old = false;
  try {
    await openLock(second, '1234');
  } catch (error) {
    old = error instanceof LockError && error.code === 'wrong-secret';
  }
  check(old, 'the old passcode stops working immediately');

  /*
   * A PIN today, a face tomorrow. The method is allowed to change, because the
   * thing being protected does not.
   */
  const third = await changeLock({
    lock: second,
    current: 'a longer passphrase entirely',
    next: { method: 'passkey', secret: prf(9), credentialId: 'cred-xyz' },
  });
  check(third.method === 'passkey', 'a passcode can become a passkey');
  check((await agree(await openLock(third, prf(9)))) === before, 'and it is still the same key');
}

console.log('\n— a replayed envelope is refused —');

{
  const first = await createLock({ method: 'passcode', secret: 'one', passcodeKind: 'password' });
  const second = await changeLock({
    lock: first.lock,
    current: 'one',
    next: { method: 'passcode', secret: 'two', passcodeKind: 'password' },
  });

  let rolled = false;
  try {
    // A server handing back the superseded copy, to strand somebody on a
    // passcode they changed away from.
    await openLock(first.lock, 'one', second.version);
  } catch (error) {
    rolled = error instanceof LockError && error.code === 'rolled-back';
  }
  check(rolled, 'a version this device has passed is not opened again');
  check(Boolean(await openLock(second, 'two', second.version)), 'while the current one still opens');
}

console.log('\n— an unknown KDF is refused rather than guessed —');

{
  const { lock } = await createLock({ method: 'passcode', secret: 'x', passcodeKind: 'password' });
  let refused = false;
  try {
    await openLock({ ...lock, kdf: 'argon2id-2030' }, 'x');
  } catch (error) {
    refused = error instanceof LockError && error.code === 'unsupported-kdf';
  }
  check(refused, 'a lock made by a future PINGO says so instead of failing as "wrong passcode"');
}

console.log('\n— the lock carries what a backup needs —');

{
  const { lock, publicKey } = await createLock({
    method: 'passcode',
    secret: 'a real password here',
    passcodeKind: 'password',
  });

  /*
   * The public half has to be readable without the secret: a device that has
   * not unlocked anything still needs somewhere to send the next backup. It is
   * public by definition, and keeping it beside the sealed half is what stops a
   * caller holding an extractable copy of the private one to derive it from.
   */
  check(lock.publicKey === publicKey, 'the public key is in the envelope, in the open');

  const changed = await changeLock({
    lock,
    current: 'a real password here',
    next: { method: 'passcode', secret: 'something else entirely', passcodeKind: 'password' },
  });
  check(
    changed.publicKey === lock.publicKey,
    'changing the secret leaves it alone, so archives keep the address they were sealed to',
  );
}

console.log('\n— locking a key that already has archives —');

{
  /*
   * The bug this exists to stop. Adding a lock to an account that has been
   * backing up must protect the key those archives were sealed to; minting a
   * new one leaves every chunk unopenable — which is exactly what "backup part
   * 0 could not be opened" means, and exactly what was reported.
   */
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
    'deriveKey',
  ]);
  const before = await agree(pair.privateKey);
  const publicKey = 'the-spki-those-archives-name';

  const lock = await lockExistingKey({
    privateKeyPkcs8: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicKey,
    method: 'passcode',
    secret: 'the passcode they chose',
    passcodeKind: 'password',
  });

  check(
    (await agree(await openLock(lock, 'the passcode they chose'))) === before,
    'the key that comes back is the key the archives already use',
  );
  check(lock.publicKey === publicKey, 'and the public half is left exactly as the archives name it');

  const fresh = await createLock({ method: 'passcode', secret: 'x', passcodeKind: 'password' });
  check(
    (await agree(await openLock(fresh.lock, 'x'))) !== before,
    'while a lock created from scratch is a different key — which is why these are two calls',
  );
}

console.log('\n— what a passcode is worth, said plainly —');

{
  check(passcodeStrength('123', 'pin') === 'too-short', 'three digits is not a PIN');
  check(passcodeStrength('1234', 'pin') === 'weak', 'four digits is weak, and is called weak');
  check(passcodeStrength('short', 'password') === 'too-short', 'a five-letter password is too short');
  check(passcodeStrength('alllowercaseletters', 'password') === 'weak', 'one character class is weak');
  check(passcodeStrength('Tr0ub4dor&3xample', 'password') === 'fine', 'a real password passes');
  check(passcodeStrength('12', 'pattern') === 'too-short', 'a two-dot pattern is not a pattern');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
