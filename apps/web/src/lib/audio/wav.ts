/**
 * Encode PCM to WAV so every browser can play a voice note.
 *
 * Chrome records WebM/Opus; Safari/iOS often cannot decode it. Re-encoding
 * after capture (already decoded for the waveform) is the cheap fix that
 * keeps receiver playback working without a server transcoder.
 */

/** Speech-friendly rate — clear enough, much smaller than 48 kHz WAV. */
const VOICE_WAV_RATE = 24_000;

/**
 * Turn any browser-decodable recording into a mono WAV blob.
 *
 * Falls back to the original blob if decode fails (rare codec edge cases),
 * so send is never blocked by the compatibility pass.
 */
export async function toPlayableVoiceBlob(blob: Blob): Promise<Blob> {
  if (!blob.size) return blob;
  // Already universal — leave alone.
  if (/^audio\/(wav|wave|mpeg|mp3|mp4|m4a|aac|x-m4a)/i.test(blob.type)) {
    return blob;
  }

  try {
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const mono = mixToMono(buffer);
      const resampled = resample(mono, buffer.sampleRate, VOICE_WAV_RATE);
      const wav = encodeWav(resampled, VOICE_WAV_RATE);
      return new Blob([wav], { type: 'audio/wav' });
    } finally {
      void context.close().catch(() => undefined);
    }
  } catch {
    return blob;
  }
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
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
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
