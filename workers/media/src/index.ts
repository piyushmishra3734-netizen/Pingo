/**
 * PINGO's media on R2: stories, posts, profile pictures, covers, and the media
 * in chats (photos, voice notes, documents - which is also where video arrives -
 * and Pings).
 *
 * They used to be read from Supabase Storage, where every view is egress on
 * the bill. R2 charges nothing to read, so the things everybody looks at all
 * day live here. Only the chat's text and rows stay in the database.
 *
 * ## Two kinds of file
 *
 * - Public (`avatar`, `cover`): a face is shown to anybody who sees a name, so
 *   it has a plain, permanent link, exactly like the old public bucket.
 * - Private (`story`, `post`, and chat media `photo`, `voice`, `doc`, `snap`): who may
 *   see one is the database's decision (close friends, a private account, being
 *   in the conversation). A link to one is only handed out by `/sign`, which asks
 *   Supabase, as the viewer, which of the asked-for files they can see
 *   (`visible_media` for stories and posts, `visible_chat_media` for chat media).
 *   The link carries an expiry and an HMAC, like Supabase's own signed URLs, so
 *   one that leaks stops working within hours - or, for a Ping, within a couple
 *   of minutes (`short`).
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
/** Visible by who follows whom, and by account privacy. */
const FEED_KINDS = new Set(['story', 'post']);
/** Visible by being in the conversation, or by having uploaded it. */
const CHAT_KINDS = new Set(['photo', 'voice', 'doc', 'snap']);
const PRIVATE_KINDS = new Set([...FEED_KINDS, ...CHAT_KINDS]);
const KIND_NAMES = 'avatar|cover|story|post|photo|voice|doc|snap';

const MB = 1024 * 1024;
/** Per file. A 60 second phone video at original quality fits; a whole film does not. */
const MAX_BYTES: Record<string, number> = { image: 30 * MB, video: 95 * MB, audio: 25 * MB };
/** Chat media, by kind: the same numbers the app refuses at (`MEDIA_LIMITS` in packages/core). */
const MAX_CHAT_BYTES: Record<string, number> = { photo: 25 * MB, voice: 25 * MB, snap: 25 * MB, doc: 100 * MB };

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
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'video/3gpp': '3gp',
  'video/x-matroska': 'mkv',
  'application/pdf': 'pdf',
};

/**
 * What a document may be served as. Anything else is stored and served as plain
 * bytes to save, never as a page: a document is whatever somebody attached, and
 * a `.html` or `.svg` of theirs must not run on this origin.
 */
