/**
 * PINGO's download endpoint.
 *
 * ## Why a Worker rather than a public bucket
 *
 * An R2 bucket can be exposed directly, and that would hand out a URL nobody
 * would want to type and no control over how the file arrives. This gives a
 * branded address, forces the download rather than letting a browser guess, and
 * keeps the storage private — the bucket is reachable only through this.
 *
 * ## One filename, forever
 *
 * The Worker always serves the object named `PINGO.apk`. Publishing a new
 * version is `wrangler r2 object put` and nothing else: no deploy, no edit to
 * the website, no link to update. A versioned filename would move the URL every
 * release and break whatever was pointing at it — which is exactly how the
 * previous channel broke.
 */

interface Env {
  APKS: R2Bucket;
}

/** The single object this endpoint is about. */
const KEY = 'PINGO.apk';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Anything that is not the Android download is not this Worker's business.
    if (url.pathname !== '/android' && url.pathname !== '/') {
      return new Response('Not found', { status: 404 });
    }

    /*
     * HEAD is answered without reading the body.
     *
     * Download managers and link previewers ask for the size before committing
     * to the transfer, and streaming twenty-four megabytes to answer a question
     * about its length is waste that shows up as a slow first byte.
     */
    if (request.method === 'HEAD') {
      const head = await env.APKS.head(KEY);
      if (!head) return new Response('Not found', { status: 404 });
      return new Response(null, { status: 200, headers: headersFor(head) });
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    /*
     * Range requests are honoured, and only when actually made.
     *
     * A dropped connection on a mobile network is normal, and without range
     * support a resumed download restarts from zero — on 24 MB over a poor
     * signal that can mean it never finishes.
     *
     * Handing R2 the whole header set unconditionally made it answer every
     * plain GET with a 206 and a Content-Range, which is a lie — nobody
     * requested a partial response. Android's download manager is entitled to
     * reject that, and a downloader that refuses the file outright is a worse
     * failure than one that cannot resume.
     */
    const wantsRange = request.headers.has('range');
    const object = await env.APKS.get(KEY, {
      ...(wantsRange ? { range: request.headers } : {}),
      onlyIf: request.headers,
    });

    if (!object) {
      return new Response('No build has been published yet.', { status: 404 });
    }

    // `body` is absent when `onlyIf` matched — the client already has it.
    if (!('body' in object) || !object.body) {
      return new Response(null, { status: 304, headers: headersFor(object) });
    }

    return new Response(object.body, {
      // Driven by what the client asked for, not by what R2 reports: R2 sets
      // a range on the object even for a whole-file read, so trusting it made
      // every plain download a 206.
      status: wantsRange ? 206 : 200,
      headers: headersFor(object),
    });
  },
};

function headersFor(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);

  headers.set('etag', object.httpEtag);
  headers.set('content-type', 'application/vnd.android.package-archive');

  /*
   * `attachment` is what makes the phone download instead of trying to render
   * it, and the filename is what it lands in the downloads folder as.
   */
  headers.set('content-disposition', `attachment; filename="PINGO.apk"`);

  // Resumable downloads need the server to say it supports them.
  headers.set('accept-ranges', 'bytes');

  /*
   * Five minutes, not a year.
   *
   * The URL is stable and the file behind it changes, which is the opposite of
   * what long caching assumes. Short enough that a new release reaches people
   * quickly; long enough that a retry does not re-fetch from origin.
   */
  headers.set('cache-control', 'public, max-age=300');

  /*
   * The download page asks for the size with a cross-origin HEAD, so the
   * browser needs permission to read the response at all -- and Content-Length
   * is not exposed by default even when it is present on the wire.
   */
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-expose-headers', 'content-length, content-disposition');

  return headers;
}
