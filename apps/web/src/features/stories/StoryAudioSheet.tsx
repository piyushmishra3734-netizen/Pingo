import type { StoryAudioDraft } from '@pingo/core';
import { CloseIcon, ImageIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { useVoiceRecorder } from '../chat/useVoiceRecorder.js';
import { MAX_TRACK_SECONDS, clock, cutToWav, decodeSound } from './story-audio.js';

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
  const recorder = useVoiceRecorder();

  /** The one piece being auditioned, so two never play over each other. */
  const preview = useRef<{ context: AudioContext; node: AudioBufferSourceNode } | undefined>(
    undefined,
  );

  const stopPreview = () => {
    const playing = preview.current;
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
      const source: Source = { id: crypto.randomUUID(), name, buffer };
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
    node.start(0, piece.from, Math.max(0.05, piece.to - piece.from));
    node.onended = () => stopPreview();
    preview.current = { context, node };
  };

  const finish = () => {
    stopPreview();
    setBusy('Preparing the sound…');
    try {
      const made = pieces.flatMap((piece): StoryAudioDraft[] => {
        const source = sourceOf(piece);
        const length = piece.to - piece.from;
        if (!source || length < 0.2) return [];
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

  return (
    <Sheet
      title="Sound"
      description="Music, your own voice, or the sound taken out of another clip."
      elevated
      onClose={onClose}
    >
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*"
        className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void addSource(file);
        }}
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={Boolean(busy) || recorder.recording}
          className={cn(
            'focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl',
            'bg-sunken py-3 text-caption font-medium text-ink',
            'transition-transform duration-instant active:scale-[0.98] disabled:opacity-50',
          )}
        >
          <ImageIcon size={16} />
          From a file
        </button>
        <button
          type="button"
          onClick={() => void record()}
          disabled={Boolean(busy)}
          className={cn(
            'focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl py-3',
            'text-caption font-medium',
            'transition-transform duration-instant active:scale-[0.98] disabled:opacity-50',
            recorder.recording ? 'bg-danger text-white' : 'bg-sunken text-ink',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-2 rounded-full',
              recorder.recording ? 'animate-pulse bg-white' : 'bg-danger',
            )}
          />
          {recorder.recording ? `Stop · ${clock(recorder.elapsed)}` : 'Record voice'}
        </button>
      </div>

      <p className="mt-2 px-0.5 text-caption text-text-tertiary">
        A video works too - only its sound is taken, not the picture.
      </p>

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
                max={Math.max(storyLength, track.at + 5)}
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
            const length = piece.to - piece.from;

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

                <Slider
                  label="In"
                  value={piece.from}
                  max={source.buffer.duration}
                  display={clock(piece.from)}
                  onChange={(next) =>
                    setPieces((all) =>
                      all.map((p) =>
                        p.id === piece.id
                          ? {
                              ...p,
                              from: Math.min(next, p.to - 0.2),
                              // The ends may not cross, and a piece may not run
                              // longer than a story is worth watching.
                              to: Math.min(p.to, Math.min(next, p.to - 0.2) + MAX_TRACK_SECONDS),
                            }
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
                          ? {
                              ...p,
                              to: Math.max(
                                p.from + 0.2,
                                Math.min(next, p.from + MAX_TRACK_SECONDS),
                              ),
                            }
                          : p,
                      ),
                    )
                  }
                />
                <Slider
                  label="Starts at"
                  value={piece.at}
                  max={Math.max(storyLength, piece.at + 5)}
                  display={clock(piece.at)}
                  onChange={(next) =>
                    setPieces((all) =>
                      all.map((p) => (p.id === piece.id ? { ...p, at: next } : p)),
                    )
                  }
                />
                <Slider
                  label="Volume"
                  value={piece.volume}
                  max={1}
                  display={`${Math.round(piece.volume * 100)}%`}
                  onChange={(next) =>
                    setPieces((all) =>
                      all.map((p) => (p.id === piece.id ? { ...p, volume: next } : p)),
                    )
                  }
                />

                {/*
                  Split, which is how a second sound gets into the middle of the
                  first one: cut here, and the half after the cut becomes its own
                  piece that can be removed and replaced.
                */}
                <button
                  type="button"
                  disabled={length < 0.6}
                  onClick={() => {
                    const middle = piece.from + length / 2;
                    setPieces((all) => {
                      const index = all.findIndex((p) => p.id === piece.id);
                      if (index < 0) return all;
                      const first = { ...piece, to: middle };
                      const second: Piece = {
                        ...piece,
                        id: crypto.randomUUID(),
                        from: middle,
                        at: Math.round((piece.at + length / 2) * 10) / 10,
                      };
                      return [...all.slice(0, index), first, second, ...all.slice(index + 1)];
                    });
                  }}
                  className={cn(
                    'focus-ring mt-2 w-full rounded-xl bg-sunken py-2',
                    'text-caption font-medium text-text-secondary',
                    'transition-transform duration-instant active:scale-[0.99]',
                    'disabled:opacity-40',
                  )}
                >
                  Split in two
                </button>
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
    <label className="mt-2 flex items-center gap-3">
      <span className="w-16 shrink-0 text-caption text-text-secondary">{label}</span>
      <input
        type="range"
        min={0}
        max={max || 1}
        step="any"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="pingo-scrub h-1 min-w-0 flex-1 appearance-none rounded-full bg-line accent-brand"
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
