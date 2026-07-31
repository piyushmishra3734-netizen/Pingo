import { Capacitor } from '@capacitor/core';

import type { VisionCapability, VisionFrame, VisionTaskDefinition } from '@pingo/core';
import type {
  FaceLandmarker,
  GestureRecognizer,
  HandLandmarker,
  ImageSegmenter,
} from '@mediapipe/tasks-vision';

/**
 * Tracking, on MediaPipe.
 *
 * MediaPipe is the tracking engine - face mesh, hands, gestures and selfie
 * segmentation all come from `@mediapipe/tasks-vision` (Apache-2.0), which is
 * Google's own WebAssembly build. None of this is reimplemented.
 *
 * ## Everything is lazy, and that is the point
 *
 * Each task is a separate model download - roughly 3 MB for the face mesh, 2 MB
 * for hands, 1 MB for segmentation - and the WASM runtime is another 8 MB. A
 * camera that loaded all of it on open would cost 15 MB before showing a
 * preview.
 *
 * So nothing is fetched until a capability is switched on, and switching one
 * off closes it again. A chain that only blurs the background pays for
 * segmentation and nothing else.
 */

export const VISION_TASKS: VisionTaskDefinition[] = [
  {
    id: 'face-landmarker',
    capability: 'face-landmarks',
    label: 'Face mesh',
    attribution: {
      source: 'MediaPipe FaceLandmarker',
      url: 'https://github.com/google-ai-edge/mediapipe',
      licence: 'Apache-2.0',
    },
  },
  {
    id: 'face-blendshapes',
    capability: 'face-blendshapes',
    label: 'Expressions',
    attribution: {
      source: 'MediaPipe FaceLandmarker (blendshapes)',
      url: 'https://github.com/google-ai-edge/mediapipe',
      licence: 'Apache-2.0',
    },
  },
  {
    id: 'hand-landmarker',
    capability: 'hand-landmarks',
    label: 'Hands',
    attribution: {
      source: 'MediaPipe HandLandmarker',
      url: 'https://github.com/google-ai-edge/mediapipe',
      licence: 'Apache-2.0',
    },
  },
  {
    id: 'gesture-recognizer',
    capability: 'gestures',
    label: 'Gestures',
    attribution: {
      source: 'MediaPipe GestureRecognizer',
      url: 'https://github.com/google-ai-edge/mediapipe',
      licence: 'Apache-2.0',
    },
  },
  {
    id: 'image-segmenter',
    capability: 'segmentation',
    label: 'Background',
    attribution: {
      source: 'MediaPipe ImageSegmenter (selfie)',
      url: 'https://github.com/google-ai-edge/mediapipe',
      licence: 'Apache-2.0',
    },
  },
];

/**
 * Model locations - our own origin.
 *
 * These came from Google's CDN, which is what the MediaPipe docs use, and the
 * note that used to sit here said they should be self-hosted before production.
 * Two reasons, and both turned out to matter.
 *
 * The first is the one that comment made: a camera that stops working when a
 * third-party CDN is blocked stops working in exactly the places people care
 * about privacy most. The second only became visible when the privacy policy
 * was written - turning on a face filter contacted Google, so the policy had to
 * name them as a third party for a reason that had nothing to do with the
 * product's actual dependencies.
 *
 * The tracking always ran on the device and no image ever left it. What left
 * was a request saying "somebody here is about to use a face filter", which is
 * a small thing to leak and an unnecessary one.
 *
 * ## They are not precached
 *
 * Forty megabytes, and most people never open a camera effect. The service
 * worker skips this folder deliberately, so the cost is paid once by whoever
 * uses the feature rather than by everyone on first load.
 */
/**
 * Where the models are fetched from at runtime.
 *
 * On the web they are same-origin files, served from PINGO's own domain - which
 * is the whole point of having self-hosted them.
 *
 * Inside the Android app they are deliberately *not* bundled. Forty megabytes
 * of model would push the APK past the 25MiB a static host will serve, and
 * being able to hand somebody a download link matters more than face filters
 * working with no signal at all. So the shell fetches them from the same PINGO
 * origin the first time an effect is opened.
 *
 * Still not Google, which was the reason for self-hosting, and that survives.
 */
/*
 * Same-origin everywhere, which on Android means bundled inside the app.
 *
 * They were briefly fetched from the website instead, to keep the APK under the
 * 25 MiB a static host will serve. That limit stopped existing the moment
 * distribution moved to GitHub Releases, which allows 2 GB.
 *
 * Bundled is the right answer and always was: a camera that needs a connection
 * to apply a filter is precisely what self-hosting these was meant to prevent.
 * Trading forty megabytes of download for that was a compromise forced by a
 * host, not a decision about the product.
 */
const ASSET_ORIGIN = '';

const MODELS = {
  face: `${ASSET_ORIGIN}/vision/face_landmarker.task`,
  hand: `${ASSET_ORIGIN}/vision/hand_landmarker.task`,
  gesture: `${ASSET_ORIGIN}/vision/gesture_recognizer.task`,
  segmenter: `${ASSET_ORIGIN}/vision/selfie_segmenter.tflite`,
} as const;

/**
 * The runtime, also ours.
 *
 * Both the SIMD and non-SIMD builds are here. MediaPipe picks between them by
 * probing what the browser supports, and shipping only the SIMD one would mean
 * an older device fetching a 404 and losing camera effects entirely - a silent
 * failure on precisely the hardware least able to explain itself.
 */
const WASM_ROOT = `${ASSET_ORIGIN}/vision/wasm`;

