import { PauseIcon, PlayIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * PINGO's video player.
 *
 * The browser's own `controls` were here first and were the right thing while
 * this was a link preview - they come with a scrubber, fullscreen and
 * picture-in-picture already matching the platform. What they cannot do is look
 * like PINGO. A video somebody sent should sit in the thread the way a photo
 * does, and Chrome's grey control strip announces itself as the browser every
 * time, which is exactly the "not ours" feeling this replaces.
 *
 * So the element keeps the decoding and gives up the chrome.
 *
 * ## What is deliberately not reimplemented
 *
 * Buffering ranges, playback speed, captions, picture-in-picture. Each is a
 * real feature and none of them is what a one-minute clip in a chat needs; the
 * native menu is one long-press away for anybody who wants them. Scrubbing,
 * time, play and fullscreen are what people actually reach for, and those are
 * here.
 */

export interface VideoPlayerProps {
  src: string;
  /** Starts playing as soon as it can - set when the person already pressed play. */
  autoPlay?: boolean;
  /** Told the intrinsic shape once known, so the card can stop guessing. */
  onShape?: (ratio: number, seconds: number) => void;
  onError?: () => void;
  className?: string;
}

/** Seconds as `m:ss`, or `h:mm:ss` once there is an hour to show. */
export function clock(total: number): string {
  if (!Number.isFinite(total) || total < 0) return '0:00';
  const whole = Math.floor(total);
  const s = String(whole % 60).padStart(2, '0');
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function VideoPlayer({ src, autoPlay, onShape, onError, className }: VideoPlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [full, setFull] = useState(false);
  /**
   * Controls fade out while a video plays and come back on any touch.
   *
   * Held as a deadline rather than a boolean: every interaction pushes the
   * deadline out, so one timer serves all of them and moving the pointer twice
   * does not leave two of them racing to hide the bar.
   */
  const [wakeAt, setWakeAt] = useState(() => Date.now());
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    if (!playing) {
      setAwake(true);
      return;
    }
    setAwake(true);
    const timer = setTimeout(() => setAwake(false), 2200);
    return () => clearTimeout(timer);
  }, [playing, wakeAt]);

  /*
   * Fullscreen is tracked from the event, not from our own click.
   *
   * Escape, the system back gesture and Android's own dismissal all leave
   * fullscreen without going through the button, and a flag set on click would
   * still say "full" afterwards - leaving the exit icon on an inline video.
   */
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === shell.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = () => {
    const media = video.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  };

  const toggleFull = () => {
    type Legacy = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const box = shell.current;
    if (box?.requestFullscreen) void box.requestFullscreen().catch(() => undefined);
    // iPhone Safari refuses fullscreen on anything but a video element.
    else (video.current as Legacy | null)?.webkitEnterFullscreen?.();
  };

  const seekable = duration > 0;

  return (
    <div
      ref={shell}
      className={cn('absolute inset-0 bg-black', className)}
      onPointerMove={() => setWakeAt(Date.now())}
      onPointerDown={() => setWakeAt(Date.now())}
    >
      <video
        ref={video}
        src={src}
        // No `controls`: everything below is the replacement.
        autoPlay={autoPlay}
        preload="none"
        playsInline
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const media = event.currentTarget;
          if (Number.isFinite(media.duration)) setDuration(media.duration);
          if (media.videoWidth && media.videoHeight) {
            onShape?.(media.videoWidth / media.videoHeight, media.duration);
          }
        }}
        onEnded={() => setPlaying(false)}
        onError={onError}
        className={cn('size-full', full ? 'object-contain' : 'object-contain')}
      />

      {/*
        The big target, and the only control that matters before playback.
        It fades with the rest once a video is running, so a clip is not
        watched through a disc sitting in the middle of it.
      */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className={cn(
          'absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center',
          'rounded-full bg-black/45 text-white backdrop-blur-sm',
          'focus-ring transition-opacity duration-base ease-standard active:scale-95',
          playing && !awake ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        {playing ? <PauseIcon size={22} /> : <PlayIcon size={24} />}
      </button>

      <div
        className={cn(
          'absolute inset-x-0 bottom-0 flex items-center gap-2.5 px-2.5 pb-2',
          // A scrim rather than a bar: the controls stay legible over a bright
          // frame without putting a slab of grey across the picture.
          'bg-[linear-gradient(to_top,rgb(0_0_0/0.55),transparent)] pt-6',
          'transition-opacity duration-base ease-standard',
          playing && !awake ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        <span className="shrink-0 text-caption text-white/90 tabular-nums">{clock(current)}</span>

        {/*
          A range input, not a custom-drawn bar.

          It comes with keyboard seeking, the right touch target and a drag
          that already behaves on every platform - all of which a div would
          have to grow by hand, and get subtly wrong on one of them.
        */}
        <input
          type="range"
          min={0}
          max={seekable ? duration : 0}
          step="any"
          value={current}
          disabled={!seekable}
          aria-label="Seek"
          onChange={(event) => {
            const media = video.current;
            if (!media) return;
            media.currentTime = Number(event.target.value);
            setCurrent(media.currentTime);
            setWakeAt(Date.now());
          }}
          className="pingo-scrub h-1 min-w-0 flex-1 appearance-none rounded-full bg-white/30 accent-white"
        />

        <span className="shrink-0 text-caption text-white/90 tabular-nums">{clock(duration)}</span>

        <button
          type="button"
          onClick={toggleFull}
          aria-label={full ? 'Exit fullscreen' : 'Fullscreen'}
          className="focus-ring grid size-8 shrink-0 place-items-center rounded-full text-white active:scale-95"
        >
          <FullscreenIcon exit={full} />
        </button>
      </div>
    </div>
  );
}

/** Four corners, pointing out to enter and in to leave. */
function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {exit ? (
        <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3" />
      ) : (
        <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
      )}
    </svg>
  );
}
