/**
 * Turning a prompt into a picture, on Cloudflare Workers AI.
 *
 * ## Why not Hugging Face any more
 *
 * The first version called FLUX.1-dev through Hugging Face Inference Providers
 * and never drew anything, because there is no longer a free tier to draw it
 * with. Every route returns the same 402 - the provider ones, and HF's own
 * `hf-inference` too, whose one remaining text-to-image model answers with the
 * identical "you have depleted your monthly included credits". The credit pool
 * is shared, so there was nothing to route around.
 *
 * Workers AI has a free daily allocation - 10,000 Neurons, reset at 00:00 UTC -
 * and FLUX-1-schnell costs roughly 58 of them for a 1024x1024 image, which is
 * about 170 a day before anything is owed. Past that it is $0.011 per thousand
 * Neurons, or about 65 cents per thousand pictures. PINGO already runs on
 * Cloudflare, so this is the platform that was already there.
 *
 * schnell rather than dev is the trade: four steps instead of dozens, so it is
 * faster and slightly less detailed. In a chat bubble that is the right side of
 * the trade.
 *
 * ## The key never leaves here
 *
 * Same rule as the chat model: the browser asks this function, this function
 * holds the token. A token in a bundle is a token anybody can spend.
 */

/** Overridable so a model swap is configuration rather than a deploy. */
const DEFAULT_MODEL = '@cf/black-forest-labs/flux-1-schnell';

/**
 * schnell's own default, and its sweet spot.
 *
 * The model is distilled to need very few steps; the maximum it accepts is
 * eight and the extra four buy little beyond doubling the per-step cost, which
 * is the larger half of the bill.
 */
const DEFAULT_STEPS = 4;

/**
 * Generation is slow and a hung request is worse than a refusal.
 *
 * schnell lands in a few seconds. Sixty is the point past which somebody has
 * already decided nothing is coming, and the Edge Function has its own ceiling
 * anyway - better to fail with a sentence than to be killed mid-await with
 * none.
 */
const TIMEOUT_MS = 60_000;

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}

/** `atob` gives one character per byte; this is the byte array that implies. */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Draw it, or throw with something worth showing a person.
 *
 * Every failure here is one the caller turns into a sentence in the thread, so
 * the thrown messages are the vocabulary that sentence is chosen from rather
 * than free text for a log.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const account = Deno.env.get('CF_ACCOUNT_ID');
  const token = Deno.env.get('CF_AI_TOKEN');
  if (!account || !token) throw new Error('not-configured');

  const model = Deno.env.get('CF_IMAGE_MODEL') ?? DEFAULT_MODEL;
  const steps = Number(Deno.env.get('CF_IMAGE_STEPS') ?? DEFAULT_STEPS);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, steps }),
      /*
       * `AbortSignal.timeout` rather than a `Promise.race`: racing leaves the
       * request running and its response arriving into nothing, which on a
       * metered endpoint means paying for pictures nobody will ever see.
       */
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  /*
   * The daily allocation running out is not a broken prompt, and it is the
   * failure this will actually hit - so it is separated from every other
   * refusal before anything else is read.
   */
  if (response.status === 429) throw new Error('out-of-credits');
  if (response.status === 401 || response.status === 403) {
    throw new Error('bad-token');
  }

  /*
   * Two shapes, because the REST endpoint has two.
   *
   * Image models usually answer with the JSON envelope every Cloudflare API
   * uses, carrying base64 in `result.image`; some answer with the bytes
   * directly. Content type is what says which, and guessing wrong means a
   * picture that is actually a JSON error message.
   */
  const contentType = response.headers.get('Content-Type') ?? '';

  if (contentType.startsWith('image/')) {
    if (!response.ok) throw new Error(`http-${response.status}`);
    const type = contentType.split(';')[0]!.trim();
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: type,
      extension: type === 'image/png' ? 'png' : 'jpg',
    };
  }

  const payload = (await response.json()) as {
    success?: boolean;
    result?: { image?: string };
    errors?: { code?: number; message?: string }[];
  };

  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.map((e) => e.message).join('; ') ?? `http-${response.status}`;
    // Cloudflare reports an exhausted allocation in the body as often as in the
    // status, so the words are checked too rather than the code alone.
    if (/quota|limit|exceed|credit|neuron/i.test(detail)) throw new Error('out-of-credits');
    throw new Error(detail);
  }

  const base64 = payload.result?.image;
  if (!base64) throw new Error('empty-result');

  // schnell returns JPEG. Stated by the model's output schema rather than
  // sniffed, because there is no content type on a base64 string to sniff.
  return { bytes: fromBase64(base64), contentType: 'image/jpeg', extension: 'jpg' };
}
