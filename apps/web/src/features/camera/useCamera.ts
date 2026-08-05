import type { FilterInstance } from '@pingo/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readCapabilities,
  setExposure,
  setFocusPoint,
  setTorch,
  setZoom,
  type CameraCapabilities,
} from './controls.js';
import { GLPipeline } from './engine/GLPipeline.js';
import { getFilter } from './filters/registry.js';

/**
 * The camera, as one hook: stream, GL pipeline, render loop, capture.
 *
 * ## Why the preview is a canvas and not a `<video>`
 *
 * The filter has to be in the photo, not just on the screen. Drawing the raw
 * video to a 2D canvas and capturing that gives an unfiltered shot - which is
 * what the old screen did, and why the filter registry sat unused. Here the
 * video is a texture, `GLPipeline` renders the chain into a canvas, and the
 * canvas is *both* what you see and what gets captured. One source of truth.
 *
 * ## Capture happens inside the render loop
 *
 * A WebGL canvas without `preserveDrawingBuffer` is cleared once the browser
 * composites the frame, so `toBlob()` called from a click handler often returns
 * a blank image. Enabling that flag costs a full-frame copy on every frame,
 * forever, to serve a button pressed once. Instead a capture request is queued
 * and serviced immediately after the next `render()`, while the buffer is still
 * intact - no flag, no per-frame cost.
 */

export type CameraStatus = 'starting' | 'ready' | 'unavailable';

export interface UseCamera {
  /** Attach to the visible `<canvas>`. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  status: CameraStatus;
  facing: 'user' | 'environment';
  flip: () => Promise<void>;
  /** Resolves with the filtered frame, or undefined if the pipeline is not up. */
  capture: () => Promise<Blob | undefined>;

  /** What this particular camera can actually do. Controls hide when absent. */
  capabilities: CameraCapabilities;
  zoom: number;
  setZoom: (value: number) => void;
  exposure: number;
  setExposure: (value: number) => void;
  torch: boolean;
  toggleTorch: () => void;
  /** Normalised to the *preview*; mirroring is undone here. */
  focusAt: (x: number, y: number) => void;
}

/**
 * @param enabled Opens the camera only once this is true.
 *
 * The permission prompt is the most intrusive thing this app does, so it
 * waits for a deliberate action rather than firing the moment a route
 * renders. A user who arrived by tapping the wrong tab never sees it.
 */
export function useCamera(
  chain: FilterInstance[],
  enabled = true,
  /**
   * Which lens opens first. Settings → Camera & Pings → Default Camera.
   *
   * Was hardcoded to `'user'`, and the setting that claims to choose it was
   * read by nothing - so anybody who set it to Back still got the front camera
   * every single time, and the settings page told them it took effect now.
   */
  preferred: 'user' | 'environment' = 'user',
): UseCamera {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | undefined>(undefined);
  const pipelineRef = useRef<GLPipeline | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const pendingCapture = useRef<((blob: Blob | undefined) => void)[]>([]);
  /** Which canvas the pipeline is currently bound to. See the loop below. */
  const attachedCanvas = useRef<HTMLCanvasElement | undefined>(undefined);

  /*
   * The chain is read by the render loop, which is started once and must not be
   * restarted when the selected filter changes - tearing down and rebuilding
   * the GL context on every tap would drop frames visibly. A ref lets the loop
   * see the newest value without being a dependency.
   */
  const chainRef = useRef(chain);
  chainRef.current = chain;

  const [status, setStatus] = useState<CameraStatus>('starting');
  const [facing, setFacing] = useState<'user' | 'environment'>(preferred);
  const [capabilities, setCapabilities] = useState<CameraCapabilities>({
    torch: false,
    focusPoint: false,
  });
  const [zoom, setZoomState] = useState(1);
  const [exposure, setExposureState] = useState(0);
  const [torch, setTorchState] = useState(false);

  const track = () => streamRef.current?.getVideoTracks()[0];

  const open = useCallback(async (mode: 'user' | 'environment') => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });

    streamRef.current = stream;

    /*
     * Re-read on every open, never cached across a flip. Front and rear cameras
     * are different hardware: the rear one usually has zoom and a torch, the
     * front one usually has neither, and offering a control that does nothing
     * is worse than not offering it.
     */
    setCapabilities(readCapabilities(stream.getVideoTracks()[0]));
    setZoomState(1);
    setExposureState(0);
    setTorchState(false);

    const video = videoRef.current ?? document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    videoRef.current = video;

    return stream;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let frame = 0;

    void (async () => {
      try {
        await open(preferred);
        if (cancelled) return;

        setStatus('ready');

        const loop = () => {
          frame = requestAnimationFrame(loop);

          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2) return;

          /*
           * Rebuild when the canvas element changes.
           *
           * Leaving the live stage unmounts this canvas, and returning to it
           * mounts a *new* element - but the pipeline still holds a WebGL
           * context bound to the old, detached one. Rendering then goes
           * somewhere invisible while `capture()` still reads the old canvas,
           * so the preview is blank and the photo comes out fine. That is
           * exactly what "retake" did, and it is not a state the loop can
           * detect any other way than by identity.
           */
          if (attachedCanvas.current !== canvas) {
            pipelineRef.current?.dispose();
            pipelineRef.current = new GLPipeline(canvas);
            attachedCanvas.current = canvas;
          }

          const pipeline = pipelineRef.current;
          if (!pipeline) return;

          pipeline.setSource(video, video.videoWidth, video.videoHeight);
          pipeline.render(chainRef.current, getFilter);

          // Serviced here, one frame after the request, with the buffer intact.
          if (pendingCapture.current.length > 0) {
            const waiting = pendingCapture.current;
            pendingCapture.current = [];
            canvas.toBlob(
              (blob) => waiting.forEach((resolve) => resolve(blob ?? undefined)),
              'image/jpeg',
              0.92,
            );
          }
        };

        frame = requestAnimationFrame(loop);
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      pipelineRef.current?.dispose();
      pipelineRef.current = undefined;
      attachedCanvas.current = undefined;
      // Without this the camera light stays on after navigating away, which
      // reads as spyware however innocent the cause.
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = undefined;
    };
  }, [open, enabled]);

  const flip = useCallback(async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      await open(next);
      setFacing(next);
    } catch {
      // One camera, or the other is busy. Staying put beats a black preview.
    }
  }, [facing, open]);

  const capture = useCallback(async () => {
    if (status !== 'ready') return undefined;
    return new Promise<Blob | undefined>((resolve) => {
      pendingCapture.current.push(resolve);
    });
  }, [status]);

  return {
    canvasRef,
    status,
    facing,
    flip,
    capture,
    capabilities,
    zoom,
    exposure,
    torch,

    /*
     * State is set optimistically and the hardware is asked in the background.
     *
     * A slider that waits for `applyConstraints` to resolve before moving feels
     * broken - the round trip is tens of milliseconds and the user is dragging.
     * If the camera declines, the next `readCapabilities` corrects it.
     */
    setZoom: (value: number) => {
      setZoomState(value);
      void setZoom(track(), value);
    },
    setExposure: (value: number) => {
      setExposureState(value);
      void setExposure(track(), value);
    },
    toggleTorch: () => {
      const next = !torch;
      setTorchState(next);
      void setTorch(track(), next);
    },
    focusAt: (x: number, y: number) => {
      // The preview is mirrored for the front camera; the sensor is not. Without
      // this the tap focuses on the opposite side of the frame.
      void setFocusPoint(track(), facing === 'user' ? 1 - x : x, y);
    },
  };
}
