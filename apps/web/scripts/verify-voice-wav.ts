/**
 * Voice note encoding, measured rather than listened to.
 *
 * The reported symptom was that quality is unstable — fine most of the time,
 * harsh sometimes. A lossless WAV cannot vary in fidelity, so the variable had
 * to be upstream, and it was: 48 kHz capture written at 24 kHz through a
 * resampler with no anti-aliasing. Everything above 12 kHz folded back into the
 * audible band, and how much of that there is depends entirely on what was
 * said and what else was in the room.
 *
 * These tests put a known tone in and measure what comes out, so "it sounds
 * better" is not the evidence.
 *
 * Run with `pnpm verify:voice-wav`.
 */
import {
  VOICE_WAV_RATE,
  concatFloat32,
  encodePcmToWavBlob,
  normalisePeak,
} from '../src/lib/audio/wav.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const SOURCE_RATE = 48_000;

/** A pure tone, as a microphone would deliver it. */
function tone(hz: number, seconds: number, rate = SOURCE_RATE, amplitude = 0.6): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return out;
}

/** Read the 16-bit PCM back out of an encoded WAV. */
async function decode(blob: Blob): Promise<{ rate: number; samples: Float32Array }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rate = view.getUint32(24, true);
  const dataSize = view.getUint32(40, true);
  const samples = new Float32Array(dataSize / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(44 + i * 2, true) / 0x8000;
  }
  return { rate, samples };
}

/**
 * Energy at one frequency, by direct correlation.
 *
 * A full FFT would be more than this needs: every question here is "how much of
 * exactly this tone is present", which one Goertzel-style projection answers.
 */
function energyAt(samples: Float32Array, hz: number, rate: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const phase = (2 * Math.PI * hz * i) / rate;
    re += samples[i]! * Math.cos(phase);
    im += samples[i]! * Math.sin(phase);
  }
  return Math.sqrt(re * re + im * im) / samples.length;
}

console.log('— speech passes through —');

{
  // 1 kHz is squarely in the voice band and must survive intact.
  const blob = encodePcmToWavBlob(tone(1_000, 0.5), SOURCE_RATE);
  const { rate, samples } = await decode(blob);

  check(rate === VOICE_WAV_RATE, `written at ${VOICE_WAV_RATE} Hz (${rate})`);
  check(samples.length > 0, 'and contains audio');

  const kept = energyAt(samples, 1_000, rate);
  check(kept > 0.25, `a 1 kHz tone survives the filter (${kept.toFixed(3)})`);
}

{
  // 3 kHz carries most consonant intelligibility. It must not be softened.
  const blob = encodePcmToWavBlob(tone(3_000, 0.5), SOURCE_RATE);
  const { rate, samples } = await decode(blob);
  const kept = energyAt(samples, 3_000, rate);
  check(kept > 0.25, `3 kHz survives, so consonants stay crisp (${kept.toFixed(3)})`);
}

console.log('\n— the aliasing that made it sound unstable —');

{
  /*
   * 15 kHz cannot exist at 24 kHz — Nyquist is 12 kHz. Without a filter it
   * folds down to |24000 - 15000| = 9 kHz and appears as a whistle that was
   * never in the room. Sibilance and room hiss put real energy up there, which
   * is why the artefact came and went with what was being said.
   */
  const blob = encodePcmToWavBlob(tone(15_000, 0.5), SOURCE_RATE);
  const { rate, samples } = await decode(blob);

  const ghost = energyAt(samples, 9_000, rate);
  check(ghost < 0.02, `a 15 kHz tone does not fold down to 9 kHz (${ghost.toFixed(4)})`);
}

{
  // 18 kHz would fold to 6 kHz — right in the middle of speech.
  const blob = encodePcmToWavBlob(tone(18_000, 0.5), SOURCE_RATE);
  const { rate, samples } = await decode(blob);
  const ghost = energyAt(samples, 6_000, rate);
  check(ghost < 0.02, `an 18 kHz tone does not fold down to 6 kHz (${ghost.toFixed(4)})`);
}

{
  /*
   * The realistic case: speech plus something bright. Before the filter the
   * bright part landed on top of the voice; after it, only the voice remains.
   */
  const voice = tone(800, 0.5);
  const hiss = tone(16_000, 0.5, SOURCE_RATE, 0.4);
  const mixed = new Float32Array(voice.length);
  for (let i = 0; i < mixed.length; i += 1) mixed[i] = voice[i]! + hiss[i]!;

  const { rate, samples } = await decode(encodePcmToWavBlob(mixed, SOURCE_RATE));
  const speech = energyAt(samples, 800, rate);
  const ghost = energyAt(samples, 8_000, rate);

  check(speech > 0.25, `the voice is still there (${speech.toFixed(3)})`);
  check(ghost < 0.02, `and the hiss did not fold onto it at 8 kHz (${ghost.toFixed(4)})`);
  check(speech > ghost * 10, 'speech dominates the artefact by a wide margin');
}

