import type { FilterInstance } from '@pingo/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { GLPipeline } from './engine/GLPipeline.js';
import { getFilter } from './filters/registry.js';

/**
 * The camera, as one hook: stream, GL pipeline, render loop, capture.
 *
 * ## Why the preview is a canvas and not a `<video>`
 *
 * The filter has to be in the photo, not just on the screen. Drawing the raw
 * video to a 2D canvas and capturing that gives an unfiltered shot — which is
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
 * intact — no flag, no per-frame cost.
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
}

export function useCamera(chain: FilterInstance[]): UseCamera {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | undefined>(undefined);
  const pipelineRef = useRef<GLPipeline | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const pendingCapture = useRef<((blob: Blob | undefined) => void)[]>([]);

  /*
   * The chain is read by the render loop, which is started once and must not be
   * restarted when the selected filter changes — tearing down and rebuilding
   * the GL context on every tap would drop frames visibly. A ref lets the loop
   * see the newest value without being a dependency.
   */
  const chainRef = useRef(chain);
  chainRef.current = chain;

  const [status, setStatus] = useState<CameraStatus>('starting');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');

  const open = useCallback(async (mode: 'user' | 'environment') => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });

    streamRef.current = stream;

    const video = videoRef.current ?? document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    videoRef.current = video;

    return stream;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;

    void (async () => {
      try {
        await open('user');
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        pipelineRef.current = new GLPipeline(canvas);
        setStatus('ready');

        const loop = () => {
          frame = requestAnimationFrame(loop);

          const video = videoRef.current;
          const pipeline = pipelineRef.current;
          if (!video || !pipeline || video.readyState < 2) return;

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
      // Without this the camera light stays on after navigating away, which
      // reads as spyware however innocent the cause.
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = undefined;
    };
  }, [open]);

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

  return { canvasRef, status, facing, flip, capture };
}
