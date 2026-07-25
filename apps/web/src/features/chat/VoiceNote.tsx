import { formatDuration, type AudioAttachment } from '@pingo/core';
import { PauseIcon, PlayIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * A voice note: play control, waveform, duration — as shown on the board.
 *
 * The waveform is precomputed in the data layer, so this component only draws it.
 * Bars fill left-to-right as playback advances, which makes the waveform double
 * as the progress bar instead of needing a separate track.
 *
 * The whole waveform is a slider: click or arrow-key anywhere to seek. A voice
 * note you cannot scrub is a voice note you have to listen to twice.
 *
 * There is no audio file behind the seeded notes, so playback is simulated on a
 * timer. `<audio>` slots in later without changing anything visible here.
 */

export interface VoiceNoteProps {
  attachment: AudioAttachment;
  /** Outgoing notes sit on the gradient and need light-on-dark treatment. */
  tone?: 'incoming' | 'outgoing';
  className?: string;
}

/** Playback tick. ~24fps is smooth for a bar that only ever grows. */
const TICK_MS = 40;

export function VoiceNote({ attachment, tone = 'incoming', className }: VoiceNoteProps) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const outgoing = tone === 'outgoing';

  // Held in a ref so the interval callback never closes over a stale value.
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;

  useEffect(() => {
    if (!playing) return;

    const id = setInterval(() => {
      const next = elapsedRef.current + TICK_MS / 1000;
      if (next >= attachment.duration) {
        // Reset to the start on completion, so the control is ready to replay.
        setElapsed(0);
        setPlaying(false);
      } else {
        setElapsed(next);
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [playing, attachment.duration]);

  const progress = attachment.duration > 0 ? elapsed / attachment.duration : 0;

  const seekTo = (ratio: number) => {
    setElapsed(Math.max(0, Math.min(1, ratio)) * attachment.duration);
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          'focus-ring transition-all duration-instant ease-standard active:scale-[0.94]',
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
        aria-valuemax={Math.round(attachment.duration)}
        aria-valuenow={Math.round(elapsed)}
        aria-valuetext={`${formatDuration(elapsed)} of ${formatDuration(attachment.duration)}`}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          seekTo((event.clientX - bounds.left) / bounds.width);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') seekTo((elapsed + 1) / attachment.duration);
          if (event.key === 'ArrowLeft') seekTo((elapsed - 1) / attachment.duration);
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            setPlaying((p) => !p);
          }
        }}
        className="focus-ring flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-[2px] rounded-sm"
      >
        {attachment.waveform.map((amplitude, index) => {
          const played = index / attachment.waveform.length <= progress;
          return (
            <span
              key={index}
              className={cn(
                /*
                 * Flexible width, capped at 3px. Fixed-width bars could not shrink,
                 * so on a narrow phone the waveform overflowed its container and
                 * ran into the duration label. Letting the bars compress keeps the
                 * whole waveform visible — and therefore proportional — at any width.
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
        {/* Counts up while playing, shows total when idle. */}
        {formatDuration(playing || elapsed > 0 ? elapsed : attachment.duration)}
      </span>
    </div>
  );
}
