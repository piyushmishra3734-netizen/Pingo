import { cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';

import type { VideoEdit } from '@pingo/core';

import { clock } from './VideoPlayer.js';

/**
 * Choosing where a video starts, where it ends, and whether it speaks.
 *
 * ## It never touches the file
 *
 * Nothing here encodes anything. The sheet produces a `VideoEdit` - two marks
 * and a flag - which travels beside the original bytes and is applied by the
 * player. Trimming for real in a browser means re-encoding, and re-encoding
 * costs exactly the quality this app goes out of its way to keep.
 *
 * That makes the editor cheap enough to be instant on a phone, and it is why
 * there is no progress bar and no "processing" state: pressing Done is just
 * closing a sheet.
 *
 * ## Two handles, not a timeline
 *
 * A real timeline wants thumbnails along its length, which means decoding
 * frames at intervals - the one expensive thing this design avoids. Two range
 * inputs over a live preview give the same decision with none of that, and the
 * preview is the feedback: dragging a handle seeks the video to that mark, so
 * you are looking at the frame you are choosing rather than a strip of them.
 */

export interface VideoTrimSheetProps {
  /** Object URL for the file being sent. The sheet does not own it. */
  src: string;
  /** What the sender settled on. Absent means they cancelled. */
  onDone: (edit: VideoEdit | undefined) => void;
  /**
   * Marks the clip already carries, so re-opening resumes rather than resets.
   *
   * A story can be trimmed, put down, and picked up again from its thumbnail;
   * without this the second visit showed the whole file and the handles said
   * the trim had been forgotten - which, on pressing Done, it would have been.
   */
  initial?: VideoEdit;
  /** 'Send' in a chat, 'Done' when the clip is going back to an editor. */
  doneLabel?: string;
}

export function VideoTrimSheet({ src, onDone, initial, doneLabel = 'Send' }: VideoTrimSheetProps) {
  const video = useRef<HTMLVideoElement>(null);

  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(initial?.trimStart ?? 0);
  const [end, setEnd] = useState(initial?.trimEnd ?? 0);
  const [muted, setMuted] = useState(initial?.muted ?? false);

  /**
   * Which handle is being dragged, so the preview follows the right one.
   *
   * Without this the video would seek to `start` while somebody drags `end`,
   * and the frame under the thumb would be the wrong end of the clip.
   */
  const [holding, setHolding] = useState<'start' | 'end'>('start');

  useEffect(() => {
    const media = video.current;
    if (!media) return;
    media.currentTime = holding === 'start' ? start : end;
  }, [start, end, holding]);

  const ready = duration > 0;
  const span = Math.max(0, end - start);
  /** A clip has to be long enough to be a clip. */
  const tooShort = ready && span < 0.5;

  return (
    <Sheet title="Trim video" elevated onClose={() => onDone(undefined)}>
      <div className="relative mt-3 w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={video}
          src={src}
          playsInline
          muted
          preload="metadata"
          onLoadedMetadata={(event) => {
            const media = event.currentTarget;
            if (!Number.isFinite(media.duration)) return;
            setDuration(media.duration);
            // An end mark the clip already had wins over the file's own end.
            setEnd((current) => (current > 0 ? Math.min(current, media.duration) : media.duration));
          }}
          className="max-h-[45vh] w-full object-contain"
        />
      </div>

      {/*
        Two handles over one track.

        Stacked rather than side by side, because they describe the same line
        and a person reads them as one control - and because a single range
        input cannot express two thumbs without becoming a custom widget with
        its own keyboard story to get wrong.
      */}
      <div className="mt-4 space-y-3">
        <Handle
          label="Start"
          value={start}
          max={duration}
          disabled={!ready}
          onChange={(next) => {
            setHolding('start');
            // The handles may not cross. Half a second keeps the clip real.
            setStart(Math.min(next, Math.max(0, end - 0.5)));
          }}
        />
        <Handle
          label="End"
          value={end}
          max={duration}
          disabled={!ready}
          onChange={(next) => {
            setHolding('end');
            setEnd(Math.max(next, Math.min(duration, start + 0.5)));
          }}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-caption text-text-secondary tabular-nums">
          {ready ? `${clock(span)} of ${clock(duration)}` : 'Reading video…'}
        </span>

        <button
          type="button"
          onClick={() => setMuted((on) => !on)}
          className={cn(
            'focus-ring rounded-full px-3 py-1.5 text-caption font-medium',
            'transition-colors duration-instant',
            muted ? 'bg-brand-soft text-brand' : 'bg-sunken text-text-secondary',
          )}
        >
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => onDone(undefined)}
          className="focus-ring flex-1 rounded-xl bg-sunken py-2.5 text-body font-medium text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready || tooShort}
          onClick={() =>
            onDone({
              /*
               * Only what differs from the file is sent. A video nobody
               * trimmed carries no marks at all, so the common case adds
               * nothing to the message and the player has nothing to apply.
               */
              ...(start > 0 ? { trimStart: start } : {}),
              ...(end < duration ? { trimEnd: end } : {}),
              ...(muted ? { muted: true } : {}),
            })
          }
          className={cn(
            'focus-ring flex-1 rounded-xl py-2.5 text-body font-medium text-white',
            'bg-brand-gradient disabled:opacity-50',
          )}
        >
          {doneLabel}
        </button>
      </div>
    </Sheet>
  );
}

function Handle({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-caption text-text-secondary">{label}</span>
      <input
        type="range"
        min={0}
        max={max || 0}
        step="any"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="pingo-scrub h-1 min-w-0 flex-1 appearance-none rounded-full bg-line accent-brand"
      />
      <span className="w-12 shrink-0 text-right text-caption text-text-secondary tabular-nums">
        {clock(value)}
      </span>
    </label>
  );
}
