/**
 * The media Worker's chat media: what may go in, who is handed a link, and what
 * the link serves. Run against the real Worker code with an in-memory bucket
 * and a Supabase that answers from a table, so nothing here touches a network.
 *
 *   pnpm verify:media-worker
 */
import assert from 'node:assert/strict';

import worker from '../../../workers/media/src/index.js';

const ORIGIN = 'https://media.test';
const SUPABASE = 'https://supabase.test';
const ME = '11111111-1111-4111-8111-111111111111';
const FRIEND = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';

// ---- an in-memory R2 ---------------------------------------------------------
interface Stored {
  bytes: Uint8Array;
  contentType: string;
}
const bucket = new Map<string, Stored>();

async function drain(value: ArrayBuffer | ReadableStream | Uint8Array): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function r2Object(key: string, item: Stored, range?: { offset: number; length: number }) {
  const slice = range ? item.bytes.slice(range.offset, range.offset + range.length) : item.bytes;
  return {
    key,
    size: item.bytes.length,
    httpEtag: '"etag"',
    writeHttpMetadata(headers: Headers) {
      headers.set('content-type', item.contentType);
    },
    body: new Response(slice).body,
    ...(range ? { range } : {}),
  };
}

const MEDIA = {
  async put(key: string, value: ArrayBuffer | ReadableStream, options: { httpMetadata: { contentType: string } }) {
    bucket.set(key, { bytes: await drain(value), contentType: options.httpMetadata.contentType });
  },
  async get(key: string, options: { range?: Headers } = {}) {
    const item = bucket.get(key);
    if (!item) return null;
    const asked = options.range?.get('range');
    const m = asked ? /bytes=(\d+)-(\d*)/.exec(asked) : null;
    if (!m) return r2Object(key, item);
    const offset = Number(m[1]);
    const end = m[2] ? Number(m[2]) : item.bytes.length - 1;
    return r2Object(key, item, { offset, length: end - offset + 1 });
  },
  async head(key: string) {
    const item = bucket.get(key);
    return item ? r2Object(key, item) : null;
  },
  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) bucket.delete(key);
  },
};

// ---- a Supabase that answers from a table ------------------------------------
/** What `visible_chat_media` says each person may read: their own, plus these. */
const memberOf: Record<string, Set<string>> = { [FRIEND]: new Set(), [STRANGER]: new Set(), [ME]: new Set() };
const rpcCalls: string[] = [];
let failRpc = false;
/** What `take_media_quota` answers; `'missing'` is a database that does not have it yet. */
let quota: boolean | 'missing' = true;
const budgetAsked: number[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  const who = /^Bearer token-(.+)$/.exec(auth)?.[1];
  if (url === `${SUPABASE}/auth/v1/user`) {
    return who ? Response.json({ id: who }) : new Response('no', { status: 401 });
  }
  const rpc = /\/rest\/v1\/rpc\/(\w+)$/.exec(url)?.[1];
  if (rpc && who) {
    rpcCalls.push(rpc);
    if (failRpc) return new Response('down', { status: 500 });
    const asked = (JSON.parse(String(init?.body)) as { p_paths: string[] }).p_paths;
    if (rpc === 'visible_chat_media') {
      // The rule: your own folder, or a path a message you can see names.
      return Response.json(asked.filter((p) => p.split('/')[1] === who || memberOf[who!]?.has(p)));
    }
    if (rpc === 'take_media_quota') {
      budgetAsked.push((JSON.parse(String(init?.body)) as { p_bytes: number }).p_bytes);
      return quota === 'missing' ? new Response('no such function', { status: 404 }) : Response.json(quota);
    }
    if (rpc === 'visible_media') return Response.json(asked.filter((p) => p.split('/')[1] === who));
  }
  return new Response('?', { status: 404 });
}) as typeof fetch;

const env = { MEDIA, SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: 'anon', SIGNING_KEY: 'k'.repeat(32), PURGE_KEY: 'purge-secret' };

const call = (path: string, init: RequestInit & { as?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.as) headers.set('authorization', `Bearer token-${init.as}`);
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env as never);
};

