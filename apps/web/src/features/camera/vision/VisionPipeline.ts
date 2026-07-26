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
 * MediaPipe is the tracking engine — face mesh, hands, gestures and selfie
 * segmentation all come from `@mediapipe/tasks-vision` (Apache-2.0), which is
 * Google's own WebAssembly build. None of this is reimplemented.
 *
 * ## Everything is lazy, and that is the point
 *
 * Each task is a separate model download — roughly 3 MB for the face mesh, 2 MB
 * for hands, 1 MB for segmentation — and the WASM runtime is another 8 MB. A
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
 * Model locations.
 *
 * Google's CDN, which is what the MediaPipe docs use. For production these
 * should be self-hosted: a camera that stops working when a third-party CDN is
 * blocked is a camera that stops working in exactly the places people care
 * about privacy most.
 */
const MODELS = {
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  gesture:
    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  segmenter:
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
} as const;

const WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

/**
 * The concrete union of the tasks in use.
 *
 * `import type` is erased at build time, so naming these costs nothing at
 * runtime and the dynamic `import()` below still keeps the 8 MB WASM out of the
 * main bundle. A structural interface was tried first and is wrong: MediaPipe's
 * own types are precise, and widening the frame parameter to `unknown` breaks
 * contravariance — the task no longer satisfies the interface meant to describe
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
          // Only computed when asked for — it is measurable extra work per frame.
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
   * `timestamp` must increase monotonically — MediaPipe's VIDEO mode uses it to
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
        // preview — a dropped frame of landmarks is invisible; a frozen camera
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
