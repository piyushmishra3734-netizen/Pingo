/**
 * Wires RNNoise into a microphone stream.
 *
 * Returns a *new* `MediaStream` carrying the denoised audio, which is what goes
 * into the peer connection. The original stays open — closing it would stop the
 * microphone.
 *
 * ## This runs on top of the browser's suppression, not instead of it
 *
 * `getUserMedia` already applies echo cancellation and noise suppression. This
 * is a second, stronger pass for noisy environments, and it is off by default
 * because it costs a 112 KB WASM download plus per-frame CPU on every call.
 *
 * ## The WASM is compiled here, not in the worklet
 *
 * An AudioWorklet has no `fetch` and no dynamic `import`, so the module is
 * compiled on the main thread and handed over in `processorOptions` — a
 * `WebAssembly.Module` is structured-cloneable, which is what makes this work
 * at all.
 */

/*
 * `?url` asks Vite for the asset's served path rather than its contents — it
 * copies the 112 KB binary into the build and hands back a hashed URL. Resolved
 * through the package name so it does not depend on where pnpm put the file.
 */
import WASM_URL from '@jitsi/rnnoise-wasm/dist/rnnoise.wasm?url';

/** Vite serves the worklet as its own module graph entry; a bare URL is correct here. */
const PROCESSOR_URL = new URL('./rnnoise-processor.js', import.meta.url);

export interface RNNoiseResult {
  stream: MediaStream;
  /** Closes the audio graph. Does not stop the source microphone. */
  cleanup: () => void;
}

export async function applyRNNoise(source: MediaStream): Promise<RNNoiseResult> {
  /*
   * 48 kHz explicitly: RNNoise is trained at that rate and its 480-sample frame
   * *is* 10 ms only at 48 kHz. Letting the context pick the device default
   * would silently feed it the wrong thing on hardware that runs at 44.1.
   */
  const context = new AudioContext({ sampleRate: 48000 });

  const [wasmModule] = await Promise.all([
    WebAssembly.compileStreaming(fetch(WASM_URL)),
    context.audioWorklet.addModule(PROCESSOR_URL),
  ]);

  const input = context.createMediaStreamSource(source);
  const node = new AudioWorkletNode(context, 'rnnoise-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { wasmModule },
  });

  const destination = context.createMediaStreamDestination();
  input.connect(node);
  node.connect(destination);

  return {
    stream: destination.stream,
    cleanup: () => {
      node.disconnect();
      input.disconnect();
      void context.close();
    },
  };
}