/**
 * The concrete union of the tasks in use.
 *
 * `import type` is erased at build time, so naming these costs nothing at
 * runtime and the dynamic `import()` below still keeps the 8 MB WASM out of the
 * main bundle. A structural interface was tried first and is wrong: MediaPipe's
 * own types are precise, and widening the frame parameter to `unknown` breaks
 * contravariance - the task no longer satisfies the interface meant to describe
 * it.
 */
type Runner = FaceLandmarker | HandLandmarker | GestureRecognizer | ImageSegmenter;

export class VisionPipeline {
  #enabled = new Set<VisionCapability>();
  #runners = new Map<VisionCapability, Runner>();
  #fileset: unknown;
  #latest: VisionFrame | undefined;
  /** Guards against two enable calls racing the same model download. */
  #loading = new Map<VisionCapability, Promise<void>>();

  get latest(): VisionFrame | undefined {
    return this.#latest;
  }

  get enabled(): VisionCapability[] {
    return [...this.#enabled];
  }

  async #resolver(): Promise<unknown> {
    if (this.#fileset) return this.#fileset;
    // Dynamic import: the WASM loader is ~8 MB and must not sit in the main
    // bundle for the majority of sessions that never open the camera.
    const { FilesetResolver } = await import('@mediapipe/tasks-vision');
    this.#fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
    return this.#fileset;
  }

  async setCapabilities(capabilities: VisionCapability[]): Promise<void> {
    const wanted = new Set(capabilities);

    // Close what is no longer wanted first, so a swap never holds two models.
    for (const [capability, runner] of this.#runners) {
      if (!wanted.has(capability)) {
        runner.close();
        this.#runners.delete(capability);
        this.#enabled.delete(capability);
      }
    }

    await Promise.all([...wanted].map((capability) => this.#enable(capability)));
  }

  async #enable(capability: VisionCapability): Promise<void> {
    if (this.#runners.has(capability)) return;

    const inFlight = this.#loading.get(capability);
    if (inFlight) return inFlight;

    const load = this.#load(capability).finally(() => this.#loading.delete(capability));
    this.#loading.set(capability, load);
    return load;
  }

  async #load(capability: VisionCapability): Promise<void> {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = (await this.#resolver()) as Parameters<
      typeof vision.FaceLandmarker.createFromOptions
    >[0];

    switch (capability) {
      case 'face-landmarks':
      case 'face-blendshapes': {
        const runner = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.face, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
          // Only computed when asked for - it is measurable extra work per frame.
          outputFaceBlendshapes: capability === 'face-blendshapes',
        });
        this.#runners.set(capability, runner);
        break;
      }

      case 'hand-landmarks': {
        const runner = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.hand, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        });
        this.#runners.set(capability, runner);
        break;
      }

      case 'gestures': {
        const runner = await vision.GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.gesture, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        });
        this.#runners.set(capability, runner);
        break;
      }

      case 'segmentation': {
        const runner = await vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.segmenter, delegate: 'GPU' },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
        this.#runners.set(capability, runner);
        break;
      }
    }

    this.#enabled.add(capability);
  }

  /**
   * Runs every enabled tracker against one frame.
   *
   * `timestamp` must increase monotonically - MediaPipe's VIDEO mode uses it to
   * order frames and throws on a value it has already seen, which is the usual
   * cause of a tracker that works once and then stops.
   */
  detect(source: HTMLVideoElement | HTMLCanvasElement, timestamp: number): VisionFrame {
    const frame: VisionFrame = { timestamp };

    for (const [capability, runner] of this.#runners) {
      try {
        switch (capability) {
          case 'face-landmarks':
          case 'face-blendshapes': {
            const result = (runner as FaceLandmarker).detectForVideo(source, timestamp) as {
              faceLandmarks?: { x: number; y: number; z: number }[][];
              faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
            };

            if (result.faceLandmarks) frame.faces = result.faceLandmarks;
            if (result.faceBlendshapes) {
              frame.blendshapes = result.faceBlendshapes.map((face) =>
                Object.fromEntries(
                  face.categories.map((category) => [category.categoryName, category.score]),
                ),
              );
            }
            break;
          }

          case 'hand-landmarks': {
            const result = (runner as HandLandmarker).detectForVideo(source, timestamp) as {
              landmarks?: { x: number; y: number; z: number }[][];
            };
            if (result.landmarks) frame.hands = result.landmarks;
            break;
          }

          case 'gestures': {
            const result = (runner as GestureRecognizer).recognizeForVideo(source, timestamp) as {
              landmarks?: { x: number; y: number; z: number }[][];
              gestures?: { categoryName: string }[][];
            };
            if (result.landmarks) frame.hands = result.landmarks;
            if (result.gestures) {
              frame.gestures = result.gestures
                .map((hand) => hand[0]?.categoryName)
                .filter((name): name is string => Boolean(name));
            }
            break;
          }

          case 'segmentation': {
            const result = (runner as ImageSegmenter).segmentForVideo(source, timestamp) as {
              categoryMask?: { canvas?: HTMLCanvasElement; close: () => void };
            };
            // The mask is a pooled GPU resource; holding the canvas rather than
            // the wrapper is what lets it be released each frame.
            frame.segmentationMask = result.categoryMask?.canvas;
            result.categoryMask?.close();
            break;
          }
        }
      } catch {
        // One tracker failing must not stop the others, and must not stop the
        // preview - a dropped frame of landmarks is invisible; a frozen camera
        // is not.
      }
    }

    this.#latest = frame;
    return frame;
  }

  dispose(): void {
    for (const runner of this.#runners.values()) runner.close();
    this.#runners.clear();
    this.#enabled.clear();
    this.#latest = undefined;
  }
}
