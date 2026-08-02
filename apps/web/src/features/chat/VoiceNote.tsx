import { formatDuration, type AudioAttachment } from '@pingo/core';
import { PauseIcon, PlayIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * A voice note: play control, waveform, duration - as shown on the board.
 *
 * The waveform is precomputed in the data layer, so this component only draws it.
 * Bars fill left-to-right as playback advances, which makes the waveform double
 * as the progress bar instead of needing a separate track.
 *
 * ## Real audio, with the timer as a fallback
 *
 * Live notes carry a signed URL. We fetch bytes into a blob URL before playing
 * so receivers are not stuck on a signed URL that some mobile browsers refuse
 * to stream (range / content-type quirks). Seeded styleguide notes with no file
 * still run on the original timer so demos stay interactive.
 */

export interface VoiceNoteProps {
  attachment: AudioAttachment;
  /** Outgoing notes sit on the gradient and need light-on-dark treatment. */
  tone?: 'incoming' | 'outgoing';
  className?: string;
}

/** Playback tick. ~24fps is smooth for a bar that only ever grows. */
const TICK_MS = 40;

/** Default bars when the row arrived without a waveform (legacy / corrupt). */
const FALLBACK_WAVEFORM = Array.from({ length: 32 }, (_, i) =>
  0.25 + 0.35 * Math.abs(Math.sin(i * 0.55)),
);

export function VoiceNote({ attachment, tone = 'incoming', className }: VoiceNoteProps) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const outgoing = tone === 'outgoing';

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const remoteUrl = attachment.url?.trim() || '';
  const hasRemote = Boolean(remoteUrl);
  /** Resolved src actually on the <audio> element (blob: preferred). */
  const [playSrc, setPlaySrc] = useState<string>('');

  /**
   * Duration from the file once it is known.
   *
   * The recorder's own figure is a wall-clock measurement and can disagree with
   * the encoded length by a fraction of a second. The file is the truth, so the
   * bar does not stop short of the end or hang past it.
   */
  const [duration, setDuration] = useState(attachment.duration || 0);

  // Held in a ref so the interval callback never closes over a stale value.
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;

  const waveform =
    attachment.waveform && attachment.waveform.length > 0
      ? attachment.waveform
      : FALLBACK_WAVEFORM;

  // Fetch into a blob URL so playback does not depend on streaming quirks of
  // the storage CDN / signed URL on mobile browsers.
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setPlaySrc('');
    setElapsed(0);
    setPlaying(false);

    if (!remoteUrl) return;

    const previous = objectUrlRef.current;
    if (previous) {
      URL.revokeObjectURL(previous);
      objectUrlRef.current = null;
    }

    void (async () => {
      try {
        const response = await fetch(remoteUrl);
        if (!response.ok) throw new Error(`voice fetch ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        // Ensure a playable type even if storage returned octet-stream.
        const typed =
          blob.type && blob.type !== 'application/octet-stream'
            ? blob
            : new Blob([blob], { type: guessMimeFromUrl(remoteUrl) });
        const objectUrl = URL.createObjectURL(typed);
        objectUrlRef.current = objectUrl;
        setPlaySrc(objectUrl);
      } catch {
        // Fall back to the signed URL directly — still better than silence.
        if (!cancelled) {
          setPlaySrc(remoteUrl);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [remoteUrl]);

  const hasAudio = Boolean(playSrc);

  // The timer path, for fixtures with no file behind them.
  useEffect(() => {
    if (!playing || hasAudio || hasRemote) return;

    const id = setInterval(() => {
      const next = elapsedRef.current + TICK_MS / 1000;
      if (next >= duration) {
        setElapsed(0);
        setPlaying(false);
      } else {
        setElapsed(next);
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [playing, hasAudio, hasRemote, duration]);

  /*
   * Only one note plays at a time.
   *
   * Two overlapping voices is never what anyone wanted, and on a phone that
   * made a second note drown the first without the user noticing.
   */
  const stopOthers = () => {
    for (const other of document.querySelectorAll('audio')) {
      if (other !== audioRef.current) other.pause();
    }
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!hasAudio || !audio) {
      // Remote still loading — do not fake-play silence.
      if (hasRemote && !playSrc) return;
      setPlaying((p) => !p);
      return;
    }

    if (audio.paused) {
      stopOthers();
      // iOS / some WebViews need volume and a load before play after src change.
      audio.volume = 1;
      audio.muted = false;
      void audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => {
          setPlaying(false);
          setLoadError(true);
        });
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const progress = duration > 0 ? elapsed / duration : 0;

  const seekTo = (ratio: number) => {
    const at = Math.max(0, Math.min(1, ratio)) * duration;
    setElapsed(at);
    if (audioRef.current && Number.isFinite(at)) {
      try {
        audioRef.current.currentTime = at;
      } catch {
        // Some incomplete files refuse seeks until fully loaded.
      }
    }
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {hasAudio && (
        <audio
          ref={audioRef}
          src={playSrc}
          preload="auto"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const real = event.currentTarget.duration;
            if (Number.isFinite(real) && real > 0) setDuration(real);
            event.currentTarget.volume = 1;
            event.currentTarget.muted = false;
          }}
          onError={() => {
            setLoadError(true);
            setPlaying(false);
          }}
          onEnded={() => {
            setPlaying(false);
            setElapsed(0);
            if (audioRef.current) audioRef.current.currentTime = 0;
          }}
        />
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={hasRemote && !hasAudio && !loadError}
        aria-label={
          loadError
            ? 'Voice message unavailable'
            : playing
              ? 'Pause voice message'
              : 'Play voice message'
        }
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          'focus-ring transition-all duration-instant ease-standard active:scale-[0.94]',
          'disabled:opacity-50',
          outgoing
            ? 'bg-white/20 text-white hover:bg-white/30'
            : 'bg-brand-gradient text-white shadow-brand hover:shadow-lg',
        )}
      >
        {playing ? (
          <PauseIcon size={16} />
        ) : (
          // Optical centring: a play triangle's visual mass sits left of centre.
          <PlayIcon size={16} className="translate-x-px" />
        )}
      </button>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek voice message"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(elapsed)}
        aria-valuetext={
          loadError
            ? 'Unavailable'
            : `${formatDuration(elapsed)} of ${formatDuration(duration)}`
        }
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          seekTo((event.clientX - bounds.left) / bounds.width);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') seekTo((elapsed + 1) / duration);
          if (event.key === 'ArrowLeft') seekTo((elapsed - 1) / duration);
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            toggle();
          }
        }}
        className="focus-ring flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-[2px] rounded-sm"
      >
        {waveform.map((amplitude, index) => {
          const played = index / waveform.length <= progress;
          return (
            <span
              key={index}
              className={cn(
                /*
                 * Flexible width, capped at 3px. Fixed-width bars could not shrink,
                 * so on a narrow phone the waveform overflowed its container and
                 * ran into the duration label. Letting the bars compress keeps the
                 * whole waveform visible - and therefore proportional - at any width.
                 */
                'min-w-[2px] max-w-[3px] flex-1 rounded-full',
                'transition-colors duration-instant ease-standard',
                outgoing
                  ? played
                    ? 'bg-white'
                    : 'bg-white/35'
                  : played
                    ? 'bg-brand'
                    : 'bg-line-strong',
              )}
              // A 3px floor keeps silent passages visible as a hairline.
              style={{ height: `${Math.max(3, amplitude * 26)}px` }}
            />
          );
        })}
      </div>

      <span
        className={cn(
          'shrink-0 text-caption tabular-nums',
          outgoing ? 'text-white/80' : 'text-text-secondary',
        )}
      >
        {loadError
          ? '—'
          : formatDuration(playing || elapsed > 0 ? elapsed : duration)}
      </span>
    </div>
  );
}

function guessMimeFromUrl(url: string): string {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.m4a') || path.endsWith('.mp4')) return 'audio/mp4';
  if (path.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/webm';
}
