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

    setStatus('starting');
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
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
