/**
 * A Drive that behaves like Google's, for verification.
 *
 * Shared by the client and target suites so there is one description of the
 * protocol rather than two that can drift. It implements the parts that matter
 * and can be told to misbehave in the specific ways that break real backups:
 * a dead token, a connection cut mid-chunk, a file that has gone.
 *
 * What it is not is evidence about Google. It encodes what the documentation
 * says Google does; confirming that is an integration test against a real
 * Cloud project.
 */
import type { DriveAuth, DriveToken } from '../src/lib/backup/drive/auth.js';

export class FakeDrive {
  files = new Map<string, { id: string; name: string; bytes: Uint8Array }>();
  sessions = new Map<string, { name: string; size: number; received: Uint8Array }>();
  validToken = 'good-token';
  /** Drop the connection after this many bytes of a single PUT, once. */
  cutAfter: number | undefined;
  /** Fail every upload attempt from now on, to simulate dying mid-backup. */
  failUploads = false;
  requests = 0;
  nextId = 1;

  names(): string[] {
    return [...this.files.values()].map((f) => f.name).sort();
  }

  http = async (url: string, init: RequestInit = {}): Promise<Response> => {
    this.requests += 1;
    const method = init.method ?? 'GET';
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    const isSession = url.startsWith('session:');

    if (!isSession && auth !== `Bearer ${this.validToken}`) {
      return new Response('{}', { status: 401 });
    }

    if (method === 'POST' && url.includes('uploadType=resumable')) {
      if (this.failUploads) return new Response('{}', { status: 503 });
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
        /*
         * Same name replaces, which is what upload-then-delete relies on. Real
         * Drive would allow duplicates; the client always deletes the previous
         * file by id, so the observable behaviour matches.
         */
        for (const [existingId, file] of this.files) {
          if (file.name === session.name) this.files.delete(existingId);
        }
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
      return new Response(null, { status: 204 });
    }

    return new Response('{}', { status: 400 });
  };
}

export class FakeAuth implements DriveAuth {
  token: DriveToken | undefined = { accessToken: 'good-token', expiresAt: Date.now() + 3_600_000 };
  silentCalls = 0;
  canRefresh = true;

  async authorize(): Promise<DriveToken> {
    this.canRefresh = true;
    this.token = { accessToken: 'good-token', expiresAt: Date.now() + 3_600_000 };
    return this.token;
  }
  async silent(): Promise<DriveToken | undefined> {
    this.silentCalls += 1;
    return this.canRefresh ? this.token : undefined;
  }
  async disconnect(): Promise<void> {
    this.token = undefined;
    this.canRefresh = false;
  }
}
