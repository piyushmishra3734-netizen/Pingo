/**
 * PINGO's pictures and videos on R2: stories, posts, profile pictures, covers.
 *
 * They used to be read from Supabase Storage, where every view of every story
 * is egress on the bill. R2 charges nothing to read, so the things everybody
 * looks at all day live here. Chat media stays on Supabase.
 *
 * ## Two kinds of file
 *
 * - Public (`avatar`, `cover`): a face is shown to anybody who sees a name, so
 *   it has a plain, permanent link, exactly like the old public bucket.
 * - Private (`story`, `post`): who may see a story or a post is the database's
 *   decision (close friends, a custom list, a private account). A link to one
 *   is only handed out by `/sign`, which asks Supabase, as the viewer, which of
 *   the asked-for files they can see (`visible_media`, under row level
 *   security). The link carries an expiry and an HMAC, like Supabase's own
 *   signed URLs, so one that leaks stops working within hours.
 *
 * ## Routes
 *
 *   POST   /upload?kind=&type=  the file as the body          -> { path, url? }
 *   POST   /sign   { paths }    links for the files you may see -> { urls }
 *   POST   /delete { paths }    your own files; or any, with the purge key
 *   GET    /p/<kind>/<user>/<file>                 a public file
 *   GET    /s/<kind>/<user>/<file>?e=&sig=         a private file, signed
 *
 * A path, as the app stores it in the database, is `r2:<kind>/<user>/<file>`.
 * The prefix is what tells the app a row's media is here and not on Supabase.
 */

interface Env {
  MEDIA: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SIGNING_KEY: string;
  PURGE_KEY?: string;
}

const PUBLIC_KINDS = new Set(['avatar', 'cover']);
const PRIVATE_KINDS = new Set(['story', 'post']);

const MB = 1024 * 1024;
/** Per file. A 60 second phone video at original quality fits; a whole film does not. */
const MAX_BYTES: Record<string, number> = { image: 30 * MB, video: 95 * MB, audio: 25 * MB };

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'weba',
};

/** Signed links stay the same for a window, so a viewer's cache keeps working. */
const SIGN_WINDOW_S = 6 * 60 * 60;

const PATH = /^r2:(avatar|cover|story|post)\/([0-9a-f-]{36})\/([0-9a-f]{32}\.[a-z0-9]{2,5})$/i;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, range, x-purge-key',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The Supabase user behind a bearer token, or null. */
async function whoIs(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+$/.test(auth)) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: auth, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = (await res.json().catch(() => null)) as { id?: string } | null;
  return typeof user?.id === 'string' && /^[0-9a-f-]{36}$/i.test(user.id) ? user.id : null;
}

let signingKey: { raw: string; key: CryptoKey } | undefined;

