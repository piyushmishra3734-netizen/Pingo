/**
 * Small delivery variants of pictures and video, made on the sender's device.
 *
 * ## Why this exists next to `media-quality.ts` rather than inside it
 *
 * `media-quality.ts` answers one question - "what is the one file that gets
 * sent?" - and its 480p ceiling is load-bearing for the whole photo path. This
 * module answers the adjacent one: "what cheap preview travels with (or stands
 * in for) that file?" A video poster that avoids downloading a 100 MB clip to
 * draw a thumbnail, a probe that refuses an absurd upload before it starts.
 * Same canvas primitives, different job, so a different module rather than
 * options threaded through a function whose contract is already relied upon.
 *
 * ## What is deliberately NOT here
 *
 * Video re-encoding. The DOM has no encoder and no muxer (see
 * `video-transcode.ts` - only the native shell can do it), so the delivery
 * file on web is still the original. Everything here reduces what gets
 * *fetched*, not what gets *sent* - except the duration/size refusal, which
 * stops the worst sends at the composer with a sentence the sender can act on.
 *
 * Every function is total: anything that cannot be decoded, drawn or encoded
 * resolves to `undefined`, and the caller falls back to today's behavior. A
 * preview that cannot be made must never stop a message.
 */

/** Long edge of a video poster. Big enough to look like the clip, small enough to be kilobytes. */
const POSTER_LONG_EDGE = 480;

/** Long edge of a still-image delivery variant. Matches the 480p send ceiling. */
const THUMB_LONG_EDGE = 480;

/** Quality for variant encodes. Below the send path's 0.72: a preview earns less. */
const VARIANT_QUALITY = 0.66;

/** How long to wait for video metadata before giving up and trusting the claim. */
const PROBE_MS = 4000;

/** How long to wait for a seek before giving up on the poster. */
const SEEK_MS = 4000;

/**
 * A clip this product will carry.
 *
 * Probed from the file itself with `preload="metadata"` - the platform reads
 * the container header, not the frames, so this costs kilobytes, not the clip.
 */
export interface VideoShape {
  width: number;
  height: number;
  /** Seconds. Infinity when the container does not say. */
  durationSeconds: number;
}

/**
 * The shape of a video file, or `undefined` when it cannot be known.
 *
 * Never throws and never rejects: an unprobed video is sent exactly as today,
 * without a poster and without a duration check.
 */
export function probeVideo(file: Blob): Promise<VideoShape | undefined> {
  if (typeof document === 'undefined') return Promise.resolve(undefined);
  if (!file.type.startsWith('video/')) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;

    const done = (value: VideoShape | undefined) => {
      window.clearTimeout(timer);
      probe.src = '';
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => done(undefined), PROBE_MS);

    probe.onloadedmetadata = () => {
      const width = probe.videoWidth;
      const height = probe.videoHeight;
      if (!width || !height) {
        done(undefined);
        return;
      }
      done({ width, height, durationSeconds: probe.duration });
    };
    probe.onerror = () => done(undefined);
    try {
      probe.src = url;
    } catch {
      done(undefined);
    }
  });
}

/**
 * One still frame of a video, as a small picture.
 *
 * Seeks to a quarter of the way in - past black leader frames, before anything
 * the trim marks may have cut - draws at most 480p, encodes WebP with a JPEG
 * fallback. Used as the tap-to-play face of a video nobody has downloaded yet,
 * and cached in the vault once anyone has.
 */
export function makeVideoPoster(file: Blob): Promise<Blob | undefined> {
  if (typeof document === 'undefined') return Promise.resolve(undefined);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;

    const done = (value: Blob | undefined) => {
      window.clearTimeout(timer);
      video.src = '';
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => done(undefined), SEEK_MS + PROBE_MS);

    video.onerror = () => done(undefined);
    video.onloadeddata = () => {
      try {
        const at = Number.isFinite(video.duration) && video.duration > 0 ? video.duration / 4 : 0;
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          void frameBlob(video).then(done);
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = Math.min(at, Math.max(0, (video.duration || 0) - 0.1));
        // A clip shorter than the seek target fires `seeked` immediately; a
        // clip that never seeks is covered by the timer above.
        window.setTimeout(() => {
          if (video.readyState >= 2 && video.videoWidth > 0) onSeeked();
        }, SEEK_MS);
      } catch {
        done(undefined);
      }
    };
    try {
      video.src = url;
    } catch {
      done(undefined);
    }
  });
}

/** The current frame, drawn small and encoded. Undefined when anything fails. */
async function frameBlob(video: HTMLVideoElement): Promise<Blob | undefined> {
  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return undefined;

    const scale = Math.min(1, POSTER_LONG_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return (await encodeCanvas(canvas, 'image/webp')) ?? (await encodeCanvas(canvas, 'image/jpeg'));
  } catch {
    return undefined;
  }
}

/**
 * A small still-image variant of a picture, or `undefined`.
 *
 * The same ceiling as the send path: anything already at or under 480p gains
 * nothing from a second copy, so there is none. Animated types pass through
 * untouched for the reason `media-quality.ts` gives - flattening a sticker to
 * its first frame is a bug wearing a saving as a disguise.
 */
export async function makeStillThumbnail(image: Blob): Promise<Blob | undefined> {
  try {
    if (!image.type.startsWith('image/')) return undefined;
    if (image.type === 'image/gif' || image.type === 'image/apng') return undefined;
    if (typeof createImageBitmap === 'undefined') return undefined;

    const bitmap = await createImageBitmap(image);
    const scale = Math.min(1, THUMB_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small: a second copy would be bytes for nothing.
    if (scale >= 1) {
      bitmap.close();
      return undefined;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return undefined;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    return (
      (await encodeCanvas(canvas, 'image/webp')) ?? (await encodeCanvas(canvas, 'image/jpeg'))
    );
  } catch {
    return undefined;
  }
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => resolve(blob && blob.type === type ? blob : undefined),
        type,
        VARIANT_QUALITY,
      );
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * The video this product will carry, by tier.
 *
 * ## Why refusal, not re-encoding
 *
 * The web cannot re-encode (see the module note), so an over-long clip has two
 * honest outcomes: send it whole, or refuse it with a sentence. Whole is what
 * happens today up to the 100 MB file ceiling; this cap is the backstop above
 * that judgment - ten minutes - past which the recipient's download is the
 * thing that fails, after a long wait, rather than immediately.
 *
 * One constant, next to the size ceilings in `media-limits.ts` rather than in
 * it: the day the product picks real tiers (360p free / HD premium), the
 * number moves and nothing else has to.
 */
export const MAX_VIDEO_SECONDS = 10 * 60;

/** What is wrong with this clip's duration, in words the sender can act on. */
export function videoTooLong(durationSeconds: number): string | undefined {
  if (!Number.isFinite(durationSeconds)) return undefined;
  if (durationSeconds <= MAX_VIDEO_SECONDS) return undefined;
  const minutes = Math.floor(durationSeconds / 60);
  return `That video is about ${minutes} minutes. The limit is ${MAX_VIDEO_SECONDS / 60} minutes - trim it first.`;
}
