import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createSession, Light, State } from '../src/core/session.js';

test('starts idle with the light off', () => {
  const session = createSession();
  assert.equal(session.state, State.IDLE);
  assert.equal(session.light, Light.OFF);
});

test('sitting down waits, with the light blinking orange', () => {
  const session = createSession();
  const seen = [];
  session.on((change) => seen.push(change));

  assert.equal(session.sit(), true);
  assert.equal(session.state, State.WAITING);
  assert.equal(session.light, Light.BLINK_ORANGE);
  assert.deepEqual(seen, [
    { action: 'sit', from: State.IDLE, to: State.WAITING, light: Light.BLINK_ORANGE },
  ]);
});

test('a guest arriving keeps the same orange while connecting', () => {
  const session = createSession({ state: State.WAITING });
  assert.equal(session.guestFound(), true);
  assert.equal(session.state, State.CONNECTING);
  assert.equal(session.light, Light.BLINK_ORANGE);
});

test('pairing turns the light green, which is also the coin cue', () => {
  const session = createSession({ state: State.CONNECTING });
  const coins = [];
  // Exactly how the audio engine will subscribe.
  session.on(({ to }) => {
    if (to === State.PAIRED) coins.push('coin');
  });

  assert.equal(session.paired(), true);
  assert.equal(session.state, State.PAIRED);
  assert.equal(session.light, Light.GREEN);
  assert.deepEqual(coins, ['coin']);
});

test('a channel that opens before the guest is noticed still pairs', () => {
  const session = createSession({ state: State.WAITING });
  assert.equal(session.paired(), true);
  assert.equal(session.state, State.PAIRED);
});

test('a dropped connection falls back to waiting, still seated', () => {
  for (const from of [State.CONNECTING, State.PAIRED]) {
    const session = createSession({ state: from });
    assert.equal(session.dropped(), true, from);
    assert.equal(session.state, State.WAITING, from);
    assert.equal(session.light, Light.BLINK_ORANGE, from);
  }
});

test('standing up from anywhere turns the light off', () => {
  for (const from of [State.WAITING, State.CONNECTING, State.PAIRED]) {
    const session = createSession({ state: from });
    assert.equal(session.leave(), true, from);
    assert.equal(session.state, State.IDLE, from);
    assert.equal(session.light, Light.OFF, from);
  }
});

test('an action that does not apply is ignored, not thrown', () => {
  const session = createSession();
  const seen = [];
  session.on((change) => seen.push(change));

  // Late news from the network, after the player already stood up.
  assert.equal(session.dropped(), false);
  assert.equal(session.paired(), false);
  assert.equal(session.send('nonsense'), false);

  assert.equal(session.state, State.IDLE);
  assert.deepEqual(seen, [], 'a state that did not move announces nothing');
});

test('every subscriber hears the change, and unsubscribing works', () => {
  const session = createSession();
  const lobby = [];
  const audio = [];
  const offLobby = session.on(({ to }) => lobby.push(to));
  session.on(({ to }) => audio.push(to));

  session.sit();
  offLobby();
  session.paired();

  assert.deepEqual(lobby, [State.WAITING]);
  assert.deepEqual(audio, [State.WAITING, State.PAIRED]);
});

test('stays pure: no imports, no DOM, no engine', () => {
  const source = readFileSync(new URL('../src/core/session.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, 'session.js imports nothing');
  assert.doesNotMatch(
    source,
    /\b(document|window|navigator|RTCPeerConnection|THREE)\b/,
    'no host objects',
  );
});
