import { Button, CameraIcon, PingoDot, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useStories } from '../features/stories/StoryContext.js';

/**
 * Camera — the fifth dock destination, and the way a story gets posted.
 *
 * ## Live preview, with a real fallback
 *
 * `getUserMedia` needs a permission the user may refuse, a device they may not
 * have, and a secure context that plain HTTP does not provide. All three fail
 * the same way here: the preview is replaced by a file picker, which reaches the
 * camera anyway on a phone and the gallery everywhere else.
 *
 * So the screen never dead-ends on a denied permission — it degrades to
 * something that still posts a story.
 *
 * The stream is stopped on unmount. Leaving it open keeps the camera light on
 * after the user has navigated away, which reads as spyware however innocent
 * the cause.
 */

type Stage = 'live' | 'review' | 'posting';

export function CameraScreen() {
  const navigate = useNavigate();
  const { service, refresh } = useStories();

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);

  const [stage, setStage] = useState<Stage>('live');
  const [cameraAvailable, setCameraAvailable] = useState<boolean | undefined>();
  const [shot, setShot] = useState<{ blob: Blob; url: string } | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        setCameraAvailable(true);
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        if (!cancelled) setCameraAvailable(false);
      }
    })();

    return () => {
      cancelled = true;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = undefined;
    };
  }, []);

  // Blob URLs live as long as the document unless revoked.
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) return;

    /*
     * The preview is mirrored so it behaves like a mirror; the capture must not
     * be, or text in the shot comes out backwards. Flipping the canvas back
     * undoes the preview transform.
     */
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      setShot({ blob, url: URL.createObjectURL(blob) });
      setStage('review');
    }, 'image/jpeg', 0.9);
  };

  const choose = (file: File | undefined) => {
    if (!file) return;
    setShot({ blob: file, url: URL.createObjectURL(file) });
    setStage('review');
  };

  const post = async () => {
    if (!shot) return;
    setStage('posting');
    setError(undefined);

    try {
      await service.post(shot.blob);
      await refresh();
      navigate('/chats', { replace: true });
    } catch {
      setError("That didn't post. Try again.");
      setStage('review');
    }
  };

  return (
    <div className="flex h-full flex-col bg-ink">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {stage === 'live' && cameraAvailable !== false && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            // Mirrored, because a preview that moves the opposite way to your
            // hand is unusable.
            className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
          />
        )}

        {stage === 'live' && cameraAvailable === undefined && (
          <div className="absolute inset-0 grid place-items-center">
            <PingoDot state="loading" size={8} label="Starting camera" />
          </div>
        )}

        {stage === 'live' && cameraAvailable === false && (
          <div className="absolute inset-0 grid place-items-center px-8 text-center">
            <div>
              <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white/10 text-white">
                <CameraIcon size={28} />
              </span>
              <p className="mt-6 text-body text-white">No camera here.</p>
              <p className="mt-2 text-caption text-white/60">
                Pick a photo instead — it works just the same.
              </p>
            </div>
          </div>
        )}

        {shot && (
          <img
            src={shot.url}
            alt="Your story"
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
      </div>

      <div className="shrink-0 px-6 pb-8 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="mb-3 text-center text-caption text-danger">
            {error}
          </p>
        )}

        {stage === 'review' || stage === 'posting' ? (
          <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
            <Button
              variant="primary"
              size="lg"
              block
              loading={stage === 'posting'}
              onClick={post}
            >
              Add to Story
            </Button>
            <Button
              variant="text"
              size="lg"
              block
              disabled={stage === 'posting'}
              onClick={() => {
                if (shot) URL.revokeObjectURL(shot.url);
                setShot(undefined);
                setStage('live');
              }}
              className="text-white hover:bg-white/10"
            >
              Retake
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-8">
            <Button
              variant="text"
              size="lg"
              onClick={() => fileRef.current?.click()}
              className="text-white hover:bg-white/10"
            >
              Gallery
            </Button>

            {/* The shutter: a ring around a disc, the shape every camera uses. */}
            <button
              type="button"
              onClick={capture}
              disabled={cameraAvailable !== true}
              aria-label="Take photo"
              className={cn(
                'grid size-18 place-items-center rounded-full',
                'ring-4 ring-white focus-ring',
                'transition-transform duration-instant ease-standard active:scale-[0.94]',
                'disabled:opacity-40',
              )}
            >
              <span className="size-14 rounded-full bg-white" />
            </button>

            <Button
              variant="text"
              size="lg"
              onClick={() => navigate('/chats')}
              className="text-white hover:bg-white/10"
            >
              Close
            </Button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
