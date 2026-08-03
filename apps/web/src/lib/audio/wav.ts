/**
 * Encode PCM to WAV so every browser can play a voice note.
 *
 * Chrome records WebM/Opus; Safari/iOS often cannot decode it. Capturing PCM
 * during record (and encoding WAV here) is the reliable path — no MediaRecorder
 * container quirks, no receiver codec roulette.
 */

/** Speech-friendly rate — clear enough, much smaller than 48 kHz WAV. */
export const VOICE_WAV_RATE = 24_000;

/**
 * Turn any browser-decodable recording into a mono WAV blob.
 *
 * Prefer {@link encodePcmToWavBlob} from live capture — decode can fail on
 * timesliced WebM and then the receiver gets unplayable bytes.
 */
export async function toPlayableVoiceBlob(blob: Blob): Promise<Blob> {
  if (!blob.size) return blob;
  if (/^audio\/(wav|wave)/i.test(blob.type)) return blob;

  try {
    const context = new AudioContext();
    try {
      // Copy buffer — decodeAudioData may detach the original ArrayBuffer.
      const copy = await blob.arrayBuffer();
      const buffer = await context.decodeAudioData(copy.slice(0));
      return encodePcmToWavBlob(
        mixToMono(buffer),
        buffer.sampleRate,
        VOICE_WAV_RATE,
      );
    } finally {
      void context.close().catch(() => undefined);
    }
  } catch {
    return blob;
  }
}

/** Build a mono WAV from float samples captured during recording. */
export function encodePcmToWavBlob(
  samples: Float32Array,
  fromRate: number,
  toRate: number = VOICE_WAV_RATE,
): Blob {
  const mono = samples;
  const resampled = resample(mono, fromRate, toRate);
  const wav = encodeWav(resampled, toRate);
  return new Blob([wav], { type: 'audio/wav' });
}

/** Concatenate PCM chunks from ScriptProcessor / AudioWorklet. */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  if (channels === 1) {
    out.set(buffer.getChannelData(0));
    return out;
  }
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) out[i]! += data[i]! / channels;
  }
  return out;
}

/** Linear resample — good enough for speech; no extra deps. */
/**
 * One 2nd-order lowpass, applied in place. RBJ cookbook coefficients.
 *
 * Forward-only, so it shifts phase. That is inaudible in speech and costs half
 * the work of running it backwards as well.
 */
function biquadLowpass(samples: Float32Array, rate: number, cutoff: number, q: number): void {
  const w0 = (2 * Math.PI * cutoff) / rate;
  const cos0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);

  const a0 = 1 + alpha;
  const b0 = ((1 - cos0) / 2) / a0;
  const b1 = (1 - cos0) / a0;
  const b2 = b0;
  const a1 = (-2 * cos0) / a0;
  const a2 = (1 - alpha) / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const x0 = samples[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    samples[i] = y0;
  }
}

/**
 * Drop everything the new sample rate cannot represent, before dropping samples.
 *
 * Reported from real use: voice notes sometimes sound harsh or warbly, and not
 * consistently. This is why. Capture runs at 48 kHz and the note is written at
 * 24 kHz, and the resampler below only interpolated — which is a very weak
 * lowpass. Everything above 12 kHz folded back into the audible band instead of
 * being removed.
 *
 * That aliasing is *content-dependent*, which is exactly why it comes and goes:
 * a calm low voice has little energy up there and sounds fine, while sibilance,
 * keyboard clicks, or room hiss fold down as a harsh warble. The recording is
 * lossless WAV either way, so the format was never the variable — this was.
 *
 * Three cascaded sections — 6th-order Butterworth — cut a little under the new
 * Nyquist so the transition band lands where nothing speech-carrying lives.
 *
 * Fourth order was tried first and left a 15 kHz tone folding down at about
 * -25 dB, which is quiet but measurable. 15 kHz sits only a third of an octave
 * above the cutoff, so it is the hardest case a 24 kHz file can be asked about;
 * the honest fix was a steeper filter rather than a slacker threshold. The cost
 * is one more biquad, which is nothing next to encoding the file at all.
 */
function antiAlias(samples: Float32Array, fromRate: number, toRate: number): void {
  const cutoff = Math.min(toRate * 0.45, fromRate * 0.45);
  // Standard 6th-order Butterworth section Q values.
  biquadLowpass(samples, fromRate, cutoff, 0.517_638_1);
  biquadLowpass(samples, fromRate, cutoff, 0.707_106_8);
  biquadLowpass(samples, fromRate, cutoff, 1.931_851_7);
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;

  /*
   * Filtered on a copy. `input` is the caller's captured PCM and is also used
   * to draw the waveform; filtering it in place would quietly change the
   * picture the sender sees to match a compromise made for the file.
   */
  const filtered = new Float32Array(input);
  if (toRate < fromRate) antiAlias(filtered, fromRate, toRate);
  input = filtered;

  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0]! * (1 - t) + input[i1]! * t;
  }
  return out;
}

/** 16-bit PCM little-endian WAV. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
