import type { FilterInstance } from '@pingo/core';

import { GLPipeline } from './engine/GLPipeline.js';
import { getFilter } from './filters/registry.js';

/**
 * Runs the filter chain over a still image.
 *
 * ## Why this exists
 *
 * Filtering used to happen only in the live preview, which meant two things
 * that were both wrong: a device with no camera showed no filters at all, and a
 * photo chosen from the gallery went straight to the editor unfiltered. The
 * filter belonged to the *camera* rather than to the *snap*.
 *
 * With this, filtering is a stage every image passes through however it
 * arrived. The live preview still renders the chain — that is what makes it a
 * preview — but it is no longer the only place a filter can be applied.
 *
 * ## Off-screen, and disposed every time
 *
 * A WebGL context is a scarce resource; browsers cap them at around sixteen per
 * page and evict the oldest without warning. This creates one, uses it, and
 * destroys it, so flicking through a filter carousel cannot quietly kill the
 * live preview's context.
 */
export async function filterStill(
  source: Blob,
  chain: FilterInstance[],
): Promise<Blob> {
  /*
   * `flipY` here, and it has to be here.
   *
   * The pipeline's vertex shader maps uv (0,0) to the *bottom* of the frame,
   * which is GL's convention, and `setSource` corrects for it with
   * `UNPACK_FLIP_Y_WEBGL`. That flag works for a `<video>` — which is what the
   * live preview feeds it — and is **ignored for an `ImageBitmap`**, which is
   * what this path feeds it. So every still came out vertically mirrored while
   * the preview looked fine, and the two disagreed about which way up a picture
   * was.
   *
   * Measured rather than reasoned: uploading the same bitmap with the flag on
   * and off produced byte-identical, upside-down output, and asking for the
   * flip at bitmap-creation time produced the right one.
   */
  const bitmap = await createImageBitmap(source, { imageOrientation: 'flipY' });

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const pipeline = new GLPipeline(canvas);
    try {
      pipeline.setSource(bitmap, bitmap.width, bitmap.height);
      pipeline.render(chain, getFilter);

      /*
       * Read back in the same tick as the render.
       *
       * Without `preserveDrawingBuffer` the buffer is cleared once the browser
       * composites, and an awaited `toBlob` can land after that — returning a
       * blank image. Nothing yields between these two lines on purpose.
       */
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.92),
      );

      // Falling back to the original beats handing back nothing: an unfiltered
      // snap is a disappointment, a missing one is a lost photo.
      return blob ?? source;
    } finally {
      pipeline.dispose();
    }
  } catch {
    return source;
  } finally {
    bitmap.close();
  }
}
