/**
 * Turning what somebody said into text, for talking to PINGO out loud.
 *
 * The mirror of `tts`, and the same reasoning: the credential stays on the
 * server, Workers AI is where the model is, and PINGO already holds a token for
 * it.
 *
 * ## Whisper rather than Nova
 *
 * Both were measured on the same clip. Neither is good at Hinglish and Whisper
 * is the less bad of them - it keeps word order where Nova drops words - and it
 * is the one that improves when a language hint is given rather than ignoring
 * it.
 *
 * The measurement understates both. The test clip was made by an English TTS
 * voice pronouncing Hinglish, which is harder to hear than a person saying the
 * same thing, because "badhiya" spoken with English phonetics really does sound
 * like "badia". Real speech should land better; that is a hope, not a claim.
 *
 * ## Trust boundary
 *
 * Audio arrives base64 from a browser and is passed to the model. It is never
 * executed, never stored, and the size ceiling is the guard - a body big enough
 * to matter is refused before it costs anything.
 */

/** Overridable so a model change needs no deploy. */
const DEFAULT_MODEL = '@cf/openai/whisper-large-v3-turbo';

/**
 * About a minute of speech as base64.
 *
 * A turn in a conversation is seconds. Anything past this is not somebody
 * talking, and paying to transcribe it would be paying for a mistake.
 */
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

  const body = (await request.json().catch(() => ({}))) as { audio?: string };
  const audio = body.audio ?? '';

  if (!audio) {
    return Response.json({ error: 'empty' }, { status: 400, headers: corsHeaders(request) });
  }
  if (audio.length > MAX_BASE64) {
    return Response.json({ error: 'too-long' }, { status: 413, headers: corsHeaders(request) });
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${
      Deno.env.get('CF_STT_MODEL') ?? DEFAULT_MODEL
    }`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[stt] provider refused', response.status, detail.slice(0, 300));
    return Response.json(
      { error: 'provider', status: response.status },
      { status: 502, headers: corsHeaders(request) },
    );
  }

  const payload = (await response.json().catch(() => ({}))) as { result?: { text?: string } };
  const text = (payload.result?.text ?? '').trim();

  /*
   * Silence transcribes to nothing, and nothing is a real answer here - the
   * caller keeps listening rather than sending an empty turn to the model.
   */
  return Response.json({ text }, { headers: corsHeaders(request) });
});
