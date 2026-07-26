/**
 * The camera boundary.
 *
 * Contracts only — no WebGL, no MediaPipe, no DOM. `apps/web` implements these;
 * a future native client implements the same names over Metal and the MediaPipe
 * native SDK, and every filter definition and screen above stays put.
 *
 * ## The rule this file exists to enforce
 *
 * **Adding a filter, an AR effect or an AI feature must not touch the engine.**
 * So the engine knows about three registries and nothing else:
 *
 *   filters   — a shader pass, described as data
 *   vision    — a tracker that emits landmarks or a mask
 *   effects   — something drawn *using* vision output
 *
 * A new effect is a new entry. The engine iterates; it never switches on a name.
 */

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type FilterCategory = 'colour' | 'beauty' | 'stylise' | 'lut' | 'utility';

/** A knob a filter exposes. Rendered generically, so no filter needs its own UI. */
export interface FilterParam {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/**
 * One pass in the chain.
 *
 * Modelled on GPUImage: a filter is a fragment shader plus its uniforms, and a
 * chain is those passes run in order, each reading the previous one's output.
 * That is the architecture GPUImage3 uses on Metal; this is the same shape in
 * WebGL, which is the only place it can run in a browser.
 */
export interface FilterDefinition {
  id: string;
  name: string;
  category: FilterCategory;
  /** GLSL ES 3.00 fragment shader body. See `apps/web` for the contract. */
  fragmentShader: string;
  params?: FilterParam[];
  /**
   * Where the shader came from, and under what licence. Required — a filter
   * with no provenance cannot be shipped, and this is the field that stops one
   * from being added without it.
   */
  attribution: Attribution;
  /** Needs a segmentation mask or landmarks bound before it can run. */
  requires?: VisionCapability[];
}

export interface Attribution {
  source: string;
  url: string;
  /** SPDX identifier. */
  licence: 'MIT' | 'Apache-2.0' | 'BSD-3-Clause' | 'BSD-2-Clause' | 'CC0-1.0' | 'original';
  /** Present when the shader was adapted rather than copied verbatim. */
  note?: string;
}

/** One filter in a user's chain: which filter, how strong, what settings. */
export interface FilterInstance {
  filterId: string;
  /** 0–1. Blends the pass against its input, so every filter fades uniformly. */
  intensity: number;
  params?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

export type VisionCapability =
  | 'face-landmarks'
  | 'face-blendshapes'
  | 'hand-landmarks'
  | 'gestures'
  | 'segmentation';

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/**
 * What the trackers produced for one frame.
 *
 * Every field is optional because tasks are enabled independently — a chain
 * that only needs a background mask should not pay for face tracking.
 */
export interface VisionFrame {
  /** 478 points per face when the face mesh is running. */
  faces?: Landmark[][];
  /** Named expression weights, 0–1, e.g. `mouthSmileLeft`. */
  blendshapes?: Record<string, number>[];
  hands?: Landmark[][];
  /** Recognised gesture per hand, e.g. `Thumb_Up`. */
  gestures?: string[];
  /** Person/background mask as a single-channel texture source. */
  segmentationMask?: unknown;
  /** Epoch ms of the frame these results describe. */
  timestamp: number;
}

/** A tracker, described as data so the engine never names one. */
export interface VisionTaskDefinition {
  id: string;
  capability: VisionCapability;
  label: string;
  attribution: Attribution;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * Something drawn on top using vision output — a mask, a particle system, a
 * pair of glasses pinned to a face.
 *
 * Deliberately *not* a shader pass: effects need the landmark data and often
 * their own geometry, so they are given a draw call rather than a fragment
 * body. Keeping them a separate kind is what stops the filter chain from
 * growing special cases.
 */
export interface EffectDefinition {
  id: string;
  name: string;
  requires: VisionCapability[];
  attribution: Attribution;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export interface CameraEngineOptions {
  facing?: 'front' | 'back';
  /** Mirrors the preview only. Captures are never mirrored. */
  mirror?: boolean;
}

/**
 * What a screen may ask of the camera.
 *
 * Nothing here mentions WebGL or MediaPipe, so a native implementation can
 * satisfy it without pretending to be a browser.
 */
export interface CameraEngine {
  start(options?: CameraEngineOptions): Promise<void>;
  stop(): void;

  /** Replaces the chain. Order is the render order. */
  setChain(chain: FilterInstance[]): void;
  /** Turns trackers on and off. Off means not loaded and not costing anything. */
  setVision(capabilities: VisionCapability[]): void;

  /** A still, already filtered. */
  capturePhoto(): Promise<Blob>;

  startRecording(): Promise<void>;
  stopRecording(): Promise<Blob>;

  /** Latest tracker output, for effects and for UI that reacts to gestures. */
  readonly vision: VisionFrame | undefined;
}
