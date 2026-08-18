/**
 * A voice that lives on the device.
 *
 * ## What this is for
 *
 * The server voice cannot read Devanagari. Deepgram Aura is English-only and
 * answers Hindi with a silent MP3, so those replies fall back to whatever the
 * device has - and a stock Windows install has 24 voices and no Hindi at all.
 *
 * Kokoro has four Hindi voices and runs entirely here: no request per sentence,
 * no bill, and it keeps working with the network off. What it costs is 88 MB,
 * once, which is why nothing below happens until somebody asks for it.
 *
 * ## Downloaded, never bundled
 *
 * `kokoro-js` pulls in `@huggingface/transformers` and an ONNX runtime. All of
 * it is behind a dynamic import so that a person who never turns this on never
 * pays a byte for it - not in the bundle, not in the download, not in parse
 * time on a mid-range phone.
 *
 * The weights come from Hugging Face's CDN. That is a download host and not the
 * inference API that PINGO stopped using - there is no key, no request per
 * sentence and no bill - but it is worth being exact about: this is not "no
 * Hugging Face", it is "no Hugging Face at runtime".
 *
 * ## q8
 *
 * 88 MB against 310 for fp32 and 156 for fp16, measured from the CDN's own
 * headers. On a phone the smaller file is the whole difference between a
 * feature people turn on and one they abandon halfway through the download.
 */

/** The ONNX build of Kokoro-82M, and the voices that ship beside it. */
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * Which voice reads what.
 *
 * Chosen by script rather than by setting, for the same reason the server
 * function chooses that way: a reply is whichever language the model wrote it
 * in, and that changes between messages in one thread.
 */
const HINDI_VOICE = 'hf_alpha';
const LATIN_VOICE = 'af_bella';

/** Loaded once per page, because 88 MB is not something to do twice. */
let engine: Promise<KokoroEngine> | undefined;

interface KokoroEngine {
  generate: (text: string, options: { voice: string }) => Promise<{ toBlob: () => Blob }>;
}

/** How far the download has got, 0-1, or undefined when it has not started. */
export type DownloadProgress = (fraction: number) => void;

/**
 * True once the weights are in the browser's cache and speaking costs nothing.
 *
 * Asked before offering the download, so somebody who already has it is never
 * shown an 88 MB warning about a file they are not going to fetch.
 */
export async function kokoroReady(): Promise<boolean> {
  if (engine) return true;
  try {
    /*
     * `transformers.js` stores weights in a Cache Storage bucket of its own.
     * Reading the cache is the only way to answer this without loading the
     * model, and loading the model is the thing being asked about.
     */
    const cache = await caches.open('transformers-cache');
    const held = await cache.keys();
    return held.some((request) => request.url.includes('Kokoro-82M') && request.url.endsWith('.onnx'));
  } catch {
    return false;
  }
}

/**
 * Fetch the model if it is not here, and keep it.
 *
 * `onProgress` is reported because 88 MB with no indication of movement is a
 * download people cancel. The fraction covers the weights only; the voice files
 * are half a megabyte each and arrive in the noise.
 */
export async function loadKokoro(onProgress?: DownloadProgress): Promise<void> {
  engine ??= (async () => {
    const { KokoroTTS } = await import('kokoro-js');
    const tts = await KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8',
      /*
       * WASM rather than WebGPU. WebGPU is faster where it exists and is absent
       * or broken on a good deal of the Android this app runs on, and a voice
       * that works everywhere slowly beats one that works sometimes quickly.
       */
      device: 'wasm',
      progress_callback: (event: { status?: string; progress?: number }) => {
        if (event.status === 'progress' && typeof event.progress === 'number') {
          onProgress?.(Math.min(1, event.progress / 100));
        }
      },
    });
    return tts as unknown as KokoroEngine;
  })();

  try {
    await engine;
  } catch (cause) {
    // A failed load must not poison the next attempt - a dropped connection is
    // the ordinary reason and retrying is the ordinary answer.
    engine = undefined;
    throw cause;
  }
}

/**
 * Speak one sentence here, or return undefined if there is no engine to do it.
 *
 * ## Downloading and loading are different questions
 *
 * The download is a decision somebody makes once, in a dialog. Loading weights
 * that are already on the device is not a decision at all - it is free, it is
 * offline, and it is what they agreed to when they fetched them.
 *
 * Keeping those the same thing was a bug: `engine` is a module variable, so a
 * reload cleared it, and somebody who had already downloaded 88 MB got silence
 * again on the next visit. The cache is asked instead, and a hit loads without
 * a word - only a miss means the file is not here and nothing can be said.
 */
export async function speakWithKokoro(text: string): Promise<Blob | undefined> {
  if (!engine && (await kokoroReady())) {
    // From cache, so no bytes and no dialog - just the seconds it takes to
    // hand 88 MB to the WASM runtime.
    await loadKokoro().catch(() => undefined);
  }
  if (!engine) return undefined;
  try {
    const tts = await engine;
    const voice = /[ऀ-ॿ]/.test(text) ? HINDI_VOICE : LATIN_VOICE;
    const audio = await tts.generate(text, { voice });
    return audio.toBlob();
  } catch {
    // One sentence failing is not worth stopping the reply for; the caller
    // falls through to the routes behind this one.
    return undefined;
  }
}
