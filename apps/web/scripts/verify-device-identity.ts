/**
 * The one thing this device must never do twice: make an identity.
 *
 * Every message anyone sends to this device is wrapped for the identity it had
 * at the time. Mint a second one and every message wrapped for the first is
 * unreadable for ever - and it does not read as a key problem, it reads as
 * "Sent before you added this device." appearing over a conversation somebody
 * has been reading for weeks, with nothing having changed. Which is exactly how
 * it was reported.
 *
 * `deviceIdentity` used to mint whenever `localGet` returned `undefined`, and
 * `withStore` returns `undefined` for a missing record, a failed transaction,
 * and a database that never opened. Those are not the same fact. This checks
 * the four shapes of "no identity here" and that only one of them is a new
 * device.
 *
 * Run with `pnpm verify:device-identity`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/crypto/keys.ts'),
  'utf8',
);

const fn = source.slice(source.indexOf('export async function deviceIdentity('));

/*
 * Both slots present is the only path that returns without minting, and the
 * only path that should.
 */
assert.match(fn, /if \(existing && existingId\)/, 'a complete identity is reused');

/*
 * Exactly one slot is a read that failed, not a device that is new. Minting
 * over the survivor throws away a keypair that is sitting right there and will
 * be readable again on the next call.
 */
assert.match(
  fn,
  /if \(existing \|\| existingId\) \{\s*throw new IdentityUnavailableError/,
  'half an identity refuses rather than mints',
);

/*
 * And the case no amount of care inside IndexedDB can catch: eviction. An
 * evicted database opens perfectly and is simply empty, so the evidence has to
 * live somewhere else - one string in localStorage, with different eviction.
 */
assert.match(fn, /const mirrored = readMirror\(\);/, 'the second store is consulted');
assert.match(
  fn,
  /if \(mirrored\) \{\s*throw new IdentityUnavailableError/,
  'an emptied store with a mirror refuses to mint',
);

/*
 * Minting must come after all three refusals, or the guards are decoration.
 */
const mintAt = fn.indexOf('crypto.subtle.generateKey');
const lastRefusal = fn.lastIndexOf('throw new IdentityUnavailableError');
assert.ok(mintAt > lastRefusal, 'minting is the last resort, not the first branch');

/* The mirror is written when one is minted, or it protects nothing. */
assert.match(fn, /writeMirror\(deviceId\);/, 'a minted identity records itself');

/*
 * The two places that legitimately end an identity have to clear the mirror,
 * or the guard turns on the people it was meant to protect: a second account
 * signing in here, and a device that was revoked and is starting over. Both
 * are entitled to mint.
 */
const session = await readFile(
  resolve(process.cwd(), 'apps/web/src/lib/crypto/session.ts'),
  'utf8',
);
const switchFn = session.slice(
  session.indexOf('async function switchAccount('),
  session.indexOf('async function wipeRevokedDevice('),
);
assert.match(
  switchFn,
  /localStorage\.removeItem\(IDENTITY_MIRROR\)/,
  'an account with no parked keys gets no mirror either',
);
assert.match(
  switchFn,
  /localStorage\.setItem\(IDENTITY_MIRROR, restoredId\)/,
  'and a returning account gets its own back',
);
assert.match(
  session.slice(session.indexOf('async function wipeRevokedDevice(')),
  /localStorage\.removeItem\(IDENTITY_MIRROR\)/,
  'a revoked device may start over',
);

console.log('✓ one identity per device, and only a genuinely new device makes one');
