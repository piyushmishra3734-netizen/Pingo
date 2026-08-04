import { formatDuration } from '@pingo/core';
import { CloseIcon, MicIcon, SendIcon, cn } from '@pingo/ui';

import type { VoiceRecorder } from './useVoiceRecorder.js';

/**
 * What the composer becomes while a voice note is being recorded.
 *
 * ## Tap to start, tap to send - not hold-to-talk
 *
 * Hold-to-talk is what phones do, and it is miserable everywhere else: it means
 * a mouse button held down for a minute, and on touch it fails whenever a
 * notification steals the gesture. Tapping is also the only version that works
 * for someone who cannot hold a press steady. The cost is one extra tap; the
 * gain is a control that behaves the same on every device, which is the same
 * argument as docs/13 § 4.5.
 *
 * ## Cancel is as large as send
 *
 * Discarding is the commoner outcome - most recordings are restarted - so it
 * gets a real target rather than a small × in a corner.
 */

export interface VoiceRecorderBarProps {
  recorder: VoiceRecorder;
  onSend: () => void;
}

export function VoiceRecorderBar({ recorder, onSend }: VoiceRecorderBarProps) {
  const { elapsed, level, capped, cancel } = recorder;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-3 rounded-xl',
        'border border-line bg-sunken px-3 py-2',
      )}
    >
      <button
        type="button"
        aria-label="Discard recording"
        onClick={cancel}
        className={cn(
          'focus-ring touch-target grid size-9 shrink-0 place-items-center rounded-full',
          'text-text-secondary transition-colors duration-instant hover:bg-hover hover:text-danger',
        )}
      >
        <CloseIcon size={18} />
      </button>

      {/*
        A live level, not a decorative pulse. A recording that hears nothing
        looks identical to one that is working until it is too late to redo, and
        this is the only thing on screen that can say otherwise.
      */}
      <span
        aria-hidden
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full',
          // At the ceiling the microphone has genuinely been let go of, so the
          // indicator stops looking live rather than lying about it.
          capped ? 'bg-sunken text-text-tertiary' : 'bg-danger/15 text-danger',
        )}
        style={capped ? undefined : { transform: `scale(${1 + Math.min(level, 1) * 0.22})` }}
      >
        <MicIcon size={16} />
      </span>

      <span
        className="min-w-0 flex-1 text-body text-ink tabular-nums"
        // Announced sparingly: every tenth of a second would be unusable.
        aria-live="off"
      >
        {formatDuration(elapsed)}
      </span>

      {/*
        "Recording" has to stop being true when it stops being true. At the
        five-minute ceiling capture is over and the microphone is released — the
        word for that is not "Recording", and leaving it there is how somebody
        keeps talking into a device that stopped listening.
      */}
      <span className="shrink-0 text-caption text-text-tertiary">
        {capped ? 'Maximum length' : 'Recording'}
      </span>

      <button
        type="button"
        aria-label="Send voice message"
        onClick={onSend}
        className={cn(
          'focus-ring touch-target grid size-9 shrink-0 place-items-center rounded-full',
          'bg-brand-gradient text-white shadow-brand',
          'transition-transform duration-instant active:scale-[0.96]',
        )}
      >
        <SendIcon size={17} className="-translate-x-px translate-y-px" />
      </button>
    </div>
  );
}
