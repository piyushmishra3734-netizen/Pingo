/**
 * Camera hardware controls, via `MediaStreamTrack` constraints.
 *
 * Zoom, torch, focus and exposure are not things a web app implements — they
 * are things the *camera* does, and the browser exposes them as constrainable
 * properties on the video track. Applying a constraint asks the hardware; a
 * software zoom would be a crop, and a software "flash" would be a white
 * rectangle on the screen.
 *
 * ## Everything here is optional, and that is the hard part
 *
 * Support is genuinely uneven: Chrome on Android exposes most of it, Safari on
 * iOS almost none, and desktop webcams vary by driver. So nothing is assumed —
 * `readCapabilities` reports what this specific device actually offers, and the
 * UI hides a control rather than showing one that silently does nothing.
 *
 * These properties are also still non-standard enough that TypeScript's DOM
 * library does not describe them, which is why the casts below exist. They are
 * narrowed immediately into a typed shape so the rest of the app never touches
 * `any`.
 */

export interface CameraRange {
  min: number;
  max: number;
  step: number;
}

export interface CameraCapabilities {
  zoom?: CameraRange;
  exposure?: CameraRange;
  torch: boolean;
  /** Tap-to-focus needs both a manual mode and a point to aim at. */
  focusPoint: boolean;
}

/** What the DOM lib does not yet describe. */
interface ExtendedCapabilities {
  zoom?: { min: number; max: number; step?: number };
  exposureCompensation?: { min: number; max: number; step?: number };
  torch?: boolean;
  focusMode?: string[];
  pointsOfInterest?: unknown;
}

type ExtendedConstraint = Record<string, unknown>;

function range(source?: { min: number; max: number; step?: number }): CameraRange | undefined {
  if (!source || source.max <= source.min) return undefined;
  return { min: source.min, max: source.max, step: source.step ?? 0.1 };
}

export function readCapabilities(track: MediaStreamTrack | undefined): CameraCapabilities {
  if (!track?.getCapabilities) return { torch: false, focusPoint: false };

  const caps = track.getCapabilities() as ExtendedCapabilities;

  return {
    zoom: range(caps.zoom),
    exposure: range(caps.exposureCompensation),
    torch: caps.torch === true,
    focusPoint: Boolean(caps.focusMode?.includes('manual') && 'pointsOfInterest' in caps),
  };
}

/**
 * Applies one constraint, and never throws.
 *
 * A rejected constraint means this camera cannot do it — which is information,
 * not a failure. Letting it propagate would take down a capture for the sake of
 * a zoom the hardware declined.
 */
async function apply(
  track: MediaStreamTrack | undefined,
  constraint: ExtendedConstraint,
): Promise<boolean> {
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [constraint] } as MediaTrackConstraints);
    return true;
  } catch {
    return false;
  }
}

export const setZoom = (track: MediaStreamTrack | undefined, zoom: number) =>
  apply(track, { zoom });

export const setExposure = (track: MediaStreamTrack | undefined, value: number) =>
  apply(track, { exposureCompensation: value });

/**
 * Torch, which is what "flash" means on a phone in video mode.
 *
 * A stills flash fires once at capture; a `getUserMedia` stream has no shutter,
 * so the only honest equivalent is the lamp staying on. That is why the modes
 * are On and Off — an "Auto" that cannot measure the scene would be a guess
 * dressed as a feature.
 */
export const setTorch = (track: MediaStreamTrack | undefined, on: boolean) =>
  apply(track, { torch: on });

/**
 * Focuses on a point, in normalised coordinates.
 *
 * `pointsOfInterest` is in the *sensor's* frame: 0,0 is top-left of the image
 * as captured, which is not mirrored even when the preview is. The caller
 * un-mirrors before calling, so a tap lands where the user pointed.
 */
export const setFocusPoint = (track: MediaStreamTrack | undefined, x: number, y: number) =>
  apply(track, { focusMode: 'manual', pointsOfInterest: [{ x, y }] });
