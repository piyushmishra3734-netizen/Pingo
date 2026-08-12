import { encodePcmToWavBlob } from '../../lib/audio/wav.js';

/**
 * Turning any file somebody has into a piece of sound for a story.
 *
 * ## Why it is decoded rather than uploaded as it arrived
 *
 * The rest of this product refuses to re-encode: a video is trimmed by marks
 * because cutting it means rebuilding it, and rebuilding it costs the picture.
 * Sound is the case where that reasoning inverts. Decoding a track is one call
 * into the browser's own decoder, a cut is an array slice, and what comes back
 * out is a few hundred kilobytes - so the piece can simply *be* the piece, and
 * the player is left with nothing to interpret.
 *
 * It is also the only honest way to answer "take the song out of this video":
 * uploading the video to play its audio would send thirty megabytes to hear
 * fifteen seconds, and every viewer would download all of it.
 *
 * ## Mono, at 44.1k
 *
 * Voice notes here are mono 24k, which is right for speech and audibly wrong
 * for music - it lands somewhere near a phone speaker held up to a radio. A
 * story sound is as likely to be a song as a sentence, so it gets the rate a
 * song needs. Mono, because it is playing under a picture on a phone and
 * stereo would double the upload for a difference nobody will hear.
 */

/** The rate a piece of music survives. Voice notes stay at their own. */
export const STORY_AUDIO_RATE = 44_100;

/** Longer than this is not a story sound, it is a track somebody uploaded. */
export const MAX_TRACK_SECONDS = 30;

/**
 * The longest a story will stay up for its sound.
 *
 * A ceiling rather than a preference: the pieces decide how long a story runs,
 * and without a limit one slider dragged to the end of a long song leaves a
 * still photograph on the screen for four minutes with no way to skip past the
 * part nobody is watching. A minute is already twice as long as anybody holds
 * still for a story.
 */
export const MAX_STORY_SECONDS = 60;

/** What a picked file becomes: the sound itself, and something to call it. */
export interface DecodedSound {
  name: string;
  buffer: AudioBuffer;
}

/**
 * Decode anything the browser can play - a song, a voice memo, a video.
 *
 * A video file works because the decoder reads the container and hands back
 * only what it can turn into samples, which is the audio track. That is the
 * whole of "extract the sound from this clip"; there is nothing else to do.
 */
export async function decodeSound(file: File): Promise<DecodedSound> {
  const bytes = await file.arrayBuffer();
  /*
   * A short-lived context, closed straight after. An AudioContext holds a
   * hardware output stream open, and browsers cap how many a page may have -
   * picking six files in a row with a leaked context each is how a page stops
   * being able to play anything at all.
   */
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes);
    if (buffer.duration <= 0) throw new Error('That file has no sound in it.');
    return { name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Sound', buffer };
  } catch (cause) {
    throw cause instanceof Error && cause.message
      ? new Error(
          cause.name === 'EncodingError'
            ? 'That file has no sound this browser can read.'
            : cause.message,
        )
      : new Error('That file could not be read.');
  } finally {
    void context.close();
  }
}

/** Average the channels. A story plays under a picture, not in headphones. */
function toMono(buffer: AudioBuffer, from: number, to: number): Float32Array {
  const start = Math.max(0, Math.floor(from * buffer.sampleRate));
  const end = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate));
  const length = Math.max(0, end - start);
  const out = new Float32Array(length);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) out[i] = out[i]! + data[start + i]!;
  }

  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < length; i += 1) out[i] = out[i]! / buffer.numberOfChannels;
  }
  return out;
}

/**
 * The chosen stretch of a sound, as a file.
 *
 * Fading the first and last few milliseconds, because a cut through a waveform
 * mid-cycle is a step, and a step is a click - the sort of detail that is the
 * difference between "it has music on it" and "it sounds made".
 */
export function cutToWav(buffer: AudioBuffer, from: number, to: number): Blob {
  const samples = toMono(buffer, from, to);
  const fade = Math.min(Math.floor(buffer.sampleRate * 0.01), Math.floor(samples.length / 2));

  for (let i = 0; i < fade; i += 1) {
    const gain = i / fade;
    samples[i] = samples[i]! * gain;
    samples[samples.length - 1 - i] = samples[samples.length - 1 - i]! * gain;
  }

  return encodePcmToWavBlob(samples, buffer.sampleRate, STORY_AUDIO_RATE);
}

/** Seconds as 0:07, which is the only length a story sound ever needs. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
