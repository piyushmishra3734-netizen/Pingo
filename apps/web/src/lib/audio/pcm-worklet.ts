/**
 * The capture processor, as source, so it can be loaded without a build step.
 *
 * `audioWorklet.addModule` wants a URL, and a separate file would have to
 * survive bundling, hashing and the service worker to still be fetchable at the
 * moment a user taps record. A blob URL is created from this string at runtime
 * and cannot go missing.
 *
 * It accumulates a block before posting rather than sending each 128-frame
 * quantum, which would be 375 messages a second per recording.
 *
 * ## The flush, and why the end of every note needed it
 *
 * A block is only posted once it is full, so up to 4096 frames — about 85ms at
 * 48kHz — are always still sitting here when somebody taps send. That is the
 * last consonant of the last word, missing from every note recorded through
 * this path. On stop the main thread asks for what is left, and the processor
 * posts the partial block.
 *
 * ## Why it lives in its own file
 *
 * So the suite can run it. It is a string, which means the compiler never sees
 * it and a typo inside it fails at the moment somebody tries to record — the
 * worst possible time to find out. `verify:voice-capture` executes this exact
 * source against stub globals and proves that every frame put in comes back
 * out.
 */
export const PCM_BLOCK_FRAMES = 4096;

export const PCM_WORKLET_SOURCE = `
class PingoPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(${PCM_BLOCK_FRAMES});
    this.filled = 0;
    this.port.onmessage = () => {
      const tail = this.block.slice(0, this.filled);
      this.filled = 0;
      this.port.postMessage({ pcm: tail, peak: 0, flush: true }, [tail.buffer]);
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this.block[this.filled] = channel[i];
      this.filled += 1;

      if (this.filled === this.block.length) {
        let peak = 0;
        for (let j = 0; j < this.block.length; j += 1) {
          const value = this.block[j] < 0 ? -this.block[j] : this.block[j];
          if (value > peak) peak = value;
        }
        // Transferred, not copied: the block leaves this thread entirely.
        const out = this.block;
        this.port.postMessage({ pcm: out, peak }, [out.buffer]);
        this.block = new Float32Array(${PCM_BLOCK_FRAMES});
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('pingo-pcm', PingoPcmProcessor);
`;
