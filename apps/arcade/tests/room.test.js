import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MESSAGE_BYTES,
  MAX_PEERS,
  ROOM_ID,
  admit,
  allowedOrigin,
  newPlayerId,
  parseForward,
} from '../worker/src/room.js';

test('the first player in is the host, the next five guests, the seventh refused', () => {
  assert.equal(MAX_PEERS, 6);
  assert.equal(admit([]), 'host');
  assert.equal(admit(['host']), 'guest');
  assert.equal(admit(['host', 'guest', 'guest', 'guest', 'guest']), 'guest');
  assert.equal(admit(['host', 'guest', 'guest', 'guest', 'guest', 'guest']), null);
});

test('player ids are short, url-safe and never repeat within a room', () => {
  const taken = [];
  for (let i = 0; i < 50; i += 1) taken.push(newPlayerId(taken));
  assert.equal(new Set(taken).size, 50);
  for (const id of taken) assert.match(id, /^[a-z0-9]{1,6}$/);
});

test('a handshake may be addressed to one player, but only by a string id', () => {
  assert.deepEqual(parseForward(JSON.stringify({ type: 'offer', to: 'abc123', sdp: 'x' })), { type: 'offer', to: 'abc123', sdp: 'x' });
  assert.equal(parseForward(JSON.stringify({ type: 'offer', to: 7 })), null);
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
