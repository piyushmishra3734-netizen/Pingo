/**
 * Looking at a picture somebody shared, so PINGO can answer about it.
 *
 * ## Why this is separate from `ai-chat`
 *
 * The chat model is text-only. Nemotron reads words; it has never seen an
 * image, and asking it about one produces a confident description of nothing -
 * which is a worse failure than saying no.
 *
 * So the picture is described here first, by a model that can actually see it,
 * and the description is what reaches the conversation. That has a property
 * worth keeping: the answer is grounded in a sentence somebody could check,
 * rather than in an image the answering model never had.
 *
 * ## Moondream over LLaVA
 *
 * Both are on Workers AI. Moondream is the newer of the two and is built for
 * exactly this - short, concrete answers about a single image - where LLaVA
 * tends toward paragraphs. A caption that becomes part of a chat prompt wants
 * to be a sentence, not an essay.
 *
 * ## Trust boundary
 *
 * The image arrives base64 from a browser and goes to the model. It is never
 * executed and never stored, and the size ceiling is the guard: a body large
 * enough to matter is refused before it costs anything.
 */

/** Overridable so a model change needs no deploy. */
const DEFAULT_MODEL = '@cf/moondream/moondream3.1-9B-A2B';

/**
 * Roughly a three-megabyte photo, as base64.
 *
 * Phone cameras produce more than this and the client downscales before
 * sending - a vision model gains nothing from twelve megapixels and the upload
 * is the slowest part of the whole exchange.
 */
const MAX_BASE64 = 4_500_000;

/**
 * What the model is asked, when the person asked nothing in particular.
 *
 * Deliberately plain. "Describe this image in detail" produces an inventory;
 * this produces the sentence a person would say if you showed them the photo.
 */
const DEFAULT_PROMPT =
  'Describe what is in this image in two or three plain sentences. ' +
  'Include any text that appears in it, exactly as written.';

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

  const body = (await request.json().catch(() => ({}))) as {
    image?: string;
    question?: string;
  };
  const image = body.image ?? '';

  if (!image) {
    return Response.json({ error: 'empty' }, { status: 400, headers: corsHeaders(request) });
  }
  if (image.length > MAX_BASE64) {
    return Response.json({ error: 'too-large' }, { status: 413, headers: corsHeaders(request) });
  }

  /*
   * The person's own question when they asked one, because "what does this say"
   * and "is this safe to eat" want very different sentences back, and the model
   * answers both better than a generic caption would.
   */
  const prompt = (body.question ?? '').trim().slice(0, 400) || DEFAULT_PROMPT;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${
      Deno.env.get('CF_VISION_MODEL') ?? DEFAULT_MODEL
    }`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, prompt }),
      signal: AbortSignal.timeout(45_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[vision] provider refused', response.status, detail.slice(0, 300));
    return Response.json(
      { error: 'provider', status: response.status },
      { status: 502, headers: corsHeaders(request) },
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    result?: { description?: string; response?: string; text?: string };
  };
  /*
   * Three names for the same field across these two models, and neither
   * documents which it uses. Reading all three is cheaper than finding out on a
   * model swap.
   */
  const described =
    payload.result?.description ?? payload.result?.response ?? payload.result?.text ?? '';

  return Response.json({ text: described.trim() }, { headers: corsHeaders(request) });
});
