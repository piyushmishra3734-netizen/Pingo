import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MESSAGE_BYTES,
  ROOM_ID,
  admit,
  allowedOrigin,
  parseForward,
} from '../worker/src/room.js';

test('the first player in is the host, the second a guest, the third refused', () => {
  assert.equal(admit([]), 'host');
  assert.equal(admit(['host']), 'guest');
  assert.equal(admit(['host', 'guest']), null);
});

test('a room left with its guest promoted to host admits the next as guest', () => {
  // The Durable Object promotes whoever stays; this is what it then asks.
  assert.equal(admit(['host']), 'guest');
});

test('only the handshake is relayed', () => {
  for (const type of ['offer', 'answer', 'candidate']) {
    assert.deepEqual(parseForward(JSON.stringify({ type, x: 1 })), { type, x: 1 });
  }
  for (const raw of [
    JSON.stringify({ type: 'welcome' }),
    JSON.stringify({ type: 'join' }),
    JSON.stringify({ nothing: true }),
    'not json',
    JSON.stringify(null),
  ]) {
    assert.equal(parseForward(raw), null, raw);
  }
});

test('an oversized or binary message is dropped, so the relay is not a free pipe', () => {
  const big = JSON.stringify({ type: 'offer', sdp: 'x'.repeat(MAX_MESSAGE_BYTES) });
  assert.equal(parseForward(big), null);
  assert.equal(parseForward(new ArrayBuffer(8)), null);
});

test('room ids: short, lowercase, url-safe', () => {
  assert.ok(ROOM_ID.test('abcdef2345'));
  for (const bad of ['abc', 'ABCDEFGH', 'has space1', '../../etc', 'x'.repeat(33)]) {
    assert.ok(!ROOM_ID.test(bad), bad);
  }
});

test('only PINGO and a developer machine may open a room', () => {
  for (const ok of [
    'http://localhost:5180',
    'http://127.0.0.1:5181',
    'http://10.80.218.196:5180',
    'http://192.168.1.4:5180',
    'https://pingochat.pages.dev',
    'https://abc123.pingochat.pages.dev',
    'https://pingochat.xyz',
    'https://pingo-arcade.pages.dev',
    'https://4f2a9c1.pingo-arcade.pages.dev',
  ]) {
    assert.ok(allowedOrigin(ok), ok);
  }
  for (const no of [
    null,
    '',
    'https://evil.example',
    'https://pingochat.pages.dev.evil.example',
    'https://notpingochat.pages.dev',
    'http://pingochat.xyz',
  ]) {
    assert.ok(!allowedOrigin(no), String(no));
  }
});
