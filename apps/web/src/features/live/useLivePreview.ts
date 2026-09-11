/**
 * The live camera: one hook for preview and publishing.
 *
 * Plain `getUserMedia` into a `<video>`, deliberately *not* the GL pipeline -
 * a live publishes its raw tracks to LiveKit, and a filter baked into pixels
 * would be encoded twice. The setup screen previews with this; the host screen
 * publishes the same stream.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type LivePreviewStatus = 'starting' | 'ready' | 'failed' | 'headless';

export function useLivePreview(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | undefined>();
  const [status, setStatus] = useState<LivePreviewStatus>('starting');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  /**
   * Testing without hardware.
   *
   * A denied permission or a device with no camera used to be a dead end.
   * Headless mode stops asking and runs the flow with no tracks - comments,
   * hearts, guests and viewers all work, only the picture is a placeholder.
   */
  const [off, setOff] = useState(false);

  useEffect(() => {
    if (!active || off) return;
    let cancelled = false;
    let current: MediaStream | undefined;

    /*
     * Capture at the screen's own shape.
     *
     * A fixed 720x1280 request on a wider sensor means `object-cover` slices
     * the sides off to fill a tall screen - every face arrives zoomed in.
     * Asking for the viewport's aspect instead leaves almost nothing to crop,
     * so what you framed is what they get.
     */
    const viewportAspect =
      window.innerWidth > 0 && window.innerHeight > 0
        ? Math.min(0.75, Math.max(0.46, window.innerWidth / window.innerHeight))
        : 0.5625;

    setStatus('starting');
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: {
          facingMode: facing,
          width: { ideal: 720 },
          aspectRatio: { ideal: viewportAspect },
          frameRate: { ideal: 30 },
        },
      })
      .then((got) => {
        if (cancelled) {
          for (const track of got.getTracks()) track.stop();
          return;
        }
        current = got;
        setStream(got);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });

    return () => {
      cancelled = true;
      if (current) for (const track of current.getTracks()) track.stop();
      setStream(undefined);
    };
  }, [active, facing, off]);

  // The element paints whatever the current stream is.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = stream ?? null;
    if (stream) void element.play().catch(() => undefined);
  }, [stream]);

  // Mute applies to the live tracks, so it survives re-renders by construction.
  useEffect(() => {
    for (const track of stream?.getAudioTracks() ?? []) track.enabled = !muted;
  }, [stream, muted]);

  useEffect(() => {
    for (const track of stream?.getVideoTracks() ?? []) track.enabled = !cameraOff;
  }, [stream, cameraOff]);

  const flip = useCallback(() => {
    setOff(false);
    setFacing((previous) => (previous === 'user' ? 'environment' : 'user'));
  }, []);

  const goHeadless = useCallback(() => {
    setStream((previous) => {
      if (previous) for (const track of previous.getTracks()) track.stop();
      return undefined;
    });
    setOff(true);
    setStatus('headless');
  }, []);

  return { videoRef, stream, status, facing, flip, muted, setMuted, cameraOff, setCameraOff, goHeadless };
}
