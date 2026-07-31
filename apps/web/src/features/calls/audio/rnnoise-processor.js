/**
 * RNNoise, as an AudioWorkletProcessor.
 *
 * RNNoise (xiph, BSD-3-Clause) compiled to WebAssembly by Jitsi
 * (jitsi/rnnoise-wasm, Apache-2.0). This file is the worklet that drives it.
 *
 * ## Why a ring buffer
 *
 * The two sides disagree about frame size and neither can be changed:
 *
 *   - An AudioWorklet is handed **128 samples** per `process()` call.
 *   - RNNoise consumes exactly **480 samples** (10 ms at 48 kHz) per frame.
 *
 * 480 is not a multiple of 128, so samples are accumulated on the way in and
 * released on the way out. That costs one frame of latency - 10 ms, inaudible  - 
 * and is the only correct way to bridge the two.
 *
 * ## Scaling
 *
 * Web Audio works in floats from -1 to 1; RNNoise expects the int16 *range* as
 * floats, -32768 to 32767. Skipping the scale does not fail loudly - it
 * produces audio that is technically processed and audibly untouched, which is
 * the worst kind of bug.
 *
 * ## Loading
 *
 * The WASM is instantiated from bytes passed in `processorOptions`. An
 * AudioWorklet has no `fetch` and no dynamic `import`, so the main thread must
 * hand it the compiled module - see `rnnoise.ts`.
 */

const FRAME_SIZE = 480;
const INT16_SCALE = 32768;

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.ready = false;
    this.inputBuffer = new Float32Array(FRAME_SIZE);
    this.outputBuffer = new Float32Array(FRAME_SIZE);
    this.filled = 0;
    this.available = 0;
    this.readIndex = 0;

    const { wasmModule } = options.processorOptions ?? {};
    if (wasmModule) this.#init(wasmModule);
  }

  #init(wasmModule) {
    try {
      // Emscripten's minimal import surface. RNNoise itself is pure
      // computation - no syscalls - so an empty env plus memory is enough.
      const memory = new WebAssembly.Memory({ initial: 256, maximum: 1024 });
      const instance = new WebAssembly.Instance(wasmModule, {
        env: {
          memory,
          emscripten_notify_memory_growth: () => {},
          abort: () => {},
        },
        wasi_snapshot_preview1: {
          proc_exit: () => {},
          fd_close: () => 0,
          fd_seek: () => 0,
          fd_write: () => 0,
        },
      });

      this.exports = instance.exports;
      this.memory = this.exports.memory ?? memory;

      this.state = this.exports.rnnoise_create
        ? this.exports.rnnoise_create(0)
        : this.exports._rnnoise_create(0);

      // Two scratch buffers inside the WASM heap, one frame each.
      const malloc = this.exports.malloc ?? this.exports._malloc;
      this.inPtr = malloc(FRAME_SIZE * 4);
      this.outPtr = malloc(FRAME_SIZE * 4);

      this.processFrame = this.exports.rnnoise_process_frame ?? this.exports._rnnoise_process_frame;
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      // Reported, not thrown: a worklet that throws in its constructor takes
      // the whole audio graph down and the call with it.
      this.port.postMessage({ type: 'error', message: String(error) });
    }
  }

  #denoise() {
    const heap = new Float32Array(this.memory.buffer, this.inPtr, FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) heap[i] = this.inputBuffer[i] * INT16_SCALE;

    this.processFrame(this.state, this.outPtr, this.inPtr);

    const out = new Float32Array(this.memory.buffer, this.outPtr, FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) this.outputBuffer[i] = out[i] / INT16_SCALE;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    // Not ready yet: pass audio through untouched rather than emitting silence.
    if (!this.ready) {
      output.set(input);
      return true;
    }

    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.filled++] = input[i];

      if (this.filled === FRAME_SIZE) {
        this.#denoise();
        this.filled = 0;
        this.available = FRAME_SIZE;
        this.readIndex = 0;
      }

      output[i] = this.available > 0 ? this.outputBuffer[this.readIndex++] : 0;
      if (this.readIndex >= FRAME_SIZE) this.available = 0;
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
