import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * A socket between the browser and Sarvam's realtime transcriber.
 *
 * ## Why a relay rather than a direct connection
 *
 * Sarvam accepts a browser connection by putting the key in a WebSocket
 * subprotocol. That works, and it means shipping the credential to every device
 * that opens a call - anybody could read it out of the network tab and spend it.
 * Same rule as every other provider here: the key lives on the server.
 *
 * So this sits in the middle and copies frames. It reads nothing, decides
 * nothing and stores nothing; it is a pipe with a credential attached to one end.
 *
 * ## Why streaming at all
 *
 * The batch endpoint cannot start until somebody stops talking, so the wait is
 * the whole utterance plus the transcription plus the model plus the voice.
 * Streaming moves the transcription *underneath* the talking: partial results
 * arrive while the sentence is still being said, and the moment they stop the
 * text is already there.
 *
 * It is also cheaper for what it does. Billing is per minute of audio rather
 * than per request, which is the opposite of the batch path where every turn -
 * and, before this week, every sentence of a reply - was its own charge.
 *
 * ## Auth, given a browser cannot set headers on a WebSocket
 *
 * The JWT arrives as a query parameter and is verified here before Sarvam is
 * dialled at all. `verify_jwt` is off on this function for exactly that reason:
 * the platform's check reads a header that a browser WebSocket cannot send, so
 * the check has to happen in code rather than in front of it.
 */

/** Everything the client is allowed to influence, and nothing else. */
const PASSTHROUGH = new Set([
  'language_code',
  'mode',
  'stream_type',
  'endpointing',
  'silence_duration_ms',
  'threshold',
  'prompt',
]);

/**
 * Latin script, matching the replies.
 *
 * `translit` is what makes "Haan bhai, sab badhiya hai" come back as itself
 * rather than in Devanagari. Both halves of a conversation in different
 * alphabets would be its own bug - see the batch function's note.
 */
const DEFAULTS: Record<string, string> = {
  language_code: 'hi-IN',
  model: 'saaras:v3-realtime',
  mode: 'translit',
  encoding: 'linear16',
  sample_rate: '16000',
  endpointing: 'vad',
  /*
   * Half a second of quiet ends a turn.
   *
   * Sarvam's own default, and it is the number this replaces a hand-rolled
   * 1100 ms level check with - server-side VAD hears the difference between a
   * pause for breath and the end of a thought, which an amplitude threshold
   * cannot.
   */
  silence_duration_ms: '500',
};

Deno.serve(async (request) => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected a websocket', { status: 426 });
  }

  const url = new URL(request.url);
  const jwt = url.searchParams.get('jwt') ?? '';
  if (!jwt) return new Response('unauthorised', { status: 401 });

  const key = Deno.env.get('SARVAM_API_KEY');
  if (!key) return new Response('not configured', { status: 503 });

  /*
   * Checked before Sarvam is dialled, so an unauthenticated socket never costs
   * a connection - and never gets one to hold open.
   */
  const auth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return new Response('unauthorised', { status: 401 });

  const upstreamUrl = new URL('wss://api.sarvam.ai/speech-to-text-realtime/ws');
  for (const [name, value] of Object.entries(DEFAULTS)) {
    upstreamUrl.searchParams.set(name, value);
  }
  for (const [name, value] of url.searchParams) {
    if (PASSTHROUGH.has(name)) upstreamUrl.searchParams.set(name, value);
  }

  const { socket: client, response } = Deno.upgradeWebSocket(request);

  /*
   * The key goes in the subprotocol here, where it is a server talking to a
   * server. It is the same mechanism the browser would have used, and the
   * difference - the only difference that matters - is who holds it.
   */
  const upstream = new WebSocket(upstreamUrl, [`api-subscription-key.${key}`]);

  /*
   * Frames that arrive before the far end is ready.
   *
   * A browser starts sending audio the instant its own socket opens, and the
   * upstream handshake takes a moment longer. Dropping those frames loses the
   * first word of every call, which is the word people repeat.
   */
  const waiting: (string | ArrayBufferLike | Blob)[] = [];
  let ready = false;

  const closeBoth = () => {
    try { client.close(); } catch { /* already gone */ }
    try { upstream.close(); } catch { /* already gone */ }
  };

  upstream.onopen = () => {
    ready = true;
    for (const frame of waiting.splice(0)) upstream.send(frame as string);
  };
  upstream.onmessage = (event) => {
    if (client.readyState === WebSocket.OPEN) client.send(event.data);
  };
  upstream.onerror = () => {
    // The provider's own error frames already reach the client; this is the
    // transport failing, which it cannot report on itself.
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'error', code: 'upstream', is_fatal: true }));
    }
    closeBoth();
  };
  upstream.onclose = closeBoth;

  client.onmessage = (event) => {
    if (!ready) {
      waiting.push(event.data);
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(event.data);
  };
  client.onclose = closeBoth;
  client.onerror = closeBoth;

  return response;
});
