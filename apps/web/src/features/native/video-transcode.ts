import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The 480p cap for video, which only the installed app can do.
 *
 * The photo path re-encodes on a canvas. A video cannot: the DOM has no frame
 * decoder, no encoder and no muxer. So this is a native plugin, and the web
 * keeps sending originals - which is the honest outcome rather than a pretend
 * one, and is stated where the caller can act on it.
 *
 * ## The picker is on the native side deliberately
 *
 * The original never touches JavaScript. A 200 MB clip handed across the bridge
 * is 270 MB of base64 in the WebView's heap before anything has been converted;
 * the transcoded result is a few megabytes and is fetched over Capacitor's own
 * file server. So the expensive bytes stay where the codec is.
 */

interface TranscodeResult {
  cancelled: boolean;
  path?: string;
  size?: number;
  reason?: string;
}

interface VideoTranscodePlugin {
  /** Converts a video the page's own file input already picked. */
  transcodePicked(options: {
    name: string;
    size: number;
  }): Promise<TranscodeResult>;
  /** Opens the system video picker and returns a converted copy. */
  pick(): Promise<TranscodeResult>;
}

const plugin = registerPlugin<VideoTranscodePlugin>('VideoTranscode');

/** Whether a picked video can be shrunk here at all. */
export function canTranscodeVideo(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * A 480p copy of a video the user chooses, or `undefined` if they backed out.
 *
 * Throws when the conversion itself failed, because the caller has the context
 * to decide what that should mean and this does not. Sending the original from
 * in here would be the one outcome nobody asked for and nobody would be told
 * about.
 */
export async function pickTranscodedVideo(): Promise<File | undefined> {
  return fromResult(await plugin.pick());
}

/**
 * A 480p copy of a video the page has already picked, or the original.
 *
 * Falls back to what it was given rather than failing the send. Every reason
 * this can come back empty - a file the chooser never announced, a codec the
 * phone will not encode, a provider that answers no metadata query - is a
 * normal thing that happens on somebody's phone, and none of them is a reason
 * to refuse to send their video. The bytes are the fallback, not the error.
 */
export async function toStandardVideo(file: File): Promise<File> {
  if (!canTranscodeVideo()) return file;
  try {
    const converted = await fromResult(
      await plugin.transcodePicked({ name: file.name, size: file.size }),
    );
    if (!converted) return file;
    // A conversion that came out bigger means the source was already smaller
    // or better compressed than the encoder manages. Keep what we had.
    return converted.size < file.size ? converted : file;
  } catch {
    return file;
  }
}

async function fromResult(result: TranscodeResult): Promise<File | undefined> {
  if (result.cancelled || !result.path) return undefined;

  /*
   * `convertFileSrc` turns an app-private path into the localhost URL the
   * WebView is allowed to read. Fetching a file:// URL directly is refused -
   * and refused silently enough that it reads as an empty video.
   */
  const url = Capacitor.convertFileSrc(result.path);
  const blob = await fetch(url).then((r) => r.blob());
  return new File([blob], `video-${Date.now()}.mp4`, {
    type: blob.type || 'video/mp4',
    lastModified: Date.now(),
  });
}
