import { STORY_PHOTO_MS, type StoryGroup } from '@pingo/core';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Where playback is, and what moves it.
 *
 * ## Why the position is two numbers, not one
 *
 * A story queue is a queue of *people*, each holding a queue of stories, and
 * both matter: the progress bars are per person, and running off the end of one
 * person means starting the next rather than stopping. Flattening both into a
 * single index would make "which bar am I on" a division, and every bug in that
 * arithmetic a visible one.
 *
 * ## Why elapsed time is a ref that a frame loop reads
 *
 * The bar has to move sixty times a second and the rest of the viewer must not.
 * Holding elapsed time in state would re-render the header, the caption, the
 * action row and the image on every frame — the fastest way to make a story
 * viewer stutter. The frame loop writes a ref and the bar reads it directly
 * through its own callback, so React runs once per *story*, not once per frame.
 *
 * ## Pausing is a count, not a flag
 *
 * A finger held on the screen pauses; so does an open menu, and so does a reply
 * box with the keyboard up. Those overlap — you can open the menu while still
 * holding — and a boolean would have the first release resume playback while
 * the menu is still covering the story. Counting reasons is what makes "resume
 * when the last one lets go" correct.
 */

export interface StoryPlayer {
  groupIndex: number;
  storyIndex: number;
  group: StoryGroup;
  /** 0–1 for the story now playing. Read inside a frame loop, not on render. */
  progressRef: React.RefObject<number>;
  paused: boolean;
  next: () => void;
  previous: () => void;
  /** Adds one reason to stay paused; the returned function removes it. */
  hold: () => () => void;
  /** Videos drive their own clock — see `reportDuration`. */
  reportDuration: (ms: number) => void;
}

export function useStoryPlayer({
  groups,
  startGroupIndex,
  onClose,
}: {
  groups: StoryGroup[];
  startGroupIndex: number;
  onClose: () => void;
}): StoryPlayer {
  const [groupIndex, setGroupIndex] = useState(startGroupIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [holds, setHolds] = useState(0);

  const progressRef = useRef(0);
  /** Overridden per story by a video reporting its real length. */
  const durationRef = useRef(STORY_PHOTO_MS);

  const group = groups[groupIndex] ?? groups[0]!;
  const story = group.stories[storyIndex];
  /*
   * The clock is keyed on *which* story, not on the story object.
   *
   * Objects here are rebuilt whenever anything about the rail changes — a like
   * landing, a story being marked seen. Restarting the timer on each of those
   * resets `last` to now, so the accumulated delta is always about zero and the
   * bar never fills. The id changes exactly when the clock should restart.
   */
  const storyId = story?.id;

  const next = useCallback(() => {
    progressRef.current = 0;
    durationRef.current = STORY_PHOTO_MS;

    setStoryIndex((index) => {
      const current = groups[groupIndex];
      if (current && index < current.stories.length - 1) return index + 1;

      // Off the end of this person: start the next one, or leave.
      if (groupIndex < groups.length - 1) {
        setGroupIndex((g) => g + 1);
        return 0;
      }
      onClose();
      return index;
    });
  }, [groups, groupIndex, onClose]);

  const previous = useCallback(() => {
    progressRef.current = 0;
    durationRef.current = STORY_PHOTO_MS;

    setStoryIndex((index) => {
      if (index > 0) return index - 1;

      /*
       * Back past the first story goes to the *end* of the previous person,
       * which is what "back" means in a queue — not to their first story, which
       * would make going back feel like starting over.
       */
      if (groupIndex > 0) {
        const earlier = groups[groupIndex - 1];
        setGroupIndex((g) => g - 1);
        return Math.max(0, (earlier?.stories.length ?? 1) - 1);
      }
      // Already at the very start. Restart this story rather than doing
      // nothing, so the tap is never silently ignored.
      return 0;
    });
  }, [groups, groupIndex]);

  const hold = useCallback(() => {
    setHolds((count) => count + 1);
    let released = false;
    return () => {
      // Guarded: a pointerup and a pointercancel can both arrive for one press,
      // and releasing twice would leave the count below zero and playback
      // unpausable for the rest of the session.
      if (released) return;
      released = true;
      setHolds((count) => Math.max(0, count - 1));
    };
  }, []);

  const reportDuration = useCallback((ms: number) => {
    if (Number.isFinite(ms) && ms > 0) durationRef.current = ms;
  }, []);

  const paused = holds > 0;

  /*
   * The clock.
   *
   * Driven by `requestAnimationFrame` rather than an interval, so it is tied to
   * the compositor: a backgrounded tab stops advancing instead of racing
   * through somebody's whole story while nobody is looking, and the bar's
   * motion lands on real frames at whatever rate the display runs.
   */
  useEffect(() => {
    if (!storyId || paused) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = now - last;
      last = now;

      progressRef.current = Math.min(1, progressRef.current + delta / durationRef.current);

      if (progressRef.current >= 1) {
        next();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The id rather than the index: moving to the next person can leave the
    // index unchanged, and the clock must restart for the new story either way.
  }, [storyId, paused, next]);

  // A new story starts from the beginning, however it was reached.
  useEffect(() => {
    progressRef.current = 0;
  }, [storyId]);

  return {
    groupIndex,
    storyIndex,
    group,
    progressRef,
    paused,
    next,
    previous,
    hold,
    reportDuration,
  };
}
