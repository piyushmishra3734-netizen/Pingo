/**
 * What somebody actually picked, which is not always what the picker said.
 *
 * ## The two ways an audio file went wrong
 *
 * Sent through the document picker it arrived as `kind: 'file'` and drew a grey
 * card with a name on it - no player, nothing to press. Sent through the gallery
 * it was worse: the picker's filter was `image/*,video/*`, and the code behind
 * it sorted the result into "video" and *everything else*, so a song went to the
 * photo composer to be drawn onto a canvas.
 *
 * ## And the third: audio wearing a video's mime type
 *
 * Android's gallery hands back `video/mp4` for an audio-only `.m4a`, because
 * that is genuinely what the container is. Trusting the type opened the video
 * trimmer over a file with no picture in it, and the recipient got a player
 * showing a black rectangle. The only reliable answer is to ask the platform to
 * decode it and see whether a picture comes out, which is what `probeKind`
 * does - the mime type is a claim, `videoWidth` is a fact.
 */

export type PickedKind = 'image' | 'video' | 'audio' | 'file';

/** What each audio extension is actually called, for files that arrive untyped. */
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  amr: 'audio/amr',
};

/**
 * The same file, told the truth about itself.
 *
 * The probe is only half the fix. The type travels with the upload into
 * `file_mime`, and that is what the *receiver's* bubble branches on - so an
 * audio-only `video/mp4` routed correctly here and stored under its original
 * type would still draw a video player with a black rectangle on the other
 * side, and an untyped `.m4a` would be stored as `application/octet-stream`
 * and drawn as the grey card this whole change exists to stop.
 *
 * For a video container only the top level is rewritten. `video/mp4` and
 * `audio/mp4` are the same container and the subtype is the accurate part;
 * inventing `audio/mpeg` for an MP4 would be swapping one wrong answer for
 * another.
 */
export function retypedAsAudio(file: File): File {
  const type = file.type.toLowerCase();

  const audioType = type.startsWith('video/')
    ? `audio/${type.slice('video/'.length)}`
    : type
      ? undefined
      : AUDIO_TYPES[file.name.toLowerCase().split('.').pop() ?? ''];

  if (!audioType) return file;
  // A new handle over the same bytes - no copy, and the original is untouched.
  return new File([file], file.name, { type: audioType, lastModified: file.lastModified });
}

/** How long to wait for metadata before giving up and trusting the mime type. */
const PROBE_MS = 3000;

/**
 * The kind a file claims to be, from its mime type and then its name.
 *
 * The extension is a fallback rather than the first answer: some pickers hand
 * back an empty type, and a name is the only thing left. It is never preferred
 * over a type that is actually there.
 */
export function claimedKind(file: File): PickedKind {
  const type = file.type.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type) return 'file';

  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif'].includes(extension)) {
    return 'image';
  }
  if (['mp4', 'mov', 'webm', 'mkv', 'avi', '3gp'].includes(extension)) return 'video';
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'amr'].includes(extension)) {
    return 'audio';
  }
  return 'file';
}

/**
 * The kind it really is, having asked the platform to decode it.
 *
 * Only video claims are probed. An audio claim that turns out to have a picture
 * in it is not a thing that happens, and probing every pick would put a decode
 * in front of every send for no answer.
 *
 * Falls back to the claim on any failure, including the timeout: a file we
 * cannot decode here is one the recipient probably cannot either, and guessing
 * "audio" for it would hide a video behind a play button with no picture.
 */
export async function probeKind(file: File): Promise<PickedKind> {
  const claim = claimedKind(file);
  if (claim !== 'video') return claim;
  if (typeof document === 'undefined') return claim;

  const url = URL.createObjectURL(file);
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.muted = true;

  try {
    const shape = await new Promise<{ width: number; duration: number } | undefined>(
      (resolve) => {
        const done = (value: { width: number; duration: number } | undefined) => {
          window.clearTimeout(timer);
          resolve(value);
        };
        const timer = window.setTimeout(() => done(undefined), PROBE_MS);

        probe.onloadedmetadata = () =>
          done({ width: probe.videoWidth, duration: probe.duration });
        probe.onerror = () => done(undefined);
        probe.src = url;
      },
    );

    // No metadata is not evidence of anything - keep the claim.
    if (!shape) return claim;
    // A decoded stream with no picture in it is audio, whatever the container
    // is called.
    return shape.width === 0 ? 'audio' : 'video';
  } catch {
    return claim;
  } finally {
    probe.src = '';
    URL.revokeObjectURL(url);
  }
}
