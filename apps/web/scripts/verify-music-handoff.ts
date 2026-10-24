/**
 * The gap between two songs must not look like a pause.
 *
 * A song that runs to its end fires `pause` just before `ended`. Reporting that
 * as "paused" took the Android player out of the foreground (and a browser drops
 * its media player) at the moment the next song had not started yet, and with the
 * screen off the music stopped after one song. Run against the real player with a
 * fake audio element.
 *
 *   pnpm verify:music-handoff
 */
import assert from 'node:assert/strict';

type Listener = () => void;

class FakeAudio {
  src = '';
  currentTime = 0;
  duration = 200;
  ended = false;
  paused = true;
  hidden = false;
  playbackRate = 1;
  preload = '';
  #on = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener) {
    this.#on.set(type, [...(this.#on.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  setAttribute() {}
  emit(type: string) {
    for (const fn of this.#on.get(type) ?? []) fn();
  }
  play() {
    this.paused = false;
    this.ended = false;
    queueMicrotask(() => this.emit('playing'));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit('pause');
  }
  /** What a song reaching its end does, in the order a browser does it. */
  runToEnd() {
    this.currentTime = this.duration;
    this.ended = true;
    this.paused = true;
    this.emit('pause');
    this.emit('ended');
  }
}

let created: FakeAudio | undefined;
Object.assign(globalThis, {
  Audio: class extends FakeAudio {
    constructor() {
      super();
      created = this;
    }
  },
  document: { body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
  window: globalThis,
});

const { musicPlayer, playerState, setQueueControls } = await import('../src/features/music/player.js');

const song = { url: 'https://example.test/a.mp3', name: 'A', artist: 'X', img: '', secs: 200 };
const tick = () => new Promise((r) => setTimeout(r, 0));

let checks = 0;
const check = async (name: string, run: () => Promise<void>) => {
  await run();
  checks += 1;
  console.log('PASS ', name);
};

await musicPlayer.play(song);
await tick();
const audio = created!;

await check('the song is playing to begin with', async () => {
  assert.equal(playerState().playing, true);
});

await check('with a queue behind it, the end of a song is not a pause: the next one is asked for', async () => {
  let asked: boolean | undefined;
  setQueueControls({ next: (auto) => { asked = auto; }, prev: () => {} });
  audio.runToEnd();
  assert.equal(playerState().playing, true, 'still playing while the next song loads');
  assert.equal(asked, true, 'the queue was told it ended by itself');
});

await check('a real pause (not at the end) is a pause, with a queue or without', async () => {
  await musicPlayer.resume();
  await tick();
  assert.equal(playerState().playing, true);
  audio.pause();
  assert.equal(playerState().playing, false);
});

await check('the queue pausing at its own end (or a sleep timer) really pauses, even though nothing fires', async () => {
  await musicPlayer.resume();
  await tick();
  audio.ended = true;
  audio.paused = true; // already ended: an element fires no `pause` for this
  musicPlayer.pause();
  assert.equal(playerState().playing, false);
});

await check('with no queue, a song that ends is over', async () => {
  setQueueControls(undefined);
  await musicPlayer.resume();
  await tick();
  audio.runToEnd();
  assert.equal(playerState().playing, false);
});

console.log(`\nAll ${checks} music-handoff checks passed.`);
process.exit(0);
