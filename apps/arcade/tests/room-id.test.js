import assert from 'node:assert/strict';
import test from 'node:test';

import { inviteUrl, newRoomId, roomFromSearch, seatFromSearch } from '../src/net/room-id.js';
import { ROOM_ID } from '../worker/src/room.js';

test('a new room id is one the Worker accepts, and unambiguous out loud', () => {
  for (let i = 0; i < 200; i += 1) {
    const id = newRoomId();
    assert.equal(id.length, 10);
    assert.ok(ROOM_ID.test(id), id);
    assert.doesNotMatch(id, /[01ilo]/, id);
  }
});

test('ids do not repeat in practice', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newRoomId()));
  assert.equal(ids.size, 1000);
});

test('the room is read from the query only when it is valid', () => {
  assert.equal(roomFromSearch('?room=abcdef2345'), 'abcdef2345');
  assert.equal(roomFromSearch('?room=../evil'), null);
  assert.equal(roomFromSearch('?nothing=1'), null);
});

test('the guest takes seat B unless the link says A', () => {
  assert.equal(seatFromSearch('?room=abcdef2345'), 'B');
  assert.equal(seatFromSearch('?room=abcdef2345&seat=A'), 'A');
  assert.equal(seatFromSearch('?room=abcdef2345&seat=Z'), 'B');
});

test('an invite carries the room, and the seat only when the host took B', () => {
  const base = 'http://localhost:5180/?hud&room=old#x';
  assert.equal(inviteUrl(base, 'abcdef2345', 'A'), 'http://localhost:5180/?room=abcdef2345');
  assert.equal(inviteUrl(base, 'abcdef2345', 'B'), 'http://localhost:5180/?room=abcdef2345&seat=A');
});
