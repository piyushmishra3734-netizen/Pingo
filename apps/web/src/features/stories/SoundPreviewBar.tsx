import type { StoryAudioDraft, StoryAudioTrack } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';

import { StorySound, soundLength } from './StorySound.js';
import { clock } from './story-audio.js';

/**
 * Hearing the story before posting it, from inside the editor.
 *
 * The sound sheet can play one piece at a time, which answers "is this the
 * right part of the song" and not "is this the right story". Those are
 * different questions: pieces start at different seconds, they sit under a
 * picture, and the whole thing has a length. This plays all of it, arranged,
 * over whatever is on screen - which for a photograph is the only way to hear
 * it at all, since a photograph does not play.
 *
 * ## The viewer's own player, borrowed
 *
 * `StorySound` is what a viewer will run, so it is what runs here: same
 * scheduling, same stopwatch, same treatment of a piece that starts at 0:04.
 * A second implementation for the preview would be a second thing to be wrong,
 * and the one place its wrongness could never be noticed is a preview.
 */

export function SoundPreviewBar({ audio }: { audio: StoryAudioDraft[] }) {
  const [playing, setPlaying] = useState(false);

  /*
   * Object URLs, made once per set of pieces and released with them. The blobs
   * are only bytes in memory until the story is posted, so this is the whole of
   * turning a draft into something an <audio> can be pointed at.
   */
  const tracks = useMemo<StoryAudioTrack[]>(
    () =>
      audio.map((piece) => ({
        url: URL.createObjectURL(piece.blob),
        at: piece.at,
        duration: piece.duration,
        volume: piece.volume,
      })),
    [audio],
  );

  useEffect(() => {
    return () => {
      for (const track of tracks) URL.revokeObjectURL(track.url);
    };
  }, [tracks]);

  // A new set of pieces is a new arrangement; it does not carry on playing.
  useEffect(() => setPlaying(false), [tracks]);

  const length = soundLength(tracks);

  // Stop when it reaches the end, so the button is never lying about playing.
  useEffect(() => {
    if (!playing || length <= 0) return;
    const timer = window.setTimeout(() => setPlaying(false), length * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, length]);

  if (tracks.length === 0) return null;

  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => setPlaying((on) => !on)}
        className={cn(
          'focus-ring flex items-center gap-2 rounded-full px-3.5 py-2',
          'border border-white/20 bg-white/10 text-caption font-medium text-white',
          'backdrop-blur-xl transition-transform duration-150 ease-standard active:scale-[0.97]',
        )}
      >
        <span aria-hidden className="grid size-4 place-items-center">
          {playing ? <StopGlyph /> : <PlayGlyph />}
        </span>
        {playing ? 'Stop' : 'Play sound'}
        <span className="text-white/60 tabular-nums">
          {tracks.length > 1 ? `${tracks.length} · ` : ''}
          {clock(length)}
        </span>
      </button>

      {/* Renders nothing; it is the playback itself. */}
      <StorySound storyId="preview" tracks={tracks} paused={!playing} />
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
