/**
 * Cutting a piece of sound for a story, measured rather than listened to.
 *
 * A story's sound is the one place this product does re-encode: the chosen
 * stretch is decoded, cut and written out as its own file, so playback has
 * nothing to interpret. That makes the cut itself the thing that can be wrong -
 * off by a channel, off by a rate, or clicking at the joins - and none of those
 * are visible in an editor that plays the source rather than the result.
 *
 * `cutToWav` asks an AudioBuffer only for its rate, its length, its channel
 * count and its samples, so a plain object stands in for one here and the real
 * function is exercised without a browser.
 *
 * Run with `pnpm verify:story-audio`.
 */
import { STORY_AUDIO_RATE, cutToWav } from '../src/features/stories/story-audio.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const SOURCE_RATE = 48_000;

/** A stereo buffer whose two channels differ, so a bad downmix shows up. */
function stereo(seconds: number, left: number, right: number): AudioBuffer {
  const length = Math.round(SOURCE_RATE * seconds);
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (let i = 0; i < length; i += 1) {
    channels[0]![i] = left;
    channels[1]![i] = right;
  }
  return {
    sampleRate: SOURCE_RATE,
    length,
    duration: seconds,
    numberOfChannels: 2,
    getChannelData: (channel: number) => channels[channel]!,
  } as unknown as AudioBuffer;
}

/** Read the 16-bit PCM back out of an encoded WAV. */
async function decode(blob: Blob): Promise<{ rate: number; channels: number; samples: Float32Array }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataSize = view.getUint32(40, true);
  const samples = new Float32Array(dataSize / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(44 + i * 2, true) / 0x8000;
  }
  return { rate: view.getUint32(24, true), channels: view.getUint16(22, true), samples };
}

const peakBetween = (samples: Float32Array, from: number, to: number) => {
  let max = 0;
  for (let i = from; i < to; i += 1) max = Math.max(max, Math.abs(samples[i]!));
  return max;
};

console.log('— the piece is the stretch that was asked for —');

{
  const { rate, channels, samples } = await decode(cutToWav(stereo(2, 0.5, 0.5), 0.5, 1.5));

  check(rate === STORY_AUDIO_RATE, `written at ${STORY_AUDIO_RATE} Hz (${rate})`);
  check(channels === 1, `mono, whatever came in (${channels})`);

  const seconds = samples.length / rate;
  check(Math.abs(seconds - 1) < 0.02, `one second of source is one second out (${seconds.toFixed(3)}s)`);
}

console.log('\n— both channels are heard —');

{
  // Left silent, right loud: an average is 0.25, taking channel 0 is silence.
  const { samples } = await decode(cutToWav(stereo(1, 0, 0.5), 0.1, 0.9));
  const middle = peakBetween(samples, Math.floor(samples.length / 2) - 100, Math.floor(samples.length / 2) + 100);
  check(Math.abs(middle - 0.25) < 0.02, `the channels are averaged, not dropped (${middle.toFixed(3)})`);
}

console.log('\n— the joins do not click —');

{
  const { rate, samples } = await decode(cutToWav(stereo(1, 0.5, 0.5), 0.2, 0.8));
  const edge = Math.floor(rate * 0.001);
  const middle = Math.floor(samples.length / 2);

  check(peakBetween(samples, 0, edge) < 0.1, 'the first millisecond is faded in');
  check(peakBetween(samples, samples.length - edge, samples.length) < 0.1, 'and the last is faded out');
  check(
    peakBetween(samples, middle - 100, middle + 100) > 0.4,
    'while the middle is at full level',
  );
}

console.log('\n— a cut shorter than the fade is still a file —');

{
  // The fade is 10ms per end; a 5ms piece has less audio than that, and the
  // arithmetic must not run past the end of the array or return nothing.
  const blob = cutToWav(stereo(1, 0.5, 0.5), 0.1, 0.105);
  const { samples } = await decode(blob);
  check(blob.size > 44, `there is more than a header (${blob.size} bytes)`);
  check(samples.length > 0, `and samples in it (${samples.length})`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
