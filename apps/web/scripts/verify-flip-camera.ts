/**
 * The flip-camera button on a video call, played against fake devices:
 * a laptop that opens two cameras at once, a phone that opens one at a time
 * (where the button used to do nothing), a phone that ignores `facingMode`,
 * and a device with only one camera.
 *
 * Run with `pnpm verify:flip-camera`.
 */
import assert from 'node:assert/strict';

import { openOtherCamera } from '../src/features/calls/flip-camera.js';

type Cam = { id: string; label: string; facing: 'user' | 'environment' };
const FRONT: Cam = { id: 'front', label: 'camera2 1, facing front', facing: 'user' };
const BACK: Cam = { id: 'back', label: 'camera2 0, facing back', facing: 'environment' };

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  constructor(readonly cam: Cam) {}
  getSettings() {
    return { deviceId: this.cam.id, facingMode: this.cam.facing };
  }
  stop() {
    this.readyState = 'ended';
  }
}

function device(opts: { cams: Cam[]; oneAtATime: boolean; ignoresFacing?: boolean }) {
  const live: FakeTrack[] = [];
  const media = {
    async getUserMedia({ video }: { video: MediaTrackConstraints }) {
      const v = video as { facingMode?: string | { exact: string }; deviceId?: { exact: string } };
      let cam: Cam | undefined;
      if (v.deviceId) cam = opts.cams.find((c) => c.id === v.deviceId!.exact);
      else if (opts.ignoresFacing) cam = opts.cams[0];
      else {
        const want = typeof v.facingMode === 'object' ? v.facingMode.exact : v.facingMode;
        const exact = typeof v.facingMode === 'object';
        cam = opts.cams.find((c) => c.facing === want) ?? (exact ? undefined : opts.cams[0]);
      }
      if (!cam) throw Object.assign(new Error('Overconstrained'), { name: 'OverconstrainedError' });
      if (opts.oneAtATime && live.some((t) => t.readyState === 'live')) {
        throw Object.assign(new Error('Could not start video source'), { name: 'NotReadableError' });
      }
      const track = new FakeTrack(cam);
      live.push(track);
      return { getVideoTracks: () => [track] } as unknown as MediaStream;
    },
    async enumerateDevices() {
      return opts.cams.map((c) => ({ kind: 'videoinput', deviceId: c.id, label: c.label, groupId: '' })) as unknown as MediaDeviceInfo[];
    },
  };
  const open = async (cam: Cam) => {
    const t = new FakeTrack(cam);
    live.push(t);
    return t;
  };
  return { media, open };
}

const as = (t: FakeTrack) => t as unknown as MediaStreamTrack;
const settings = (t: MediaStreamTrack | undefined) => (t as unknown as FakeTrack | undefined)?.cam.id;
let n = 0;
const ok = async (what: string, fn: () => Promise<void>) => {
  await fn();
  n += 1;
  console.log(`PASS  ${what}`);
};

await ok('laptop: flips without letting go of the old camera first', async () => {
  const d = device({ cams: [FRONT, BACK], oneAtATime: false });
  const current = await d.open(FRONT);
  const next = await openOtherCamera(d.media, 'environment', as(current), {});
  assert.equal(settings(next), 'back');
  assert.equal(current.readyState, 'live', 'the old camera is released by the caller, after the swap');
});

await ok('phone with one camera open at a time: the old one goes, the rear one opens', async () => {
  const d = device({ cams: [FRONT, BACK], oneAtATime: true });
  const current = await d.open(FRONT);
  const next = await openOtherCamera(d.media, 'environment', as(current), {});
  assert.equal(settings(next), 'back');
  assert.equal(current.readyState, 'ended');
});

await ok('and back again to the front', async () => {
  const d = device({ cams: [FRONT, BACK], oneAtATime: true });
  const current = await d.open(BACK);
  const next = await openOtherCamera(d.media, 'user', as(current), {});
  assert.equal(settings(next), 'front');
});

await ok('a phone that ignores facingMode: found by device, rear label first', async () => {
  const d = device({ cams: [FRONT, { id: 'wide', label: 'camera2 2, facing front', facing: 'user' }, BACK], oneAtATime: true, ignoresFacing: true });
  const current = await d.open(FRONT);
  const next = await openOtherCamera(d.media, 'environment', as(current), {});
  assert.equal(settings(next), 'back');
});

await ok('one camera only: nothing opens, and the caller is told so', async () => {
  const d = device({ cams: [FRONT], oneAtATime: true });
  const current = await d.open(FRONT);
  const next = await openOtherCamera(d.media, 'environment', as(current), {});
  assert.equal(next, undefined);
  assert.equal(current.readyState, 'ended', 'released while trying; the service reopens it');
});

await ok('the call settings (HD, frame rate) ride along', async () => {
  let seen: MediaTrackConstraints | undefined;
  const d = device({ cams: [FRONT, BACK], oneAtATime: false });
  const spy = { ...d.media, getUserMedia: async (c: { video: MediaTrackConstraints }) => ((seen = c.video), d.media.getUserMedia(c)) };
  await openOtherCamera(spy, 'environment', as(await d.open(FRONT)), { width: { ideal: 1280 }, frameRate: { ideal: 30 } });
  assert.deepEqual(seen?.width, { ideal: 1280 });
  assert.deepEqual(seen?.frameRate, { ideal: 30 });
});

console.log(`\n${n} passed`);
