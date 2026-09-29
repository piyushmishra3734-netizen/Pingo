/**
 * PINGO's own songs: what people upload to the "Uploads" shelf.
 *
 * The public catalogue (JioSaavn, through `pingo-music`) is mostly Indian music
 * and cannot be added to. This is the other half: anybody can put a song of
 * their own into PINGO - an audio file, or the sound out of a video, which the
 * app extracts before it gets here - give it a name, and then use it anywhere
 * a song goes: a chat, a story, a snap, their profile.
 *
 * ## Routes
 *
 *   POST   /upload            the file as the body; name, artist, secs, type in the query
 *   GET    /mine              the signed-in person's songs, newest first
 *   DELETE /song/:id          removes one of your own
 *   GET    /file/:user/:file  plays one - public, with range requests, like any link
 *
 * ## Storage
 *
 * `songs/<user id>/<song id>.<ext>` for the audio, and one small JSON index per
 * person at `songs/<user id>/index.json` for the list. No database table: the
 * list is only ever read by its owner, and keeping it next to the files means
 * one place to look and one thing to deploy.
 *
 * ## Who is asking
 *
 * Every write, and the list, carry the app's Supabase access token. It is
 * checked by asking Supabase Auth who it belongs to - the same question the
 * database asks - so this Worker holds no signing secret of its own.
 * Playing a song needs no token: a song sent in a chat is a link, and the
 * person it was sent to has to be able to open it.
 */

interface Env {
  SONGS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

interface SongEntry {
  id: string;
  name: string;
  artist: string;
  /** Path under /file/, e.g. `<user>/<id>.mp3`. */
  file: string;
  secs: number;
  type: string;
  size: number;
  createdAt: number;
}

/** Big enough for a long song as an mp3, small enough that nobody fills the bucket. */
const MAX_BYTES = 25 * 1024 * 1024;
/** Per person. Past this, delete one to add another. */
const MAX_SONGS = 100;

const EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
};

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, range',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
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

const indexKey = (user: string) => `songs/${user}/index.json`;

async function readIndex(env: Env, user: string): Promise<SongEntry[]> {
  const object = await env.SONGS.get(indexKey(user));
  if (!object) return [];
  const list = (await object.json().catch(() => [])) as unknown;
  return Array.isArray(list) ? (list as SongEntry[]) : [];
}

async function writeIndex(env: Env, user: string, list: SongEntry[]): Promise<void> {
  await env.SONGS.put(indexKey(user), JSON.stringify(list), { httpMetadata: { contentType: 'application/json' } });
}

function clean(text: string | null, max: number): string {
  return (text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- play ------------------------------------------------------------
    const file = /^\/file\/([0-9a-f-]{36})\/([\w-]{8,40}\.[a-z0-9]{2,5})$/i.exec(path);
    if (file && (request.method === 'GET' || request.method === 'HEAD')) {
      const key = `songs/${file[1]}/${file[2]}`;
      if (request.method === 'HEAD') {
        const head = await env.SONGS.head(key);
        if (!head) return new Response('Not found', { status: 404, headers: cors });
        return new Response(null, { headers: fileHeaders(head) });
      }
      const wantsRange = request.headers.has('range');
      const object = await env.SONGS.get(key, { ...(wantsRange ? { range: request.headers } : {}), onlyIf: request.headers });
      if (!object) return new Response('Not found', { status: 404, headers: cors });
      if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers: fileHeaders(object) });
      const headers = fileHeaders(object);
      if (wantsRange && object.range && 'offset' in object.range) {
        const start = object.range.offset ?? 0;
        const length = object.range.length ?? object.size - start;
        headers.set('content-range', `bytes ${start}-${start + length - 1}/${object.size}`);
        headers.set('content-length', String(length));
      }
      return new Response(object.body, { status: wantsRange ? 206 : 200, headers });
    }

    // ---- everything else is somebody signed in -------------------------------
    const user = await whoIs(request, env);
    if (!user) return fail(401, 'Sign in to PINGO first.');

    if (path === '/mine' && request.method === 'GET') {
      const list = await readIndex(env, user);
      return json({ songs: list.map((s) => ({ ...s, url: `${url.origin}/file/${s.file}` })) });
    }

    if (path === '/upload' && request.method === 'POST') {
      const type = clean(url.searchParams.get('type') ?? request.headers.get('content-type'), 60).toLowerCase().split(';')[0] ?? '';
      const ext = EXTENSIONS[type];
      if (!ext) return fail(415, 'That is not an audio file PINGO can play.');
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (declared > MAX_BYTES) return fail(413, 'That file is too big. Songs can be up to 25 MB.');
      const name = clean(url.searchParams.get('name'), 80);
      if (!name) return fail(400, 'Give the song a name.');
      const artist = clean(url.searchParams.get('artist'), 80);
      const secs = Math.max(0, Math.min(60 * 60, Math.round(Number(url.searchParams.get('secs')) || 0)));

      const list = await readIndex(env, user);
      if (list.length >= MAX_SONGS) return fail(409, `You have ${MAX_SONGS} songs. Delete one to add another.`);

      const body = await request.arrayBuffer();
      if (body.byteLength === 0) return fail(400, 'That file is empty.');
      if (body.byteLength > MAX_BYTES) return fail(413, 'That file is too big. Songs can be up to 25 MB.');

      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const fileName = `${id}.${ext}`;
      await env.SONGS.put(`songs/${user}/${fileName}`, body, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { name, artist, owner: user },
      });
      const entry: SongEntry = { id, name, artist, file: `${user}/${fileName}`, secs, type, size: body.byteLength, createdAt: Date.now() };
      await writeIndex(env, user, [entry, ...list]);
      return json({ song: { ...entry, url: `${url.origin}/file/${entry.file}` } }, 201);
    }

    const del = /^\/song\/([\w-]{8,40})$/.exec(path);
    if (del && request.method === 'DELETE') {
      const list = await readIndex(env, user);
      const entry = list.find((s) => s.id === del[1]);
      if (!entry) return fail(404, 'No such song.');
      await env.SONGS.delete(`songs/${entry.file}`);
      await writeIndex(env, user, list.filter((s) => s.id !== entry.id));
      return json({ ok: true });
    }

    return fail(404, 'Not found');
  },
};

function fileHeaders(object: R2Object): Headers {
  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(object.size));
  // A song's file never changes once uploaded; a new upload is a new name.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return headers;
}