const upload = (as: string, kind: string, type: string, body: Uint8Array | string) => {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return call(`/upload?kind=${kind}&type=${encodeURIComponent(type)}`, {
    method: 'POST',
    as,
    headers: { 'content-type': type, 'content-length': String(bytes.length) },
    body: bytes as unknown as BodyInit,
  });
};

const sign = async (as: string, paths: string[], short = false) => {
  const res = await call('/sign', {
    method: 'POST',
    as,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths, ...(short ? { short: true } : {}) }),
  });
  return { status: res.status, body: (await res.json()) as { urls?: Record<string, string>; expiresAt?: number } };
};

let checks = 0;
const check = async (name: string, run: () => Promise<void>) => {
  await run();
  checks += 1;
  console.log('PASS ', name);
};

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6]);

// ---- what may go in ----------------------------------------------------------
let photoPath = '';
await check('a chat photo is stored under the sender, as an image', async () => {
  const res = await upload(ME, 'photo', 'image/png', png);
  assert.equal(res.status, 201);
  const { path } = (await res.json()) as { path: string };
  assert.match(path, new RegExp(`^r2:photo/${ME}/[0-9a-f]{32}\\.png$`));
  assert.deepEqual(bucket.get(`media/${path.slice(3)}`)?.bytes, png);
  assert.equal(bucket.get(`media/${path.slice(3)}`)?.contentType, 'image/png');
  photoPath = path;
});

await check('a chat photo that is not a picture is refused', async () => {
  assert.equal((await upload(ME, 'photo', 'audio/wav', 'riff')).status, 415);
  assert.equal((await upload(ME, 'snap', 'application/pdf', 'x')).status, 415);
});

let voicePath = '';
await check('a voice note must be audio, and keeps its type', async () => {
  assert.equal((await upload(ME, 'voice', 'image/png', png)).status, 415);
  const res = await upload(ME, 'voice', 'audio/wav', 'RIFFWAVE');
  assert.equal(res.status, 201);
  voicePath = ((await res.json()) as { path: string }).path;
  assert.match(voicePath, /\.wav$/);
});

await check('a video document keeps its type and extension', async () => {
  const res = await upload(ME, 'doc', 'video/mp4', 'mp4bytes');
  assert.equal(res.status, 201);
  const { path } = (await res.json()) as { path: string };
  assert.match(path, /\.mp4$/);
  assert.equal(bucket.get(`media/${path.slice(3)}`)?.contentType, 'video/mp4');
});

let htmlDocPath = '';
await check('a document that could run as a page is stored as plain bytes', async () => {
  const res = await upload(ME, 'doc', 'text/html', '<script>alert(1)</script>');
  assert.equal(res.status, 201);
  htmlDocPath = ((await res.json()) as { path: string }).path;
  assert.match(htmlDocPath, /\.bin$/);
  assert.equal(bucket.get(`media/${htmlDocPath.slice(3)}`)?.contentType, 'application/octet-stream');
  const svg = await upload(ME, 'doc', 'image/svg+xml', '<svg onload=alert(1)/>');
  assert.equal(bucket.get(`media/${((await svg.json()) as { path: string }).path.slice(3)}`)?.contentType, 'application/octet-stream');
});

await check('the size limits are the ones the app refuses at', async () => {
  const MB = 1024 * 1024;
  const declared = (kind: string, type: string, mb: number) =>
    call(`/upload?kind=${kind}&type=${encodeURIComponent(type)}`, {
      method: 'POST',
      as: ME,
      headers: { 'content-type': type, 'content-length': String(mb * MB) },
      body: 'x',
    });
  assert.equal((await declared('photo', 'image/png', 26)).status, 413);
  assert.equal((await declared('voice', 'audio/wav', 26)).status, 413);
  assert.equal((await declared('doc', 'video/mp4', 101)).status, 413);
});

await check('signed-out uploads are refused', async () => {
  const res = await call('/upload?kind=photo&type=image%2Fpng', { method: 'POST', body: png as unknown as BodyInit });
  assert.equal(res.status, 401);
});

