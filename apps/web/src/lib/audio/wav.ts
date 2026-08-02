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
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
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
