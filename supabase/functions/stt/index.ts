/**
 * Hearing what somebody said, for talking to PINGO out loud.
 *
 * ## Why Sarvam and not Whisper
 *
 * Measured on the same clip, through the deployed function:
 *
 *   said       Haan bhai, sab badhiya hai. Tum sunao kya chal raha hai?
 *   Whisper    kal shaam ko milte hain, coffee kei lai        (and worse without a hint)
 *   Sarvam     Haan bhai, sab badhiya hai. Tum sunao kya chal raha hai?
 *
 * Character for character, punctuation included. Whisper is excellent at
 * English - "Let us meet tomorrow evening for coffee" came back exactly - and
 * the half of the vocabulary that is Hindi written in Latin letters is where it
 * fell apart, which is most of what people say here.
 *
 * ## `translit`, specifically
 *
 * Saaras has several modes. `transcribe` returns Devanagari, `codemix` returns
 * Hindi words in Devanagari and English words in Latin, and `translit` returns
 * the whole thing in Latin letters. The last is what PINGO wants, and not by
 * preference: replies are written in Latin script, so a transcript in
 * Devanagari would put both halves of the same conversation in different
 * alphabets.
 *
 * ## The client still sends base64
 *
 * Sarvam takes multipart. Converting here rather than changing the client keeps
 * one contract for the browser and one place that knows what the provider
 * wants - which is the point of a proxy.
 */

/** About a minute of speech as base64. A turn is seconds; past this is a mistake. */
const MAX_BASE64 = 2_000_000;

function corsHeaders(request: Request): HeadersInit {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
    'Access-Control-Allow-Headers':
      request.headers.get('Access-Control-Request-Headers') ??
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

/** Base64 to bytes. `atob` gives one character per byte. */
function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }

  const key = Deno.env.get('SARVAM_API_KEY');
  if (!key) {
    return Response.json(
      { error: 'not-configured' },
      { status: 503, headers: corsHeaders(request) },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { audio?: string };
  const audio = body.audio ?? '';

  if (!audio) {
    return Response.json({ error: 'empty' }, { status: 400, headers: corsHeaders(request) });
  }
  if (audio.length > MAX_BASE64) {
    return Response.json({ error: 'too-long' }, { status: 413, headers: corsHeaders(request) });
  }

  /*
   * `webm` because that is what `MediaRecorder` produces in every browser this
   * runs in, and Saaras accepts it. The name matters only as a hint to the
   * decoder; the bytes decide.
   */
  const form = new FormData();
  form.append('file', new Blob([decode(audio)], { type: 'audio/webm' }), 'turn.webm');
  form.append('model', Deno.env.get('SARVAM_STT_MODEL') ?? 'saaras:v3');
  form.append('language_code', 'hi-IN');
  form.append('mode', 'translit');

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': key },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[stt] provider refused', response.status, detail.slice(0, 300));
    return Response.json(
      { error: 'provider', status: response.status },
      { status: 502, headers: corsHeaders(request) },
    );
  }

  const payload = (await response.json().catch(() => ({}))) as { transcript?: string };
  const text = (payload.transcript ?? '').trim();

  /*
   * Silence transcribes to nothing, and nothing is a real answer here - the
   * caller keeps listening rather than sending an empty turn to the model.
   */
  return Response.json({ text }, { headers: corsHeaders(request) });
});
