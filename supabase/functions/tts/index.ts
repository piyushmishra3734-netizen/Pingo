/**
 * The assistant's voice.
 *
 * ## Why Sarvam Bulbul
 *
 * PINGO speaks Hindi and Hinglish and nothing else, so the only question worth
 * asking about a voice is how it handles those two. Bulbul is built for exactly
 * that pair: a Hinglish sentence is synthesised in one pass, with no pause at
 * the language boundary and no shift in accent or voice quality across it -
 * which is the specific thing every general-purpose engine gets wrong, because
 * they switch phonetic models mid-sentence and you can hear the seam.
 *
 * The evidence is a third-party blind A/B study run by Josh Talks: 11 languages,
 * 500+ annotators, 20,000+ votes, against ElevenLabs v3 alpha, v2.5 flash and
 * Cartesia Sonic-3. Bulbul ranked highest at 8 kHz telephony grade - real-world
 * listening - with fewer skipped words and mispronunciations. Sarvam themselves
 * report that ElevenLabs led in full-band studio quality, which is the reason to
 * trust the rest of it, and is also not the condition a chat reply is heard in.
 *
 * ## What it replaces
 *
 * Deepgram Aura, which is English-only. It answered Devanagari with a silent
 * 1296-byte MP3 - worse than an error, because it looks like success - so half
 * of what PINGO said could not be spoken at all. Aura stays as the fallback for
 * as long as there is no Sarvam key, because a degraded voice beats none.
 *
 * ## The key stays here
 *
 * Same rule as the chat model and the image model. A browser that could call
 * Sarvam directly is a browser holding a credential anybody can spend.
 */

/** One request, one voice line. 2500 is the v3 ceiling; this is a sentence. */
const MAX_CHARS = 1200;

/**
 * The default speaker.
 *
 * Overridable without a deploy because a voice is a matter of taste and this
 * one was chosen from a list rather than by listening to all thirty.
 */
const DEFAULT_SPEAKER = 'shubh';

/** Aura, for as long as there is no Sarvam key. English only. */
const FALLBACK_MODEL = '@cf/deepgram/aura-2-en';

/**
 * Below this an MP3 carries no speech.
 *
 * Aura answers text it cannot pronounce with a valid, empty file - 1296 bytes
 * for a full Devanagari sentence against 18 kB for Latin. Length is the only
 * signal it gives, and Sarvam is checked the same way rather than trusted.
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

function audio(bytes: Uint8Array, request: Request): Response {
  return new Response(bytes, {
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'audio/mpeg',
      // The same sentence spoken twice is the same sound.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

/** Base64 to bytes. `atob` gives one character per byte. */
function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Speak it with Bulbul, or return undefined so the caller can fall back.
 *
 * Undefined rather than throwing: a missing key and a bad day at the provider
 * lead to the same place, which is the older voice.
 */
async function speakWithSarvam(text: string): Promise<Uint8Array | undefined> {
  const key = Deno.env.get('SARVAM_API_KEY');
  if (!key) return undefined;

  /*
   * `hi-IN` for both scripts, deliberately.
   *
   * PINGO writes Hinglish in Latin letters, and that is Hindi with English
   * words in it - not English. Asking for `en-IN` would get an English voice
   * reading Hindi words, which is the seam this engine was chosen to avoid.
   * `enable_preprocessing` is what normalises the mixed script before
   * synthesis.
   */
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      language_code: 'hi-IN',
      model: Deno.env.get('SARVAM_TTS_MODEL') ?? 'bulbul:v3',
      speaker: Deno.env.get('SARVAM_TTS_SPEAKER') ?? DEFAULT_SPEAKER,
      output_audio_codec: 'mp3',
      enable_preprocessing: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[tts] sarvam refused', response.status, detail.slice(0, 300));
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as { audios?: string[] };
  const first = payload.audios?.[0];
  if (!first) {
    console.error('[tts] sarvam returned no audio');
    return undefined;
  }
  return decode(first);
}

/** Aura, English only, for as long as there is no Sarvam key. */
async function speakWithAura(text: string): Promise<Uint8Array | undefined> {
  const account = Deno.env.get('CF_ACCOUNT_ID');
  const token = Deno.env.get('CF_AI_TOKEN');
  if (!account || !token) return undefined;

  // It cannot read Devanagari at all, so it is not asked to.
  if (/[ऀ-ॿ]/.test(text)) return undefined;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${
      Deno.env.get('CF_TTS_MODEL') ?? FALLBACK_MODEL
    }`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (!response.ok) {
    console.error('[tts] aura refused', response.status);
    return undefined;
  }
  return new Uint8Array(await response.arrayBuffer());
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? '').trim().slice(0, MAX_CHARS);
  if (!text) {
    return Response.json({ error: 'empty' }, { status: 400, headers: corsHeaders(request) });
  }

  const spoken = (await speakWithSarvam(text)) ?? (await speakWithAura(text));

  if (!spoken) {
    /*
     * Nothing could say it. The client falls back to the device's own voices,
     * which is the only remaining route and the only one that might have a
     * Hindi voice installed.
     */
    return Response.json(
      { error: 'no-voice' },
      { status: 503, headers: corsHeaders(request) },
    );
  }

  if (spoken.byteLength < SILENT_BYTES) {
    console.warn('[tts] provider returned silence', spoken.byteLength, 'bytes');
    return Response.json({ error: 'silent' }, { status: 415, headers: corsHeaders(request) });
  }

  return audio(spoken, request);
});
