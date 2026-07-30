/**
 * The Drive client against a Drive that behaves like Google's.
 *
 * Google is not reachable from here — there is no OAuth client for
 * `drive.appdata` yet and consent cannot be granted on anyone's behalf — so
 * this stands in a server implementing the same protocol: resumable sessions,
 * `308` with a `Range` header, `401` on a dead token, `404` on a deleted file.
 *
 * That boundary is worth being precise about. Everything below is measured;
 * whether Google's own responses match this contract is not, and remains an
 * integration test to run once the Cloud project exists.
 *
 * Run with `pnpm verify:drive`.
 */
import { DriveClient, DriveError, UPLOAD_CHUNK } from '../src/lib/backup/drive/client.js';
import { DriveAuthError, type DriveAuth, type DriveToken } from '../src/lib/backup/drive/auth.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** A Drive that can be told to misbehave in specific, realistic ways. */
class FakeDrive {
  files = new Map<string, { id: string; name: string; bytes: Uint8Array }>();
  sessions = new Map<string, { name: string; size: number; received: Uint8Array }>();
  validToken = 'good-token';
  /** Drop the connection after this many bytes of a single PUT, once. */
  cutAfter: number | undefined;
  requests = 0;
  nextId = 1;

  http = async (url: string, init: RequestInit = {}): Promise<Response> => {
    this.requests += 1;
    const method = init.method ?? 'GET';
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;

    // Session URIs carry their own capability; Google does not re-auth them.
    const isSession = url.startsWith('session:');
    if (!isSession && auth !== `Bearer ${this.validToken}`) {
      return new Response('{}', { status: 401 });
    }

    if (method === 'POST' && url.includes('uploadType=resumable')) {
      const body = JSON.parse(String(init.body)) as { name: string };
      const size = Number((init.headers as Record<string, string>)['X-Upload-Content-Length']);
      const id = `session:${this.nextId++}`;
      this.sessions.set(id, { name: body.name, size, received: new Uint8Array(0) });
      return new Response('{}', { status: 200, headers: { Location: id } });
    }

    if (method === 'PUT' && isSession) {
      const session = this.sessions.get(url);
      if (!session) return new Response('{}', { status: 404 });

      const range = (init.headers as Record<string, string>)['Content-Range'] ?? '';

      // Status query: "bytes *\/size"
      if (range.startsWith('bytes */')) {
        if (session.received.length === 0) return new Response('', { status: 308 });
        return new Response('', {
          status: 308,
          headers: { Range: `bytes=0-${session.received.length - 1}` },
        });
      }

      const [, startText] = /bytes (\d+)-(\d+)\/(\d+)/.exec(range) ?? [];
      const start = Number(startText);
      let body = new Uint8Array(init.body as ArrayBuffer);

      if (this.cutAfter !== undefined) {
        // Accept a prefix, then behave as if the connection dropped.
        body = body.subarray(0, this.cutAfter);
        this.cutAfter = undefined;
        const merged = new Uint8Array(start + body.length);
        merged.set(session.received.subarray(0, start));
        merged.set(body, start);
        session.received = merged;
        return new Response('', {
          status: 308,
          headers: { Range: `bytes=0-${merged.length - 1}` },
        });
      }

      const merged = new Uint8Array(Math.max(session.received.length, start + body.length));
      merged.set(session.received);
      merged.set(body, start);
      session.received = merged;

      if (session.received.length >= session.size) {
        const id = `file-${this.nextId++}`;
        this.files.set(id, { id, name: session.name, bytes: session.received });
        this.sessions.delete(url);
        return new Response(JSON.stringify({ id, name: session.name }), { status: 200 });
      }

      return new Response('', {
        status: 308,
        headers: { Range: `bytes=0-${session.received.length - 1}` },
      });
    }

    if (method === 'GET' && url.includes('alt=media')) {
      const id = /files\/([^?]+)/.exec(url)?.[1];
      const file = id ? this.files.get(id) : undefined;
      if (!file) return new Response('{}', { status: 404 });
      return new Response(file.bytes as unknown as BodyInit, { status: 200 });
    }

    if (method === 'GET') {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
      const exact = /name = '(.+)'/.exec(q)?.[1];
      const contains = /name contains '(.+)'/.exec(q)?.[1];
      const files = [...this.files.values()]
        .filter((f) => (exact ? f.name === exact : contains ? f.name.includes(contains) : true))
        .map((f) => ({ id: f.id, name: f.name, size: f.bytes.length }));
      return new Response(JSON.stringify({ files }), { status: 200 });
    }

    if (method === 'DELETE') {
      const id = /files\/([^?]+)/.exec(url)?.[1];
      if (!id || !this.files.has(id)) return new Response('{}', { status: 404 });
      this.files.delete(id);
      // 204 must carry no body at all, which undici enforces.
      return new Response(null, { status: 204 });
    }

    return new Response('{}', { status: 400 });
  };
}

/** Auth that can be exhausted, refreshed, or disconnected. */
class FakeAuth implements DriveAuth {
  token: DriveToken | undefined = { accessToken: 'good-token', expiresAt: Date.now() + 3_600_000 };
  silentCalls = 0;
  canRefresh = true;