async function hmac(env: Env, message: string): Promise<string> {
  if (!signingKey || signingKey.raw !== env.SIGNING_KEY) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.SIGNING_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    signingKey = { raw: env.SIGNING_KEY, key };
  }
  const mac = await crypto.subtle.sign('HMAC', signingKey.key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readPaths(request: Request): Promise<string[] | null> {
  const body = (await request.json().catch(() => null)) as { paths?: unknown } | null;
  if (!body || !Array.isArray(body.paths) || body.paths.length > 200) return null;
  return body.paths.filter((p): p is string => typeof p === 'string' && PATH.test(p));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- read ----------------------------------------------------------------
    const read = /^\/(p|s)\/(avatar|cover|story|post)\/([0-9a-f-]{36})\/([0-9a-f]{32}\.[a-z0-9]{2,5})$/i.exec(path);
    if (read && (request.method === 'GET' || request.method === 'HEAD')) {
      const [, gate, kind, user, file] = read as unknown as [string, string, string, string, string];
      const stored = `r2:${kind}/${user}/${file}`;
      if (gate === 'p') {
        if (!PUBLIC_KINDS.has(kind)) return new Response('Not found', { status: 404, headers: cors });
      } else {
        if (!PRIVATE_KINDS.has(kind)) return new Response('Not found', { status: 404, headers: cors });
        const expires = Number(url.searchParams.get('e'));
        const sig = url.searchParams.get('sig') ?? '';
        if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return new Response('Link expired', { status: 403, headers: cors });
        if (!sameSecret(sig, await hmac(env, `${stored}|${expires}`))) return new Response('Not allowed', { status: 403, headers: cors });
      }
      return serve(request, env, `media/${kind}/${user}/${file}`, gate === 'p');
    }

    // ---- delete (the purge job, by key) -----------------------------------------
    if (path === '/delete' && request.method === 'POST' && request.headers.has('x-purge-key')) {
      if (!env.PURGE_KEY || !sameSecret(request.headers.get('x-purge-key') ?? '', env.PURGE_KEY)) return fail(401, 'Not allowed');
      const paths = await readPaths(request);
      if (!paths) return fail(400, 'Bad request');
      await deleteAll(env, paths);
      return json({ ok: true, deleted: paths.length });
    }

    // ---- everything else is somebody signed in ----------------------------------
    const user = await whoIs(request, env);
    if (!user) return fail(401, 'Sign in to PINGO first.');

    if (path === '/upload' && request.method === 'POST') {
      const kind = url.searchParams.get('kind') ?? '';
      if (!PUBLIC_KINDS.has(kind) && !PRIVATE_KINDS.has(kind)) return fail(400, 'Unknown kind.');
      const type = (url.searchParams.get('type') ?? request.headers.get('content-type') ?? '').toLowerCase().split(';')[0]!.trim();
      const ext = EXTENSIONS[type];
      if (!ext) return fail(415, 'PINGO cannot show that kind of file.');
      // Only stories carry video and sound; a face or a post is a picture.
      const family = type.split('/')[0]!;
      if (family !== 'image' && kind !== 'story') return fail(415, 'That has to be a picture.');
      const max = MAX_BYTES[family] ?? 0;
      if (Number(request.headers.get('content-length') ?? 0) > max) return fail(413, 'That file is too big.');

      const body = await request.arrayBuffer();
      if (body.byteLength === 0) return fail(400, 'That file is empty.');
      if (body.byteLength > max) return fail(413, 'That file is too big.');

      const id = crypto.randomUUID().replace(/-/g, '');
      const file = `${id}.${ext}`;
      await env.MEDIA.put(`media/${kind}/${user}/${file}`, body, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { owner: user },
      });
      const stored = `r2:${kind}/${user}/${file}`;
      return json(
        { path: stored, ...(PUBLIC_KINDS.has(kind) ? { url: `${url.origin}/p/${kind}/${user}/${file}` } : {}) },
        201,
      );
    }

    if (path === '/sign' && request.method === 'POST') {
      const paths = await readPaths(request);
      if (!paths) return fail(400, 'Bad request');
      const wanted = [...new Set(paths)].filter((p) => PRIVATE_KINDS.has(PATH.exec(p)![1]!.toLowerCase()));
      if (wanted.length === 0) return json({ urls: {} });

      // Asked as the viewer, so row level security decides, as it always has.
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/visible_media`, {
        method: 'POST',
        headers: {
          authorization: request.headers.get('authorization')!,
          apikey: env.SUPABASE_ANON_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_paths: wanted }),
      });
      if (!res.ok) return fail(502, 'Could not check who can see this.');
      const visible = new Set(((await res.json().catch(() => [])) as unknown[]).filter((p): p is string => typeof p === 'string'));

      const now = Math.floor(Date.now() / 1000);
      const expires = (Math.floor(now / SIGN_WINDOW_S) + 2) * SIGN_WINDOW_S;
      const urls: Record<string, string> = {};
      for (const stored of wanted) {
        if (!visible.has(stored)) continue;
        const sig = await hmac(env, `${stored}|${expires}`);
        urls[stored] = `${url.origin}/s/${stored.slice(3)}?e=${expires}&sig=${sig}`;
      }
      return json({ urls, expiresAt: expires * 1000 });
    }

    if (path === '/delete' && request.method === 'POST') {
      const paths = await readPaths(request);
      if (!paths) return fail(400, 'Bad request');
      // Your own files only: the owner is the second part of the path.
      const mine = paths.filter((p) => PATH.exec(p)![2]!.toLowerCase() === user.toLowerCase());
      await deleteAll(env, mine);
      return json({ ok: true, deleted: mine.length });
    }

    return fail(404, 'Not found');
  },
};

async function deleteAll(env: Env, paths: string[]): Promise<void> {
  const keys = paths.map((p) => `media/${p.slice(3)}`);
  for (let i = 0; i < keys.length; i += 1000) await env.MEDIA.delete(keys.slice(i, i + 1000));
}

async function serve(request: Request, env: Env, key: string, isPublic: boolean): Promise<Response> {
  if (request.method === 'HEAD') {
    const head = await env.MEDIA.head(key);
    if (!head) return new Response('Not found', { status: 404, headers: cors });
    return new Response(null, { headers: fileHeaders(head, isPublic) });
  }
  const wantsRange = request.headers.has('range');
  const object = await env.MEDIA.get(key, { ...(wantsRange ? { range: request.headers } : {}), onlyIf: request.headers });
  if (!object) return new Response('Not found', { status: 404, headers: cors });
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers: fileHeaders(object, isPublic) });
  const headers = fileHeaders(object, isPublic);
  if (wantsRange && object.range && 'offset' in object.range) {
    const start = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - start;
    headers.set('content-range', `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
  }
  return new Response(object.body, { status: wantsRange ? 206 : 200, headers });
}

function fileHeaders(object: R2Object, isPublic: boolean): Headers {
  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(object.size));
  // A file never changes once uploaded; a new upload is a new name. A private
  // one is kept by the viewer's browser only, never by a shared cache.
  headers.set('cache-control', isPublic ? 'public, max-age=31536000, immutable' : 'private, max-age=43200');
  return headers;
}