function documentType(type: string): string {
  if (/^(video|audio)\//.test(type)) return type;
  if (/^image\/(jpeg|png|webp|gif|avif|heic)$/.test(type) || type === 'application/pdf') return type;
  return 'application/octet-stream';
}

/** Signed links stay the same for a window, so a viewer's cache keeps working. */
const SIGN_WINDOW_S = 6 * 60 * 60;
/** A Ping's link only has to outlive the fetch that follows it. */
const SHORT_LINK_S = 120;

const PATH = new RegExp(`^r2:(${KIND_NAMES})/([0-9a-f-]{36})/([0-9a-f]{32}\\.[a-z0-9]{2,5})$`, 'i');

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
    const read = new RegExp(`^/(p|s)/(${KIND_NAMES})/([0-9a-f-]{36})/([0-9a-f]{32}\\.[a-z0-9]{2,5})$`, 'i').exec(path);
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
      return serve(request, env, `media/${kind}/${user}/${file}`, gate === 'p', kind);
    }

    // ---- delete (the purge job, by key) -----------------------------------------
    if (path === '/delete' && request.method === 'POST' && request.headers.has('x-purge-key')) {
      if (!env.PURGE_KEY || !sameSecret(request.headers.get('x-purge-key') ?? '', env.PURGE_KEY)) return fail(401, 'Not allowed');
      const paths = await readPaths(request);
      if (!paths) return fail(400, 'Bad request');
      await deleteAll(env, paths);
      return json({ ok: true, deleted: paths.length });
    }

    /*
     * A link for the server's own use: the assistant reads the photo or document
     * somebody just sent it. The caller has already read the message under
     * row level security, so it knows the file is one this person may show it;
     * what it holds is the purge key, which nothing a person has can produce.
     * Chat media only, and never longer than an hour.
     */
    if (path === '/internal/sign' && request.method === 'POST' && request.headers.has('x-purge-key')) {
      if (!env.PURGE_KEY || !sameSecret(request.headers.get('x-purge-key') ?? '', env.PURGE_KEY)) return fail(401, 'Not allowed');
      const asked = (await request.clone().json().catch(() => null)) as { seconds?: unknown } | null;
      const paths = await readPaths(request);
      if (!paths) return fail(400, 'Bad request');
      const seconds = Math.min(3600, Math.max(30, Number(asked?.seconds) || 300));
      const expires = Math.floor(Date.now() / 1000) + seconds;
      const urls: Record<string, string> = {};
      for (const stored of new Set(paths)) {
        if (!CHAT_KINDS.has(PATH.exec(stored)![1]!.toLowerCase())) continue;
        urls[stored] = `${url.origin}/s/${stored.slice(3)}?e=${expires}&sig=${await hmac(env, `${stored}|${expires}`)}`;
      }
      return json({ urls, expiresAt: expires * 1000 });
    }

    // ---- everything else is somebody signed in ----------------------------------
    const user = await whoIs(request, env);
    if (!user) return fail(401, 'Sign in to PINGO first.');

    if (path === '/upload' && request.method === 'POST') {
      const kind = url.searchParams.get('kind') ?? '';
      if (!PUBLIC_KINDS.has(kind) && !PRIVATE_KINDS.has(kind)) return fail(400, 'Unknown kind.');
      const type = (url.searchParams.get('type') ?? request.headers.get('content-type') ?? '').toLowerCase().split(';')[0]!.trim();
      const family = type.split('/')[0]!;
      let ext: string | undefined;
      let contentType: string;
      let max: number;
      if (CHAT_KINDS.has(kind)) {
        // What each chat kind may hold. A document is anything, served safely.
        if ((kind === 'photo' || kind === 'snap') && family !== 'image') return fail(415, 'That has to be a picture.');
        if (kind === 'voice' && family !== 'audio') return fail(415, 'That has to be a voice note.');
        if (kind === 'doc') {
          contentType = documentType(type);
          ext = EXTENSIONS[contentType] ?? 'bin';
        } else {
          contentType = type;
          ext = EXTENSIONS[type];
        }
        max = MAX_CHAT_BYTES[kind]!;
      } else {
        contentType = type;
        ext = EXTENSIONS[type];
        // Only stories carry video and sound; a face or a post is a picture.
        if (ext && family !== 'image' && kind !== 'story') return fail(415, 'That has to be a picture.');
        max = MAX_BYTES[family] ?? 0;
      }
      if (!ext) return fail(415, 'PINGO cannot show that kind of file.');

      /*
       * Streamed when the size is declared, so a hundred megabyte video is not
       * held in the Worker's memory. A body with no declared length is read
       * whole, which is safe only because it is then checked against the limit.
       */
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (declared > max) return fail(413, 'That file is too big.');
      let body: ArrayBuffer | ReadableStream;
      if (declared > 0 && request.body) {
        body = request.body;
      } else {
        const whole = await request.arrayBuffer();
        if (whole.byteLength === 0) return fail(400, 'That file is empty.');
        if (whole.byteLength > max) return fail(413, 'That file is too big.');
        body = whole;
      }

      const id = crypto.randomUUID().replace(/-/g, '');
      const file = `${id}.${ext}`;
      await env.MEDIA.put(`media/${kind}/${user}/${file}`, body, {
        httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { owner: user },
      });
      const storedPath = `r2:${kind}/${user}/${file}`;
      return json(
        { path: storedPath, ...(PUBLIC_KINDS.has(kind) ? { url: `${url.origin}/p/${kind}/${user}/${file}` } : {}) },
        201,
      );
    }

    if (path === '/sign' && request.method === 'POST') {
      const asked = (await request.clone().json().catch(() => null)) as { short?: unknown } | null;
      const paths = await readPaths(request);
      if (!paths) return fail(400, 'Bad request');
      const kindOf = (p: string) => PATH.exec(p)![1]!.toLowerCase();
      const unique = [...new Set(paths)];
      const feed = unique.filter((p) => FEED_KINDS.has(kindOf(p)));
      const chat = unique.filter((p) => CHAT_KINDS.has(kindOf(p)));
      if (feed.length + chat.length === 0) return json({ urls: {} });

      // Asked as the viewer, so row level security decides, as it always has.
      const ask = async (fn: string, wanted: string[]): Promise<Set<string> | null> => {
        if (wanted.length === 0) return new Set();
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: {
            authorization: request.headers.get('authorization')!,
            apikey: env.SUPABASE_ANON_KEY,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ p_paths: wanted }),
        });
        if (!res.ok) return null;
        return new Set(((await res.json().catch(() => [])) as unknown[]).filter((p): p is string => typeof p === 'string'));
      };
      const [seenFeed, seenChat] = await Promise.all([ask('visible_media', feed), ask('visible_chat_media', chat)]);
      if (!seenFeed || !seenChat) return fail(502, 'Could not check who can see this.');
      const visible = new Set([...seenFeed, ...seenChat]);

      /*
       * `short` is for a Ping, which has to stop being reachable almost as soon
       * as it has been looked at: a couple of minutes, not the usual window.
       */
      const now = Math.floor(Date.now() / 1000);
      const expires = asked?.short === true ? now + SHORT_LINK_S : (Math.floor(now / SIGN_WINDOW_S) + 2) * SIGN_WINDOW_S;
      const urls: Record<string, string> = {};
      for (const stored of [...feed, ...chat]) {
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

async function serve(request: Request, env: Env, key: string, isPublic: boolean, kind: string): Promise<Response> {
  if (request.method === 'HEAD') {
    const head = await env.MEDIA.head(key);
    if (!head) return new Response('Not found', { status: 404, headers: cors });
    return new Response(null, { headers: fileHeaders(head, isPublic, kind) });
  }
  const wantsRange = request.headers.has('range');
  const object = await env.MEDIA.get(key, { ...(wantsRange ? { range: request.headers } : {}), onlyIf: request.headers });
  if (!object) return new Response('Not found', { status: 404, headers: cors });
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers: fileHeaders(object, isPublic, kind) });
  const headers = fileHeaders(object, isPublic, kind);
  if (wantsRange && object.range && 'offset' in object.range) {
    const start = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - start;
    headers.set('content-range', `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
  }
  return new Response(object.body, { status: wantsRange ? 206 : 200, headers });
}

function fileHeaders(object: R2Object, isPublic: boolean, kind: string): Headers {
  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  // Never let a browser decide a file is something other than what it was stored as.
  headers.set('x-content-type-options', 'nosniff');
  // A document that is not media is for saving, not for showing.
  if (kind === 'doc' && headers.get('content-type') === 'application/octet-stream') {
    headers.set('content-disposition', 'attachment');
  }
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(object.size));
  // A file never changes once uploaded; a new upload is a new name. A private
  // one is kept by the viewer's browser only, never by a shared cache.
  headers.set('cache-control', isPublic ? 'public, max-age=31536000, immutable' : 'private, max-age=43200');
  return headers;
}