// ---- the daily budget -------------------------------------------------------
await check('an upload takes its size from the daily budget of whoever sends it', async () => {
  budgetAsked.length = 0;
  assert.equal((await upload(ME, 'photo', 'image/png', png)).status, 201);
  assert.deepEqual(budgetAsked, [png.length]);
});

await check('an upload over the budget is refused and stores nothing', async () => {
  const before = bucket.size;
  quota = false;
  const res = await upload(ME, 'photo', 'image/png', png);
  quota = true;
  assert.equal(res.status, 429);
  assert.equal(bucket.size, before);
});

await check('a database without the budget function does not stop an upload', async () => {
  quota = 'missing';
  const res = await upload(ME, 'photo', 'image/png', png);
  quota = true;
  assert.equal(res.status, 201);
});

// ---- who is handed a link ----------------------------------------------------
await check('the uploader is handed a link to their own file', async () => {
  const { status, body } = await sign(ME, [photoPath]);
  assert.equal(status, 200);
  assert.ok(body.urls?.[photoPath]?.startsWith(`${ORIGIN}/s/photo/${ME}/`));
});

await check('a member is handed a link once a message of theirs names the file, and a stranger never', async () => {
  assert.deepEqual((await sign(FRIEND, [photoPath])).body.urls, {});
  memberOf[FRIEND]!.add(photoPath);
  assert.ok((await sign(FRIEND, [photoPath])).body.urls?.[photoPath]);
  assert.deepEqual((await sign(STRANGER, [photoPath])).body.urls, {});
});

await check('chat media is checked against the chat rule, feed media against the feed rule', async () => {
  rpcCalls.length = 0;
  await sign(ME, [photoPath]);
  assert.deepEqual(rpcCalls, ['visible_chat_media']);
  rpcCalls.length = 0;
  await sign(ME, [`r2:story/${ME}/${'a'.repeat(32)}.jpg`, voicePath]);
  assert.deepEqual([...rpcCalls].sort(), ['visible_chat_media', 'visible_media']);
});

await check('when the check cannot be made, nothing is signed', async () => {
  failRpc = true;
  const res = await sign(ME, [photoPath]);
  failRpc = false;
  assert.equal(res.status, 502);
  assert.equal(res.body.urls, undefined);
});

await check('a Ping link is short-lived; an ordinary one lasts hours', async () => {
  const now = Date.now();
  const short = (await sign(ME, [photoPath], true)).body.expiresAt!;
  assert.ok(short > now && short <= now + 130_000, 'short link within a couple of minutes');
  const long = (await sign(ME, [photoPath])).body.expiresAt!;
  assert.ok(long >= now + 6 * 3600 * 1000, 'ordinary link lasts at least six hours');
});

// ---- what the link serves ----------------------------------------------------
const linkFor = async (as: string, path: string) => new URL((await sign(as, [path])).body.urls![path]!);

await check('a signed link serves the bytes, privately', async () => {
  const link = await linkFor(ME, photoPath);
  const res = await call(link.pathname + link.search);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), png);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('cache-control') ?? '', /^private/);
});

await check('a tampered, expired or unsigned link is refused', async () => {
  const link = await linkFor(ME, photoPath);
  const bad = new URL(link);
  bad.searchParams.set('sig', link.searchParams.get('sig')!.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')));
  assert.equal((await call(bad.pathname + bad.search)).status, 403);
  const old = new URL(link);
  old.searchParams.set('e', String(Math.floor(Date.now() / 1000) - 5));
  assert.equal((await call(old.pathname + old.search)).status, 403);
  assert.equal((await call(link.pathname)).status, 403);
});

await check('chat media is never served from the public route', async () => {
  const res = await call(`/p/photo/${ME}/${photoPath.split('/').pop()}`);
  assert.equal(res.status, 404);
});

await check('video can be read in ranges, so a player can seek', async () => {
  const up = await upload(ME, 'doc', 'video/mp4', '0123456789');
  const { path } = (await up.json()) as { path: string };
  const link = await linkFor(ME, path);
  const res = await call(link.pathname + link.search, { headers: { range: 'bytes=2-5' } });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), '2345');
  assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
});