console.log('\n— the captured audio is left alone —');

{
  /*
   * The waveform drawn for the sender comes from the same array. Filtering it
   * in place would quietly redraw the picture to match a compromise made for
   * the file, so the filter works on a copy.
   */
  const original = tone(15_000, 0.2);
  const before = Array.from(original.slice(0, 32));
  encodePcmToWavBlob(original, SOURCE_RATE);
  const after = Array.from(original.slice(0, 32));

  check(before.join() === after.join(), 'the caller’s PCM is not modified');
}

console.log('\n— no resampling, no filtering —');

{
  // Already at the target rate: nothing to fold, so nothing should be removed.
  const blob = encodePcmToWavBlob(tone(8_000, 0.3, VOICE_WAV_RATE), VOICE_WAV_RATE);
  const { rate, samples } = await decode(blob);
  const kept = energyAt(samples, 8_000, rate);
  check(rate === VOICE_WAV_RATE, 'the rate is unchanged');
  check(kept > 0.25, `and an 8 kHz tone is untouched (${kept.toFixed(3)})`);
}

console.log('\n— the pieces still fit together —');

{
  const chunks = [tone(500, 0.1), tone(500, 0.1), tone(500, 0.1)];
  const joined = concatFloat32(chunks);
  check(joined.length === chunks.reduce((n, c) => n + c.length, 0), 'chunks concatenate without loss');

  const { samples } = await decode(encodePcmToWavBlob(joined, SOURCE_RATE));
  const expected = Math.round((joined.length * VOICE_WAV_RATE) / SOURCE_RATE);
  check(Math.abs(samples.length - expected) <= 2, `duration is preserved (${samples.length} vs ${expected})`);
}

console.log('\n— levels are made even once, not ridden during capture —');

const peakOf = (samples: Float32Array) => {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]!));
  return peak;
};

{
  // A quiet talker should arrive audible.
  const quiet = tone(500, 0.3, SOURCE_RATE, 0.05);
  const lifted = normalisePeak(quiet);
  check(
    peakOf(lifted) > 0.35,
    `a quiet take is lifted (${peakOf(quiet).toFixed(3)} to ${peakOf(lifted).toFixed(3)})`,
  );
  check(peakOf(lifted) <= 1, 'and never past full scale');
}

{
  // Already loud: leave it alone rather than pushing it into the ceiling.
  const loud = tone(500, 0.3, SOURCE_RATE, 0.85);
  const out = normalisePeak(loud);
  check(Math.abs(peakOf(out) - 0.85) < 0.06, `a loud take is left as it is (${peakOf(out).toFixed(3)})`);
  check(peakOf(out) <= 1, 'and does not clip');
}

{
  /*
   * The property that separates this from AGC: one gain for the whole take, so
   * a quiet passage stays quieter than a loud one. AGC flattens them, and that
   * flattening is what people hear as the volume moving on its own.
   */
  const mixed = new Float32Array(SOURCE_RATE);
  for (let i = 0; i < mixed.length; i += 1) {
    const amplitude = i < mixed.length / 2 ? 0.4 : 0.08;
    mixed[i] = amplitude * Math.sin((2 * Math.PI * 500 * i) / SOURCE_RATE);
  }

  const out = normalisePeak(mixed);
  const loudHalf = peakOf(out.slice(0, out.length / 2));
  const quietHalf = peakOf(out.slice(out.length / 2));
  const ratioBefore = 0.4 / 0.08;
  const ratioAfter = loudHalf / quietHalf;

  check(
    Math.abs(ratioAfter - ratioBefore) < 0.2,
    `dynamics are preserved (${ratioAfter.toFixed(2)} vs ${ratioBefore.toFixed(2)})`,
  );
  check(loudHalf > quietHalf * 4, 'the loud half is still clearly louder');
}

{
  // A dead microphone must not become amplified room hum.
  const silence = new Float32Array(SOURCE_RATE);
  check(peakOf(normalisePeak(silence)) === 0, 'silence stays silent');

  const nearSilence = tone(500, 0.3, SOURCE_RATE, 0.0002);
  check(peakOf(normalisePeak(nearSilence)) < 0.01, 'and a near-dead mic is not blown up');
}

{
  // The lift is capped, so a very quiet take is helped rather than exploded.
  const veryQuiet = tone(500, 0.3, SOURCE_RATE, 0.01);
  const out = normalisePeak(veryQuiet);
  check(
    peakOf(out) <= 0.01 * 8 + 0.001,
    `the gain is capped at 8x (${(peakOf(out) / 0.01).toFixed(1)}x)`,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
