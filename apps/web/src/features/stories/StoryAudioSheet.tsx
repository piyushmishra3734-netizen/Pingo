import type { StoryAudioDraft } from '@pingo/core';
import { CloseIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { useVoiceRecorder } from '../chat/useVoiceRecorder.js';
import {
  MAX_STORY_SECONDS,
  MAX_TRACK_SECONDS,
  MIN_PIECE_SECONDS,
  clock,
  cutToWav,
  decodeSound,
  peaksOf,
  trimIn,
  trimOut,
} from './story-audio.js';

/**
 * Putting sound on a story: what to play, from where, and how loud.
 *
 * ## Pieces on a line, not one soundtrack
 *
 * Everything here is a list of pieces, each with the stretch of its source it
 * uses and the second of the story it starts on. That single shape is what
 * makes the operations people actually ask for fall out for free: trimming is
 * moving the ends of a piece, splitting is one piece becoming two, and
 * "put a different sound in the gap" is adding a piece that starts there.
 *
 * A timeline with a playhead and drag-to-place blocks would be the other way to
 * express it, and it is the wrong one on a phone: the whole story is fifteen
 * seconds, the pieces are two or three, and a fingertip is nine millimetres.
 * Numbers on rows are read at a glance and are impossible to fumble.
 *
 * ## Nothing is uploaded until Done
 *
 * Sources are decoded once and kept as samples; a piece is only turned into a
 * file when the sheet closes. So dragging a trim handle costs nothing, and
 * changing your mind six times costs nothing six times.
 */

/** A source somebody picked, kept decoded for as long as the sheet is open. */
interface Source {
  id: string;
  name: string;
  buffer: AudioBuffer;
  /** Its shape, measured once - see `peaksOf`. */
  peaks: number[];
}

/** One piece of that source, placed on the story. */
interface Piece {
  id: string;
  sourceId: string;
  /** Seconds into the source. */
  from: number;
  to: number;
  /** Seconds into the story. */
  at: number;
  volume: number;
}

export function StoryAudioSheet({
  audio,
  onDone,
  onClose,
}: {
  /** What the story already carries, so re-opening resumes rather than resets. */
  audio: StoryAudioDraft[];
  onDone: (audio: StoryAudioDraft[]) => void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  /**
   * Pieces already posted-shaped, kept whole.
   *
   * Re-opening the sheet after adding sound cannot decode what was added - the
   * blob is a cut file, not the song it came from - and re-decoding it to allow
   * a second trim would let somebody trim a trim, which is a way to lose audio
   * a slice at a time. They are listed, they can be removed, and they can be
   * moved and made quieter; changing where they *cut* means picking the file
   * again, which is the honest version of that.
   */
  const [kept, setKept] = useState<StoryAudioDraft[]>(audio);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();

  /** The one piece being auditioned, so two never play over each other. */
  const preview = useRef<
    | {
        context: AudioContext;
        node: AudioBufferSourceNode;
        gain: GainNode;
        pieceId: string;
      }
    | undefined
  >(undefined);

  /**
   * The moving line, written straight to the DOM.
   *
   * Sixty renders a second of a list of sliders to move one line two pixels is
   * the wrong trade, and it is the trade that makes an editor feel heavy. The
   * frame loop writes the line's position and the readout's text directly -
   * the same thing the story progress bar does, for the same reason.
   */
  const frame = useRef(0);

  const stopPreview = () => {
    cancelAnimationFrame(frame.current);
    const playing = preview.current;
    document.querySelectorAll('[data-playhead]').forEach((line) => {
      (line as HTMLElement).style.opacity = '0';
    });
    /*
     * The readout goes back to saying what is chosen.
     *
     * It is written by the frame loop rather than by React, so React will not
     * put it back on its own - and a strip that stopped playing while still
     * reading "0:04 / 0:07" says playback is stuck rather than finished.
     */
    document.querySelectorAll<HTMLElement>('[data-elapsed]').forEach((readout) => {
      const chosen = readout.dataset.chosen;
      if (chosen) readout.textContent = chosen;
    });
    if (!playing) return;
    preview.current = undefined;
    try {
      playing.node.stop();
    } catch {
      // Already finished. Nothing to stop, nothing to report.
    }
    void playing.context.close();
  };

  useEffect(() => stopPreview, []);

  const sourceOf = (piece: Piece) => sources.find((source) => source.id === piece.sourceId);

  /** Where a new piece lands: after everything already placed. */
  const nextStart = () => {
    const ends = [
      ...kept.map((track) => track.at + track.duration),
      ...pieces.map((piece) => piece.at + (piece.to - piece.from)),
    ];
    return ends.length > 0 ? Math.round(Math.max(...ends) * 10) / 10 : 0;
  };

  const addSource = async (file: File) => {
    setError(undefined);
    setBusy('Reading the sound…');
    try {
      const { name, buffer } = await decodeSound(file);
      const source: Source = { id: crypto.randomUUID(), name, buffer, peaks: peaksOf(buffer) };
      setSources((all) => [...all, source]);
      setPieces((all) => [
        ...all,
        {
          id: crypto.randomUUID(),
          sourceId: source.id,
          from: 0,
          to: Math.min(buffer.duration, MAX_TRACK_SECONDS),
          at: nextStart(),
          // Under a picture rather than over it. Loud enough to be the point,
          // quiet enough that the clip's own sound is still there.
          volume: 0.8,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read.');
    } finally {
      setBusy(undefined);
    }
  };

  const record = async () => {
    setError(undefined);
    if (recorder.recording) {
      const take = await recorder.stop();
      if (!take) return;
      await addSource(new File([take.blob], 'Voice.wav', { type: 'audio/wav' }));
      return;
    }
    stopPreview();
    await recorder.start();
  };

  const play = (piece: Piece) => {
    const source = sourceOf(piece);
    if (!source) return;
    stopPreview();

    const context = new AudioContext();
    const node = context.createBufferSource();
    node.buffer = source.buffer;
    const gain = context.createGain();
    gain.gain.value = piece.volume;
    node.connect(gain).connect(context.destination);
    const span = Math.max(0.05, piece.to - piece.from);
    node.start(0, piece.from, span);
    node.onended = () => stopPreview();
    preview.current = { context, node, gain, pieceId: piece.id };

    // Where in the piece it has got to, on the strip and in words.
    const line = document.querySelector<HTMLElement>(`[data-playhead="${piece.id}"]`);
    const readout = document.querySelector<HTMLElement>(`[data-elapsed="${piece.id}"]`);
    const startedAt = context.currentTime;
    const tick = () => {
      if (preview.current?.node !== node) return;
      const into = Math.min(span, context.currentTime - startedAt);
      if (line) {
        line.style.opacity = '1';
        line.style.left = `${((piece.from + into) / source.buffer.duration) * 100}%`;
      }
      if (readout) readout.textContent = `${clock(into)} / ${clock(span)}`;
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const finish = () => {
    stopPreview();
    setBusy('Preparing the sound…');
    try {
      const made = pieces.flatMap((piece): StoryAudioDraft[] => {
        const source = sourceOf(piece);
        const length = piece.to - piece.from;
        /*
         * The margin is not slack, it is subtraction.
         *
         * A piece trimmed exactly to the minimum has ends like 19.8 and 20,
         * whose difference in binary comes out a hair *under* two tenths - so
         * the shortest piece anybody could deliberately make was the one piece
         * that vanished silently on Done.
         */
        if (!source || length < MIN_PIECE_SECONDS - 0.001) return [];
        return [
          {
            blob: cutToWav(source.buffer, piece.from, piece.to),
            at: piece.at,
            duration: length,
            volume: piece.volume,
          },
        ];
      });
      onDone([...kept, ...made]);
    } catch {
      setError('That sound could not be prepared. Try a shorter piece.');
      setBusy(undefined);
    }
  };

  const total = [...kept.map((k) => k.at + k.duration), ...pieces.map((p) => p.at + (p.to - p.from))];
  const storyLength = total.length > 0 ? Math.max(...total) : 0;
  const tooLong = storyLength > MAX_STORY_SECONDS;

  return (
    <Sheet
      title="Sound"
      description="Music, your own voice, or the sound taken out of another clip."
      elevated
      onClose={onClose}
    >
      {/*
        Two inputs rather than one that accepts both.

        The same decoder handles a song and a video, so one file picker would
        do the job - and nobody would ever find it. "Take the sound out of this
        video" is a thing people come here already meaning to do, and a picker
        that opens straight into their videos is what says it can be done.
      */}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void addSource(file);
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void addSource(file);
        }}
      />

      <div className="mt-3 grid grid-cols-3 gap-2">
        <SourceButton
          icon={<NoteGlyph />}
          label="Music"
          hint="An audio file"
          disabled={Boolean(busy) || recorder.recording}
          onClick={() => fileRef.current?.click()}
        />
        <SourceButton
          icon={<FilmGlyph />}
          label="From video"
          hint="Sound only"
          disabled={Boolean(busy) || recorder.recording}
          onClick={() => videoRef.current?.click()}
        />
        <SourceButton
          icon={
            <span
              aria-hidden
              className={cn(
                'size-2.5 rounded-full',
                recorder.recording ? 'animate-pulse bg-white' : 'bg-danger',
              )}
            />
          }
          label={recorder.recording ? 'Stop' : 'Voice'}
          hint={recorder.recording ? clock(recorder.elapsed) : 'Record'}
          tone={recorder.recording ? 'recording' : 'normal'}
          disabled={Boolean(busy)}
          onClick={() => void record()}
        />
      </div>

      <p className="mt-2 px-0.5 text-caption text-text-tertiary">
        A video gives up only its sound - the picture stays where it is.
        {storyLength > 0 && ` This story runs ${clock(Math.min(storyLength, MAX_STORY_SECONDS))}.`}
      </p>

      {/*
        Said before Done rather than silently trimmed at playback: a story that
        stops before its last piece has been heard looks like the sound broke,
        and the fix - move something, or shorten it - is only available here.
      */}
      {tooLong && (
        <p className="mt-2 text-caption text-warning">
          A story stops at {clock(MAX_STORY_SECONDS)}. Anything after that will not be heard.
        </p>
      )}

      {(error || recorder.error) && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error ?? recorder.error}
        </p>
      )}

      {kept.length === 0 && pieces.length === 0 ? (
        <p className="mt-5 text-center text-caption text-text-tertiary">
          Nothing yet. The story plays with its own sound.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {kept.map((track, index) => (
            <li key={`kept-${index}`} className="rounded-2xl bg-surface p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  Sound {index + 1}
                </span>
                <span className="shrink-0 text-caption text-text-secondary tabular-nums">
                  {clock(track.duration)}
                </span>
                <RemoveButton
                  label="Remove sound"
                  onClick={() => setKept((all) => all.filter((_, i) => i !== index))}
                />
              </div>
              <Slider
                label="Starts at"
                value={track.at}
                max={MAX_STORY_SECONDS}
                display={clock(track.at)}
                onChange={(next) =>
                  setKept((all) => all.map((t, i) => (i === index ? { ...t, at: next } : t)))
                }
              />
              <Slider
                label="Volume"
                value={track.volume}
                max={1}
                display={`${Math.round(track.volume * 100)}%`}
                onChange={(next) =>
                  setKept((all) => all.map((t, i) => (i === index ? { ...t, volume: next } : t)))
                }
              />
            </li>
          ))}

          {pieces.map((piece) => {
            const source = sourceOf(piece);
            if (!source) return null;

            return (
              <li key={piece.id} className="rounded-2xl bg-surface p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{source.name}</span>
                  <button
                    type="button"
                    onClick={() => play(piece)}
                    className={cn(
                      'focus-ring shrink-0 rounded-full bg-brand-soft px-3 py-1',
                      'text-caption font-semibold text-brand',
                    )}
                  >
                    Play
                  </button>
                  <RemoveButton
                    label={`Remove ${source.name}`}
                    onClick={() => setPieces((all) => all.filter((p) => p.id !== piece.id))}
                  />
                </div>

                <WaveStrip
                  id={piece.id}
                  peaks={source.peaks}
                  duration={source.buffer.duration}
                  from={piece.from}
                  to={piece.to}
                />

                {/*
                  The ends may not cross and the piece may not outrun what a
                  story will hold; both rules live in `trimIn` / `trimOut`,
                  where they can be run rather than dragged.
                */}
                <Slider
                  label="In"
                  value={piece.from}
                  max={source.buffer.duration}
                  display={clock(piece.from)}
                  onChange={(next) =>
                    setPieces((all) =>
                      all.map((p) =>
                        p.id === piece.id
                          ? { ...p, ...trimIn(p, next, source.buffer.duration) }
                          : p,
                      ),
                    )
                  }
                />
                <Slider
                  label="Out"
                  value={piece.to}
                  max={source.buffer.duration}
                  display={clock(piece.to)}
                  onChange={(next) =>
                    setPieces((all) =>
                      all.map((p) =>
                        p.id === piece.id
                          ? { ...p, ...trimOut(p, next, source.buffer.duration) }
                          : p,
                      ),
                    )
                  }
                />
                <Slider
                  label="Starts at"
                  value={piece.at}
                  max={MAX_STORY_SECONDS}
                  display={clock(piece.at)}
                  onChange={(next) =>
                    setPieces((all) =>
                      all.map((p) => (p.id === piece.id ? { ...p, at: next } : p)),
                    )
                  }
                />
                {/*
                  Volume is heard while it is being dragged.

                  It used to be read once, when Play was pressed, so moving the
                  slider during playback did nothing and moving it before
                  playback meant pressing Play again to find out - which is the
                  same as it not working. The gain node is held open and written
                  to directly, so the sound changes under the finger.
                */}
                <Slider
                  label="Volume"
                  value={piece.volume}
                  max={1}
                  display={`${Math.round(piece.volume * 100)}%`}
                  onChange={(next) => {
                    if (preview.current?.pieceId === piece.id) {
                      preview.current.gain.gain.value = next;
                    }
                    setPieces((all) =>
                      all.map((p) => (p.id === piece.id ? { ...p, volume: next } : p)),
                    );
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => {
            stopPreview();
            recorder.cancel();
            onClose();
          }}
          className="focus-ring flex-1 rounded-xl bg-sunken py-2.5 text-body font-medium text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={finish}
          disabled={Boolean(busy) || recorder.recording}
          className={cn(
            'focus-ring flex-1 rounded-xl py-2.5 text-body font-medium text-white',
            'bg-brand-gradient disabled:opacity-50',
          )}
        >
          {busy ?? 'Done'}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The sound, drawn: its shape, the part that was chosen, and where playback is.
 *
 * Everything outside the chosen part stays visible but dim rather than being
 * cut away, because the decision being made is *which* part - and you cannot
 * make it while looking only at what you have already picked.
 */
function WaveStrip({
  id,
  peaks,
  duration,
  from,
  to,
}: {
  id: string;
  peaks: number[];
  duration: number;
  from: number;
  to: number;
}) {
  const left = duration > 0 ? (from / duration) * 100 : 0;
  const width = duration > 0 ? ((to - from) / duration) * 100 : 100;

  return (
    <div className="mt-2">
      <div className="relative h-14 overflow-hidden rounded-xl bg-sunken">
        {/* The chosen stretch, lit from behind. */}
        <span
          aria-hidden
          className="absolute inset-y-0 bg-brand-soft"
          style={{ left: `${left}%`, width: `${width}%` }}
        />

        <svg
          viewBox="0 0 200 40"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          aria-hidden
        >
          {peaks.map((peak, index) => {
            const seconds = (index / peaks.length) * duration;
            const inside = seconds >= from && seconds <= to;
            // A floor, so silence still reads as a strip of sound rather than
            // a gap where the waveform failed to draw.
            const height = Math.max(1.5, peak * 36);
            return (
              <rect
                key={index}
                x={index + 0.15}
                y={20 - height / 2}
                width={0.7}
                height={height}
                className={inside ? 'fill-brand' : 'fill-text-tertiary'}
              />
            );
          })}
        </svg>

        {/* Where playback has got to. Hidden until something is playing. */}
        <span
          data-playhead={id}
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-ink opacity-0 transition-opacity duration-instant"
          style={{ left: '0%' }}
        />
      </div>

      <div className="mt-1 flex items-center justify-between px-0.5">
        <span className="text-[0.6875rem] text-text-tertiary tabular-nums">{clock(0)}</span>
        <span
          data-elapsed={id}
          data-chosen={`${clock(to - from)} chosen`}
          className="text-[0.6875rem] font-medium text-text-secondary tabular-nums"
        >
          {clock(to - from)} chosen
        </span>
        <span className="text-[0.6875rem] text-text-tertiary tabular-nums">{clock(duration)}</span>
      </div>
    </div>
  );
}

/** One way to get sound in: a glyph, what it is, and what it costs to try. */
function SourceButton({
  icon,
  label,
  hint,
  tone = 'normal',
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  tone?: 'normal' | 'recording';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'focus-ring flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-3',
        'transition-transform duration-instant active:scale-[0.97] disabled:opacity-50',
        tone === 'recording' ? 'bg-danger text-white' : 'bg-sunken text-ink',
      )}
    >
      <span className="grid h-5 place-items-center">{icon}</span>
      <span className="text-caption font-medium">{label}</span>
      <span
        className={cn(
          'text-[0.6875rem]',
          tone === 'recording' ? 'text-white/80 tabular-nums' : 'text-text-tertiary',
        )}
      >
        {hint}
      </span>
    </button>
  );
}

/** A note, for the music that is already a file. */
function NoteGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  );
}

/** A strip of film, for the clip somebody wants the song out of. */
function FilmGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h4M3 15h4M17 9h4M17 15h4M8.5 4v16" />
    </svg>
  );
}

/** A labelled range with its value shown, which every row here needs. */
function Slider({
  label,
  value,
  max,
  display,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  onChange: (next: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-16 shrink-0 text-caption text-text-secondary">{label}</span>
      {/*
        A finger is nine millimetres and the track was one. The bar still looks
        like a thin line - the padded box around it is what the thumb actually
        lands on, which is the difference between a control that works on a
        phone and one that reports back as broken.
      */}
      <input
        type="range"
        min={0}
        max={max || 1}
        step="any"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(
          'pingo-scrub min-w-0 flex-1 touch-none appearance-none bg-transparent',
          'h-9 py-4 accent-brand',
          '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full',
          '[&::-webkit-slider-runnable-track]:bg-line',
          '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line',
        )}
      />
      <span className="w-12 shrink-0 text-right text-caption text-text-secondary tabular-nums">
        {display}
      </span>
    </label>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'focus-ring grid size-7 shrink-0 place-items-center rounded-full',
        'bg-sunken text-text-secondary transition-colors duration-instant hover:text-danger',
      )}
    >
      <CloseIcon size={14} />
    </button>
  );
}
