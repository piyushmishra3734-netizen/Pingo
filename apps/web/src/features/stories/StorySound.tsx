import type { StoryAudioTrack } from '@pingo/core';
import { useEffect, useRef } from 'react';

/**
 * Playing the sound somebody laid on a story.
 *
 * ## Scheduled against the story's own clock, not the audio's
 *
 * Each piece knows the second of the story it starts on, so playback is a
 * stopwatch: while the story runs, a piece whose moment has passed should be
 * playing from however far into it that moment was, and every other piece
 * should be silent. Checking that on a frame-ish interval is what makes pause,
 * resume, a held finger and a skipped-back story all behave without any of them
 * being handled separately - each is just the stopwatch stopping or resetting.
 *
 * The alternative, a timer per piece, needs cancelling and re-arming on every
 * one of those events, and gets it wrong the first time somebody holds their
 * thumb down for a minute.
 *
 * ## It renders nothing
 *
 * There is no control here on purpose. The story's sound is the author's
 * decision, the same as their choice of picture; the viewer's own volume
 * buttons are the volume control, and a mute toggle floating over every story
 * with music would be a permanent apology for having any.
 */

/** How often playback is compared against the clock. Well under a frame. */
const TICK_MS = 100;

export function StorySound({
  storyId,
  tracks,
  paused,
}: {
  /** Restarts everything when it changes: a new story is a new stopwatch. */
  storyId: string;
  tracks: StoryAudioTrack[];
  paused: boolean;
}) {
  const elements = useRef<HTMLAudioElement[]>([]);
  const elapsed = useRef(0);

  // Build one element per piece, and let go of them when the story changes.
  useEffect(() => {
    elapsed.current = 0;
    const made = tracks.map((track) => {
      const audio = new Audio(track.url);
      audio.preload = 'auto';
      audio.volume = Math.min(1, Math.max(0, track.volume));
      return audio;
    });
    elements.current = made;

    return () => {
      for (const audio of made) {
        audio.pause();
        // Chrome keeps buffering a detached element that still has a source.
        audio.removeAttribute('src');
        audio.load();
      }
      elements.current = [];
    };
  }, [storyId, tracks]);

  useEffect(() => {
    if (paused) {
      for (const audio of elements.current) audio.pause();
      return;
    }

    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      /*
       * Clamped for the same reason the progress clock is: a hidden tab
       * suspends timers, and the first tick back would otherwise carry the
       * whole absence and jump every piece to its end.
       */
      elapsed.current += Math.min(now - last, 250);
      last = now;

      const seconds = elapsed.current / 1000;
      tracks.forEach((track, index) => {
        const audio = elements.current[index];
        if (!audio) return;

        const into = seconds - track.at;
        const playing = into >= 0 && into < track.duration;

        if (!playing) {
          if (!audio.paused) audio.pause();
          return;
        }
        if (audio.paused) {
          // Starting late - a story resumed, or a piece that begins at 0:04 -
          // means starting at the right place inside it, not at its beginning.
          if (Math.abs(audio.currentTime - into) > 0.25) audio.currentTime = into;
          void audio.play().catch(() => undefined);
        }
      });
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [paused, tracks, storyId]);

  return null;
}

/** How long a story has to stay up for all of its sound to be heard. */
export function soundLength(tracks: StoryAudioTrack[] | undefined): number {
  if (!tracks || tracks.length === 0) return 0;
  return Math.max(...tracks.map((track) => track.at + track.duration));
}
