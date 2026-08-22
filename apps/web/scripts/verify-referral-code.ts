/**
 * The half of the referral system that runs before there is an account.
 *
 * The server's rules are asserted in `supabase/tests/referrals.sql`, against a
 * real database, because that is where they live. What is left on this side is
 * small and entirely about survival: a code read off a URL has to still be
 * there after a welcome screen, a method choice, a round trip to Google and a
 * username - and it has to be the *first* one, because somebody who opens two
 * invitations belongs to whoever actually got them here.
 *
 * Run with `pnpm verify:referral-code`.
 */
import {
  forgetReferralCode,
  heldReferralCode,
  normaliseReferralCode,
  rememberReferralCode,
  referralLink,
} from '../src/features/referrals/referral-code.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** The module talks to `localStorage`, which Node does not have. */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as { location?: unknown }).location = { origin: 'https://pingochat.pages.dev' };

console.log('\n--- what counts as a code ---');

check(normaliseReferralCode('PY7K2QXZ') === 'PY7K2QXZ', 'a plain code is kept');
check(normaliseReferralCode(' py7k2qxz ') === 'PY7K2QXZ', 'lowercase and spaces are normalised');
check(normaliseReferralCode('PY7K-2QXZ') === 'PY7K2QXZ', 'punctuation from a paste is stripped');
check(normaliseReferralCode('PY7K2Q') === undefined, 'a short code is refused');
check(normaliseReferralCode('PY7K2QXZ9') === undefined, 'a long code is refused');
check(normaliseReferralCode('PY7K2QX0') === undefined, 'the ambiguous alphabet is enforced (0)');
check(normaliseReferralCode('PY7K2QXI') === undefined, 'the ambiguous alphabet is enforced (I)');
check(normaliseReferralCode(undefined) === undefined, 'nothing is not a code');

console.log('\n--- surviving the signup flow ---');

forgetReferralCode();
rememberReferralCode('py7k2qxz');
check(heldReferralCode() === 'PY7K2QXZ', 'a code from the link is held');

// The trip through Welcome, a method, Google, a password and a username is, as
// far as this module is concerned, simply "later".
check(heldReferralCode() === 'PY7K2QXZ', 'it is still held after navigation');

console.log('\n--- one inviter, decided once ---');

rememberReferralCode('R8M4XAKT');
check(heldReferralCode() === 'PY7K2QXZ', 'a second link does not replace the first');

console.log('\n--- clearing ---');

forgetReferralCode();
check(heldReferralCode() === undefined, 'the code is gone once the server has answered');
rememberReferralCode('NOTACODE!');
check(heldReferralCode() === undefined, 'an invalid code is never stored');

console.log('\n--- the link a user shares ---');

check(
  referralLink('PY7K2QXZ') === 'https://pingochat.pages.dev/r/PY7K2QXZ',
  `the link is built from the running origin: ${referralLink('PY7K2QXZ')}`,
);
check(
  referralLink('PY7K2QXZ') !== referralLink('R8M4XAKT'),
  'two people get two different links',
);

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
