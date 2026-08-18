/**
 * Speech for the assistant's replies, from the server.
 *
 * ## Why not the browser
 *
 * `speechSynthesis` reads with whatever voices the device happens to have, and
 * that is not a thing an app can rely on. Measured on a stock Windows install:
 * 24 voices, not one of them Hindi. An English voice handed `कोई बात नहीं` does
 * not fail - it produces silence - so the button lit up and nothing came out.
 *
 * ## Why Deepgram Aura and not NVIDIA Magpie
 *
 * Magpie was the plan: multilingual, and on the same endpoint as PINGO's chat
 * model. It is not. `integrate.api.nvidia.com` lists 102 models to this key and
 * the only speech-adjacent ones are `riva-translate`, which translates text.
 * `/v1/audio/speech` there answers 404. NVIDIA's speech NIMs are a separate
 * subscription, and the voice-agent blueprint that bundles them wants 72 GB of
 * VRAM and WebRTC.
 *
 * Workers AI has speech, PINGO already holds a Cloudflare token for image
 * generation, and Aura is the part of it that works: `aura-2-en` returns real
 * audio, `melotts` returned a 500 for English and an empty file for Hindi.
 *
 * ## What this cannot do
 *
 * Devanagari. Aura is English-only and answers Devanagari with a 1296-byte
 * silent MP3, which is worse than an error because it looks like success. That
 * is detected here and refused honestly, and the client falls back to the
 * browser - which may have a Hindi voice even when this does not.
 *
 * ## One sentence per request, on purpose
 *
 * The client sends a sentence at a time and plays each as it arrives, so
 * speaking starts as soon as the first sentence is ready rather than after the
 * whole reply. Synthesising it all in one request would be fewer round trips
 * and a longer silence, and the silence is the thing being fixed.
 */

/** Overridable so a model change needs no deploy. */
const DEFAULT_MODEL = '@cf/deepgram/aura-2-en';

/** Longer than this is not a sentence, it is a paragraph somebody pasted. */
const MAX_CHARS = 600;

/**
 * Below this an MP3 carries no speech.
 *
 * Aura answers text it cannot pronounce with a valid, empty file - measured at
 * 1296 bytes for a full Devanagari sentence, against 18 kB for the same
 * sentence in Latin script. Length is the only signal it gives.
 */
const SILENT_BYTES = 4000;

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }

  const account = Deno.env.get('CF_ACCOUNT_ID');
  const token = Deno.env.get('CF_AI_TOKEN');
  if (!account || !token) {
    return Response.json(
      { error: 'not-configured' },
      { status: 503, headers: corsHeaders(request) },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? '').trim().slice(0, MAX_CHARS);
  if (!text) {
    return Response.json({ error: 'empty' }, { status: 400, headers: corsHeaders(request) });
  }

  /*
   * Refused before the request rather than after it.
   *
   * Aura would return a silent file and bill for it. Saying so here lets the
   * client fall back to the device's own voices, which is the only route to
   * Devanagari speech that exists today.
   */
  if (/[ऀ-ॿ]/.test(text)) {
    return Response.json(
      { error: 'unsupported-script' },
      { status: 415, headers: corsHeaders(request) },
    );
  }

  const model = Deno.env.get('CF_TTS_MODEL') ?? DEFAULT_MODEL;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[tts] provider refused', response.status, detail.slice(0, 300));
    return Response.json(
      { error: 'provider', status: response.status },
      { status: 502, headers: corsHeaders(request) },
    );
  }

  /*
   * Buffered rather than streamed, only so the empty-file check can happen.
   * A sentence of speech is tens of kilobytes; the client is already playing
   * the previous one while this arrives.
   */
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength < SILENT_BYTES) {
    console.warn('[tts] provider returned silence', audio.byteLength, 'bytes');
    return Response.json(
      { error: 'silent' },
      { status: 415, headers: corsHeaders(request) },
    );
  }

  return new Response(audio, {
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'audio/mpeg',
      // The same sentence spoken twice is the same sound.
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
