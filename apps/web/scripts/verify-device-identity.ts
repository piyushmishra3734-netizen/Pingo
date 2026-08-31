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
 * A device that cannot read its keys mints new ones, and says so.
 *
 * This used to throw, and the throw is what took the product down. `openRow`
 * catches everything and writes the "Sent before you added this device"
 * placeholder, so a device that refused to mint could not read a single
 * message - not the history the refusal was protecting, and not the one that
 * arrived a second ago either. Every account except one went dark within hours
 * and no device published a key for six of them.
 *
 * A wrong identity loses old messages. No identity loses all of them plus every
 * future one. The mirror stays as evidence in a warning rather than as a gate.
 */
assert.ok(
  !/throw new IdentityUnavailableError/.test(fn),
  'an unreadable key store never refuses - it mints, because refusing reads as total data loss',
);
assert.match(fn, /const mirrored = readMirror\(\);/, 'the second store is still consulted');
assert.match(fn, /console\.warn\(/, 'and disagreement is reported rather than swallowed');

/* Minting must still be the last thing, after both slots have been checked. */
const mintAt = fn.indexOf('crypto.subtle.generateKey');
assert.ok(
  mintAt > fn.indexOf('const existing = await localGet') &&
    mintAt > fn.indexOf('if (existing && existingId)'),
  'a complete identity is still reused rather than replaced',
);

/* The mirror is written when one is minted, or it records nothing. */
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
