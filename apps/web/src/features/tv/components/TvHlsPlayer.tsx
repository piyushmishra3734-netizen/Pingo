import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface TvHlsPlayerProps {
  /** A direct `.m3u8` playlist. No iframe, so no page, no pop-ups. */
  src: string;
  title: string;
  poster?: string;
  /** Called once when the stream fails in a way it will not recover from. */
  onFail?: () => void;
  /**
   * Called the first time the picture is actually moving.
   *
   * The player uses it to stop shopping for a better source: switching after
   * playback has started restarts the film from the beginning, which is the
   * "it loads, then starts over" loop.
   */
  onPlaying?: () => void;
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
export function TvHlsPlayer({ src, title, poster, onFail, onPlaying }: TvHlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const failRef = useRef(onFail);
  const playingRef = useRef(onPlaying);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    failRef.current = onFail;
    playingRef.current = onPlaying;
  }, [onFail, onPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let announced = false;
    const announce = () => {
      if (announced) return;
      announced = true;
      playingRef.current?.();
    };

    video.addEventListener('playing', announce);
    return () => video.removeEventListener('playing', announce);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError(null);

    /*
     * hls.js first, and this order matters more than it looks.
     *
     * `canPlayType('application/vnd.apple.mpegurl')` answers "maybe" in Chrome
     * on Windows — a famously useless answer — so the previous order handed the
     * playlist to the native player, which has no HLS support on this platform.
     * The element then reported MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) and every
     * resolver source looked broken while the API was answering perfectly.
     *
     * Native playback is now only for browsers without MediaSource — Safari —
     * which is who it was ever meant for.
     */
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });

      /*
       * Some of these servers publish the same film twice: a 4K variant in HEVC
       * and lower ones in H.264. Chrome on Windows has no HEVC decoder, and
       * hls.js's adaptive picker will happily choose the HEVC variant on
       * bandwidth, so the level is pinned to the best H.264 variant instead.
       */
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const levels = hls.levels ?? [];
        if (!levels.length) return;

        const isH264 = (level: (typeof levels)[number]) =>
          /avc1/i.test(level.codecSet ?? level.videoCodec ?? '');

        const playable = levels
          .map((level, index) => ({ level, index }))
          .filter(({ level }) => isH264(level))
          .sort((a, b) => b.level.bitrate - a.level.bitrate);

        if (!playable.length) {
          setError('This source streams a format this browser cannot decode.');
          failRef.current?.();
          return;
        }

        hls.currentLevel = playable[0]!.index;
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
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
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return;
    }

    setError('This browser cannot play HLS streams.');
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
