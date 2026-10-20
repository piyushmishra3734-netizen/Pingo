import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface TvHlsPlayerProps {
  /** A direct `.m3u8` playlist. No iframe, so no page, no pop-ups. */
  src: string;
  title: string;
  poster?: string;
  /** Called once when the stream fails in a way it will not recover from. */
  onFail?: () => void;
}

/**
 * A plain `<video>`, with hls.js only where the browser needs it.
 *
 * This exists because the other sources are iframes: we hand a third party's
 * page the whole rectangle and hope. A resolver gives a playlist URL instead,
 * which means the page that served it — with its pop-unders, redirects and
 * scripts — is never loaded at all. That is the whole reason this player is
 * worth having.
 *
 * Safari plays HLS natively and gets the `src` directly. Everything else goes
 * through hls.js.
 */
export function TvHlsPlayer({ src, title, poster, onFail }: TvHlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const failRef = useRef(onFail);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError(null);

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return;
    }

    if (!Hls.isSupported()) {
      setError('This browser cannot play HLS streams.');
      return;
    }

    const hls = new Hls({ enableWorker: true, lowLatencyMode: false });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // A fatal network error on a live playlist is not worth a retry loop.
      const message =
        data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? 'This source did not load.'
          : 'This source stopped playing.';
      setError(message);
      failRef.current?.();
    });

    hls.loadSource(src);
    hls.attachMedia(video);

    return () => {
      hls.destroy();
    };
  }, [src]);

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        poster={poster}
        aria-label={`${title} stream`}
        className="h-full w-full bg-black"
      />

      {error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/80 px-6">
          <p className="max-w-sm text-center text-sm text-white/80">{error}</p>
        </div>
      )}
    </div>
  );
}

export default TvHlsPlayer;