await check('a document that is not media is served to save, never to show', async () => {
  const link = await linkFor(ME, htmlDocPath);
  const res = await call(link.pathname + link.search);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('content-disposition'), 'attachment');
});

// ---- deleting ----------------------------------------------------------------
const del = (as: string, paths: string[]) =>
  call('/delete', { method: 'POST', as, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths }) });

await check('you can delete your own chat media, not somebody else\'s', async () => {
  await del(FRIEND, [photoPath]);
  assert.ok(bucket.has(`media/${photoPath.slice(3)}`), 'a member cannot delete the sender\'s file');
  await del(ME, [photoPath]);
  assert.ok(!bucket.has(`media/${photoPath.slice(3)}`));
});

await check('the purge job can delete any chat media, with its key and only with it', async () => {
  const keep = (await (await upload(ME, 'voice', 'audio/wav', 'abc')).json()) as { path: string };
  const wrong = await call('/delete', {
    method: 'POST',
    headers: { 'x-purge-key': 'nope', 'content-type': 'application/json' },
    body: JSON.stringify({ paths: [keep.path] }),
  });
  assert.equal(wrong.status, 401);
  assert.ok(bucket.has(`media/${keep.path.slice(3)}`));
  const right = await call('/delete', {
    method: 'POST',
    headers: { 'x-purge-key': 'purge-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ paths: [keep.path] }),
  });
  assert.equal(right.status, 200);
  assert.ok(!bucket.has(`media/${keep.path.slice(3)}`));
});

// ---- the server's own link (the assistant reading what it was sent) ----------
await check('the assistant gets a link only with the purge key, for chat media only, and it serves', async () => {
  const up = (await (await upload(ME, 'photo', 'image/png', png)).json()) as { path: string };
  const story = `r2:story/${ME}/${'b'.repeat(32)}.jpg`;
  const ask = (key: string | null) =>
    call('/internal/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'x-purge-key': key } : {}) },
      body: JSON.stringify({ paths: [up.path, story], seconds: 600 }),
    });
  assert.notEqual((await ask(null)).status, 200, 'no key, no link');
  assert.equal((await ask('nope')).status, 401);
  const ok = (await (await ask('purge-secret')).json()) as { urls: Record<string, string>; expiresAt: number };
  assert.deepEqual(Object.keys(ok.urls), [up.path], 'a story is not chat media');
  assert.ok(ok.expiresAt <= Date.now() + 601_000 && ok.expiresAt > Date.now() + 500_000);
  const link = new URL(ok.urls[up.path]!);
  assert.deepEqual(new Uint8Array(await (await call(link.pathname + link.search)).arrayBuffer()), png);
});

// ---- moving what was on Supabase before R2 ---------------------------------
await check('an old face can be imported with the purge key, and is then public and immutable', async () => {
  const imp = (key: string | null, qs: string) =>
    call(`/internal/import?${qs}`, { method: 'POST', headers: key ? { 'x-purge-key': key } : {}, body: png as unknown as BodyInit });
  const q = `kind=avatar&user=${FRIEND}&type=image%2Fpng`;
  assert.notEqual((await imp(null, q)).status, 201, 'no key, no import');
  assert.equal((await imp('nope', q)).status, 401);
  assert.equal((await imp('purge-secret', `kind=photo&user=${FRIEND}&type=image%2Fpng`)).status, 400, 'a chat photo is not importable');
  assert.equal((await imp('purge-secret', 'kind=avatar&user=nobody&type=image%2Fpng')).status, 400);
  const res = await imp('purge-secret', q);
  assert.equal(res.status, 201);
  const { url } = (await res.json()) as { url: string };
  assert.ok(url.startsWith(`${ORIGIN}/p/avatar/${FRIEND}/`));
  const got = await call(new URL(url).pathname);
  assert.equal(got.status, 200);
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), png);
  assert.equal(got.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

console.log(`\nAll ${checks} media-worker checks passed.`);
