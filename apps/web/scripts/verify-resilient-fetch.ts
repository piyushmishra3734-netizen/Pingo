/**
 * Reads survive a bad connection; writes are never touched.
 *
 *   pnpm verify:resilient-fetch
 */
import assert from 'node:assert/strict';

import { resilient, type FetchLike, type Limits } from '../src/lib/supabase/resilient-fetch.js';

const fast: Limits = { attemptMs: 60, offlineMs: 25, pauseMs: () => 1 };
const API = 'https://x.supabase.co/rest/v1';

let checks = 0;
const check = async (name: string, run: () => Promise<void>) => {
  await run();
  checks += 1;
  console.log('PASS ', name);
};

/** A fetch that does what a list of steps says, one per call, and counts calls. */
function scripted(steps: Array<'fail' | 'hang' | number>): { fetch: FetchLike; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    fetch: (_input, init) => {
      const step = steps[Math.min(n, steps.length - 1)]!;
      n += 1;
      if (step === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      if (step === 'hang') {
        return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
      }
      return Promise.resolve(new Response('ok', { status: step }));
    },
  };
}

await check('a read that fails twice on the network succeeds on the third try', async () => {
  const s = scripted(['fail', 'fail', 200]);
  const res = await resilient(s.fetch, () => true, fast)(`${API}/profiles`);
  assert.equal(res.status, 200);
  assert.equal(s.calls(), 3);
});

await check('a read that keeps failing gives up after three tries, with the real error', async () => {
  const s = scripted(['fail']);
  await assert.rejects(resilient(s.fetch, () => true, fast)(`${API}/profiles`), /Failed to fetch/);
  assert.equal(s.calls(), 3);
});

await check('a read that hangs is abandoned and tried again instead of waiting for ever', async () => {
  const s = scripted(['hang', 200]);
  const res = await resilient(s.fetch, () => true, fast)(`${API}/profiles`);
  assert.equal(res.status, 200);
  assert.equal(s.calls(), 2);
});

await check('a briefly unavailable server (503) is tried again; a plain error (404) is not', async () => {
  const unavailable = scripted([503, 200]);
  assert.equal((await resilient(unavailable.fetch, () => true, fast)(`${API}/profiles`)).status, 200);
  assert.equal(unavailable.calls(), 2);
  const missing = scripted([404]);
  assert.equal((await resilient(missing.fetch, () => true, fast)(`${API}/profiles`)).status, 404);
  assert.equal(missing.calls(), 1);
});

await check('a read-only function called with POST is a read, and is tried again', async () => {
  const s = scripted(['fail', 200]);
  const res = await resilient(s.fetch, () => true, fast)(`${API}/rpc/conversation_previews`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 200);
  assert.equal(s.calls(), 2);
});

await check('a write is sent once, as it was, whatever happens', async () => {
  for (const [url, method] of [
    [`${API}/messages`, 'POST'],
    [`${API}/rpc/delete_message`, 'POST'],
    [`${API}/rpc/start_direct_conversation`, 'POST'],
    [`${API}/profiles?id=eq.1`, 'PATCH'],
    [`${API}/follows`, 'DELETE'],
    ['https://x.supabase.co/storage/v1/object/photos/a', 'POST'],
  ] as const) {
    const failing = scripted(['fail']);
    await assert.rejects(resilient(failing.fetch, () => true, fast)(url, { method, body: '{}' }));
    assert.equal(failing.calls(), 1, `${method} ${url} was sent more than once`);
    const hanging = scripted(['hang']);
    let settled = false;
    void resilient(hanging.fetch, () => true, fast)(url, { method, body: '{}' }).then(() => (settled = true), () => (settled = true));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(settled, false, `${method} ${url} was given a time limit`);
  }
});

await check('offline, a read gets one short try and fails fast instead of waiting', async () => {
  const s = scripted(['hang']);
  const t0 = Date.now();
  await assert.rejects(resilient(s.fetch, () => false, fast)(`${API}/profiles`));
  assert.equal(s.calls(), 1);
  assert.ok(Date.now() - t0 < 55, 'used the short limit, not the full one');
});

await check('the caller cancelling a read is respected, not retried', async () => {
  const s = scripted(['hang']);
  const controller = new AbortController();
  const pending = resilient(s.fetch, () => true, fast)(`${API}/profiles`, { signal: controller.signal });
  setTimeout(() => controller.abort(new DOMException('gone', 'AbortError')), 10);
  await assert.rejects(pending, /gone|Abort/);
  assert.equal(s.calls(), 1);
});

console.log(`\nAll ${checks} resilient-fetch checks passed.`);
