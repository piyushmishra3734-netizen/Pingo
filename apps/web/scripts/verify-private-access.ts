/**
 * The gate decides who sees the app at all, so its two pure functions get a
 * check that fails loudly rather than a reading that looks right.
 *
 * What is actually being protected here is not the allow list - that part is an
 * array lookup. It is the *journey*: signing in with Google leaves the app,
 * comes back on `/auth/google`, and only then is there a session to check. If
 * the gate closes on that return leg, the one account that is allowed in can
 * never get in, and the only way out is editing a constant and redeploying.
 *
 * Run: node apps/web/scripts/run-ts.mjs apps/web/scripts/verify-private-access.ts
 */
import assert from 'node:assert/strict';

import { PRIVATE_ACCESS, isAllowedAddress, isOpenPath } from '../src/features/auth/private-access.js';

const results: string[] = [];
function check(what: string, run: () => void): void {
  run();
  results.push(`PASS  ${what}`);
}

// --- the allow list ---------------------------------------------------------

/*
 * These only mean anything while the gate is on. With `PRIVATE_ACCESS` false
 * every address is allowed, which is the entire point of the switch - so
 * asserting that a stranger is refused would be asserting the gate is on, not
 * that it works. The behaviour under each setting is checked, not one of them.
 */
if (PRIVATE_ACCESS) {
  check('the operator is allowed', () => {
    assert.equal(isAllowedAddress('piyushmishra3734@gmail.com'), true);
  });

  check('capitalisation does not lock him out', () => {
    // A phone keyboard capitalises the first letter, and an address that
    // arrives as `Piyush...` is the same account.
    assert.equal(isAllowedAddress('Piyushmishra3734@Gmail.com'), true);
    assert.equal(isAllowedAddress('  piyushmishra3734@gmail.com  '), true);
  });

  check('nobody else is', () => {
    assert.equal(isAllowedAddress('someone@gmail.com'), false);
    assert.equal(isAllowedAddress(''), false);
    assert.equal(isAllowedAddress(undefined), false);
  });

  check('a lookalike address is not a match', () => {
    // Substring matching would let these through; the list compares whole
    // values.
    assert.equal(isAllowedAddress('xpiyushmishra3734@gmail.com'), false);
    assert.equal(isAllowedAddress('piyushmishra3734@gmail.com.evil.test'), false);
  });
} else {
  check('the gate is off, so everybody is allowed', () => {
    assert.equal(isAllowedAddress('piyushmishra3734@gmail.com'), true);
    assert.equal(isAllowedAddress('someone@gmail.com'), true);
    assert.equal(isAllowedAddress('xpiyushmishra3734@gmail.com'), true);
    // Including before a session exists, so nothing bounces mid-restore.
    assert.equal(isAllowedAddress(undefined), true);
    assert.equal(isAllowedAddress(''), true);
  });
}

// --- the paths that stay open ----------------------------------------------

check('the Google return leg is open', () => {
  // The whole journey dies here if this closes: the session lands on this path.
  assert.equal(isOpenPath('/auth/google'), true);
  assert.equal(isOpenPath('/auth'), true);
});

check('signing in is reachable', () => {
  for (const path of ['/login', '/welcome', '/signup', '/intro']) {
    assert.equal(isOpenPath(path), true, path);
  }
  assert.equal(isOpenPath('/signup/email'), true);
});

check('the privacy policy stays readable', () => {
  assert.equal(isOpenPath('/privacy'), true);
});

check('the app itself is not open', () => {
  for (const path of ['/', '/chats', '/chats/abc', '/settings', '/camera', '/profile']) {
    assert.equal(isOpenPath(path), false, path);
  }
});

check('a path that merely starts with an open name is not open', () => {
  // `/logins` and `/authenticate` are not `/login` and `/auth`.
  assert.equal(isOpenPath('/logins'), false);
  assert.equal(isOpenPath('/authenticate'), false);
  assert.equal(isOpenPath('/privacy-policy-fake'), false);
});

// --- the switch -------------------------------------------------------------

check('the switch is a boolean, and the open paths do not depend on it', () => {
  // `isOpenPath` is about the journey, not about who is allowed on it, so it
  // must answer the same way whichever setting is live. Everything above this
  // line already asserted that, under whichever setting is compiled in.
  assert.equal(typeof PRIVATE_ACCESS, 'boolean');
  assert.equal(isOpenPath('/auth/google'), true);
  assert.equal(isOpenPath('/chats'), false);
});

for (const line of results) console.log(line);
console.log(`\nAll good. PRIVATE_ACCESS is ${PRIVATE_ACCESS ? 'ON' : 'off'}.`);
