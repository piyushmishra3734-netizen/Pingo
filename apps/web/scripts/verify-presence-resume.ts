/**
 * Coming back to the app must not lose who is online, nor typing.
 *
 * `resume` used to be stop-then-start: that forgot who had been online (so
 * anybody who left while the app was away stayed green until a refresh) and
 * dropped every typing channel (so typing in the open chat stopped arriving).
 * Run against the real PresenceHub with a Realtime client that is only a fake.
 *
 *   pnpm verify:presence-resume
 */
import assert from 'node:assert/strict';

// The hub reaches for these browser globals; a bare Node has none of them.
const listeners = new Map<string, Set<() => void>>();
Object.assign(globalThis, {
  window: {
    addEventListener: (type: string, fn: () => void) => (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    dispatchEvent: () => true,
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  },
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  CustomEvent: class {},
});

const { PresenceHub } = await import('../src/lib/supabase/presence.js');

type Handler = (payload: unknown) => void;

class FakeChannel {
  state = 'closed';
  removed = false;
  tracked = 0;
  roster: Record<string, unknown[]> = {};
  #on = new Map<string, Handler>();
  constructor(readonly topic: string) {}
  on(type: string, filter: { event: string }, cb: Handler) {
    this.#on.set(`${type}:${filter.event}`, cb);
    return this;
  }
  subscribe(cb?: (status: string) => void) {
    this.state = 'joined';
    cb?.('SUBSCRIBED');
    return this;
  }
  presenceState() {
    return this.roster;
  }
  async track() {
    this.tracked += 1;
    return 'ok';
  }
  async untrack() {
    return 'ok';
  }
  async send() {
    return 'ok';
  }
  /** What the server would say. */
  emit(type: string, event: string, payload: unknown = {}) {
    this.#on.get(`${type}:${event}`)?.(payload);
  }
}

const fake = {
  connected: true,
  channels: [] as FakeChannel[],
  channel(topic: string) {
    const c = new FakeChannel(topic);
    this.channels.push(c);
    return c;
  },
  async removeChannel(c: FakeChannel) {
    c.removed = true;
    c.state = 'closed';
    return 'ok';
  },
  realtime: { isConnected: () => fake.connected },
};

const presence = new Map<string, string>();
const typing: { conversationId: string; userIds: string[] }[] = [];
const hub = new PresenceHub(fake as never, {
  onPresence: (id, state) => presence.set(id, state),
  onListening: () => undefined,
  onWatching: () => undefined,
  onTyping: (conversationId, userIds) => typing.push({ conversationId, userIds }),
});

const live = (topic: string) => fake.channels.filter((c) => c.topic === topic && !c.removed);
const settle = () => new Promise((r) => setTimeout(r, 0));
const realNow = Date.now;
const later = (ms: number) => {
  Date.now = () => realNow() + ms;
};

let checks = 0;
const check = async (name: string, run: () => Promise<void> | void) => {
  await run();
  checks += 1;
  console.log('PASS ', name);
};

hub.start('me');
const first = live('pingo:presence')[0]!;
first.roster = { alice: [{}], bob: [{}] };
first.emit('presence', 'sync');
hub.watchTyping('c1');
const firstTyping = live('typing:c1')[0]!;

await check('two people are online after the first sync', () => {
  assert.equal(presence.get('alice'), 'online');
  assert.equal(presence.get('bob'), 'online');
});

await check('switching tabs with live channels tears nothing down, and says "here" again', async () => {
  const tracked = first.tracked;
  hub.resume('me');
  await settle();
  assert.equal(live('pingo:presence').length, 1, 'same presence channel');
  assert.equal(live('typing:c1')[0], firstTyping, 'same typing channel');
  assert.equal(first.removed, false);
  assert.equal(first.tracked, tracked + 1);
});

await check('a long suspension rebuilds, and whoever left meanwhile is turned off', async () => {
  later(60_000); // the sweeper has not ticked for a minute: the app was suspended
  hub.resume('me');
  await settle();
  Date.now = realNow;
  const fresh = live('pingo:presence');
  assert.equal(fresh.length, 1);
  assert.notEqual(fresh[0], first, 'a new presence channel');
  assert.equal(first.removed, true);
  // bob left while we were away; the new channel only knows alice.
  fresh[0]!.roster = { alice: [{}] };
  fresh[0]!.emit('presence', 'sync');
  assert.equal(presence.get('alice'), 'online');
  assert.equal(presence.get('bob'), 'offline', 'forgetting who was online is what kept bob green');
});

await check('the open chat\'s typing channel comes back, and typing arrives on it', async () => {
  const typingNow = live('typing:c1');
  assert.equal(typingNow.length, 1, 'one live typing channel for the chat');
  assert.notEqual(typingNow[0], firstTyping, 'a new one');
  typing.length = 0;
  typingNow[0]!.emit('broadcast', 'typing', { payload: { userId: 'alice', typing: true, kind: 'typing' } });
  assert.deepEqual(typing.at(-1), { conversationId: 'c1', userIds: ['alice'] });
});

await check('a dead channel is rebuilt even without a suspension', async () => {
  const before = live('pingo:presence')[0]!;
  before.state = 'errored';
  hub.resume('me');
  await settle();
  assert.equal(before.removed, true);
  assert.equal(live('pingo:presence').length, 1);
  assert.notEqual(live('pingo:presence')[0], before);
});

await check('a socket that is down rebuilds, a second wake-up while it does changes nothing', async () => {
  fake.connected = false;
  const count = fake.channels.length;
  hub.resume('me');
  hub.resume('me');
  await settle();
  fake.connected = true;
  // one new presence channel and one new typing channel: not two of each
  assert.equal(fake.channels.length - count, 2);
  assert.equal(live('pingo:presence').length, 1);
  assert.equal(live('typing:c1').length, 1);
});

await check('control: the old stop-then-start really did leave a person who had gone green', async () => {
  const seen = new Map<string, string>();
  const old = new PresenceHub(fake as never, {
    onPresence: (id, state) => seen.set(id, state),
    onListening: () => undefined,
    onWatching: () => undefined,
    onTyping: () => undefined,
  });
  old.start('me');
  const a = live('pingo:presence').at(-1)!;
  a.roster = { alice: [{}], bob: [{}] };
  a.emit('presence', 'sync');
  old.stop();
  await settle();
  old.start('me');
  const b = live('pingo:presence').at(-1)!;
  b.roster = { alice: [{}] };
  b.emit('presence', 'sync');
  assert.equal(seen.get('bob'), 'online', 'bob left, and nothing ever turned him off');
  old.stop();
});

await check('signing out stops everything', async () => {
  hub.stop();
  await settle();
  assert.equal(live('pingo:presence').length, 0);
  assert.equal(live('typing:c1').length, 0);
});

console.log(`\nAll ${checks} presence-resume checks passed.`);
process.exit(0);
