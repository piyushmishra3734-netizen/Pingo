/**
 * Turning a prompt into a picture, and the picture into a message.
 *
 * ## Why the SDK and not a fetch
 *
 * Hugging Face's Inference Providers route a model to whichever provider is
 * serving it, and the request shape is the provider's, not Hugging Face's -
 * wavespeed's is not replicate's is not fal's. `@huggingface/inference` is what
 * knows the mapping. Writing the URL by hand means owning that table and
 * finding out it changed when somebody's picture fails to arrive.
 *
 * ## The key never leaves here
 *
 * Same rule as the chat model: the browser asks this function, this function
 * holds `HF_TOKEN`. A token in a bundle is a token anybody can spend.
 */

import { InferenceClient } from 'https://esm.sh/@huggingface/inference@4.13.27';

/** The model the request names. Overridable so a swap needs no deploy. */
const DEFAULT_MODEL = 'black-forest-labs/FLUX.1-dev';

/**
 * Which provider serves it.
 *
 * Named explicitly rather than left to auto-routing: this is the one that was
 * measured, and a silent switch to a slower provider reads to a user as PINGO
 * getting worse for no reason.
 */
const DEFAULT_PROVIDER = 'wavespeed';

/**
 * Generation is slow and a hung request is worse than a refusal.
 *
 * FLUX on wavespeed lands inside ten seconds in the ordinary case. Sixty is
 * the point past which somebody has already decided nothing is coming, and the
 * Edge Function has its own ceiling anyway - better to fail with a sentence
 * than to be killed mid-await with none.
 */
const TIMEOUT_MS = 60_000;

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}

/** What the bucket will accept, mapped to what to call the object. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Draw it, or throw with something worth showing a person.
 *
 * Every failure here is one the caller turns into a sentence in the thread, so
 * the messages are written to be read by whoever asked rather than by whoever
 * is reading the logs.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const token = Deno.env.get('HF_TOKEN');
  if (!token) throw new Error('not-configured');

  const client = new InferenceClient(token);

  /*
   * `AbortSignal.timeout` rather than a `Promise.race`: racing leaves the
   * request running and its response arriving into nothing, which on a paid
   * provider means paying for pictures nobody will ever see.
   */
  const blob = await client.textToImage(
    {
      provider: (Deno.env.get('HF_IMAGE_PROVIDER') ?? DEFAULT_PROVIDER) as never,
      model: Deno.env.get('HF_IMAGE_MODEL') ?? DEFAULT_MODEL,
      inputs: prompt,
    },
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );

  const contentType = blob.type || 'image/png';
  const extension = EXTENSIONS[contentType];
  if (!extension) throw new Error(`unsupported-type:${contentType}`);

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    contentType,
    extension,
  };
}