  async authorize(): Promise<DriveToken> {
    this.token = { accessToken: 'good-token', expiresAt: Date.now() + 3_600_000 };
    return this.token;
  }
  async silent(): Promise<DriveToken | undefined> {
    this.silentCalls += 1;
    if (!this.canRefresh) return undefined;
    return this.token;
  }
  async disconnect(): Promise<void> {
    this.token = undefined;
    this.canRefresh = false;
  }
}

const payload = new Uint8Array(3 * UPLOAD_CHUNK + 1234);
for (let i = 0; i < payload.length; i += 1) payload[i] = i & 0xff;

console.log('— first backup —');

const drive = new FakeDrive();
const auth = new FakeAuth();
const client = new DriveClient(auth, drive.http);

const uploaded = await client.upload('pingo-archive.g1.bin', payload);
check(Boolean(uploaded.id), 'upload returns a file id');
check(drive.files.size === 1, 'exactly one file in appDataFolder');
const stored = [...drive.files.values()][0]!;
check(stored.bytes.length === payload.length, `all ${payload.length} bytes arrived`);
check(Buffer.compare(Buffer.from(stored.bytes), Buffer.from(payload)) === 0, 'bytes are unchanged');

console.log('\n— chunked, not one shot —');

/*
 * 3.001 chunks of payload must have crossed the wire as several PUTs. A single
 * request would mean UPLOAD_CHUNK is not being honoured, which is how a phone
 * on a bad connection ends up retrying megabytes.
 */
check(drive.requests >= 4, `sent in ${drive.requests} requests, not one`);

console.log('\n— restore —');

const found = await client.find('pingo-archive.g1.bin');
check(found?.id === stored.id, 'the archive is findable by name');
const downloaded = await client.download(found!.id);
check(
  Buffer.compare(Buffer.from(downloaded), Buffer.from(payload)) === 0,
  'download returns exactly what was uploaded',
);

console.log('\n— interrupted upload resumes —');

const resumeDrive = new FakeDrive();
const resumeClient = new DriveClient(new FakeAuth(), resumeDrive.http);
const session = await resumeClient.beginUpload('pingo-archive.g2.bin', payload.length);

// The connection dies partway through the first chunk.
resumeDrive.cutAfter = 100_000;
const finished = await resumeClient.transfer(session, payload);

check(Boolean(finished.id), 'the upload completes despite the interruption');
const resumed = [...resumeDrive.files.values()][0]!;
check(resumed.bytes.length === payload.length, 'every byte is present after resuming');
check(
  Buffer.compare(Buffer.from(resumed.bytes), Buffer.from(payload)) === 0,
  'and the resumed file is byte-identical',
);

console.log('\n— resuming asks what Drive already has —');

const partialDrive = new FakeDrive();
const partialClient = new DriveClient(new FakeAuth(), partialDrive.http);
const partialSession = await partialClient.beginUpload('resume-me.bin', payload.length);
partialDrive.sessions.get(partialSession)!.received = payload.subarray(0, UPLOAD_CHUNK);
const already = await partialClient.uploadedSoFar(partialSession, payload.length);
check(already === UPLOAD_CHUNK, `resumes from byte ${already}, not from zero`);

console.log('\n— expired token —');

const expiring = new FakeDrive();
const expiringAuth = new FakeAuth();
const expiringClient = new DriveClient(expiringAuth, expiring.http);
await expiringClient.upload('warm.bin', new Uint8Array(16));

// Google rotates the token; the cached one is now rejected.
expiring.validToken = 'rotated-token';
expiringAuth.token = { accessToken: 'rotated-token', expiresAt: Date.now() + 3_600_000 };
const before = expiringAuth.silentCalls;
const afterRotation = await expiringClient.upload('after-rotation.bin', new Uint8Array(16));
check(Boolean(afterRotation.id), 'a rotated token is refreshed and the upload succeeds');
check(expiringAuth.silentCalls > before, 'the refresh actually happened');

console.log('\n— token that cannot be refreshed —');

const deadAuth = new FakeAuth();
deadAuth.canRefresh = false;
const deadClient = new DriveClient(deadAuth, new FakeDrive().http);
let expired = false;
try {
  await deadClient.upload('nope.bin', new Uint8Array(16));
} catch (cause) {
  expired = cause instanceof DriveAuthError && cause.code === 'expired';
}
check(expired, 'the web case reports expired rather than failing mid-upload');

console.log('\n— disconnect —');

const dropDrive = new FakeDrive();
const dropAuth = new FakeAuth();
const dropClient = new DriveClient(dropAuth, dropDrive.http);
const doomed = await dropClient.upload('bye.bin', new Uint8Array(32));
await dropClient.remove(doomed.id);
check(dropDrive.files.size === 0, 'the blob is removed from Drive');
await dropClient.remove(doomed.id);
check(true, 'removing it twice is not an error');

await dropAuth.disconnect();
let refused = false;
try {
  await dropClient.upload('after-disconnect.bin', new Uint8Array(16));
} catch (cause) {
  refused = cause instanceof DriveAuthError;
}
check(refused, 'after disconnecting, Drive cannot be written to');

console.log('\n— missing file —');

const gone = new DriveClient(new FakeAuth(), new FakeDrive().http);
let notFound = false;
try {
  await gone.download('file-does-not-exist');
} catch (cause) {
  notFound = cause instanceof DriveError && cause.code === 'not-found';
}
check(notFound, 'a deleted backup reports not-found rather than returning nothing');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
