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
 * action row and the image on every frame - the fastest way to make a story
 * viewer stutter. The frame loop writes a ref and the bar reads it directly
 * through its own callback, so React runs once per *story*, not once per frame.
 *
 * ## Pausing is a count, not a flag
 *
 * A finger held on the screen pauses; so does an open menu, and so does a reply
 * box with the keyboard up. Those overlap - you can open the menu while still
 * holding - and a boolean would have the first release resume playback while
 * the menu is still covering the story. Counting reasons is what makes "resume
 * when the last one lets go" correct.
 */

export interface StoryPlayer {
  groupIndex: number;
  storyIndex: number;
  group: StoryGroup;
  /** 0-1 for the story now playing. Read inside a frame loop, not on render. */
  progressRef: React.RefObject<number>;
  paused: boolean;
  next: () => void;
  previous: () => void;
  /** Straight to the next or previous person - the swipe. Past either end closes. */
  jumpGroup: (dir: 1 | -1) => void;
  goTo: (index: number) => void;
  /** Adds one reason to stay paused; the returned function removes it. */
  hold: () => () => void;
  /** Videos drive their own clock - see `reportDuration`. */
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
  // Each person opens where you left off: their first story you have not seen, as the sample does.
  const firstUnseen = (g: number) => Math.max(0, groups[g]?.stories.findIndex((s) => !s.seen) ?? 0);
  const [storyIndex, setStoryIndex] = useState(() => firstUnseen(startGroupIndex));
  const [holds, setHolds] = useState(0);

  const progressRef = useRef(0);
  /** Overridden per story by a video reporting its real length. */
  const durationRef = useRef(STORY_PHOTO_MS);

  const group = groups[groupIndex] ?? groups[0]!;
  const story = group.stories[storyIndex];
  /*
   * The clock is keyed on *which* story, not on the story object.
   *
   * Objects here are rebuilt whenever anything about the rail changes - a like
   * landing, a story being marked seen. Restarting the timer on each of those
   * resets `last` to now, so the accumulated delta is always about zero and the
   * bar never fills. The id changes exactly when the clock should restart.
   */
  const storyId = story?.id;

  /*
   * Moves are computed from the current position and then set, rather than
   * one state setter being called inside another's updater: React runs
   * updaters twice in development, and a nested setter ran twice with it -
   * running off the end of one person skipped the next.
   */
  const next = useCallback(() => {
    progressRef.current = 0;
    durationRef.current = STORY_PHOTO_MS;
    const current = groups[groupIndex];
    if (current && storyIndex < current.stories.length - 1) { setStoryIndex(storyIndex + 1); return; }
    if (groupIndex < groups.length - 1) {
      setGroupIndex(groupIndex + 1);
      setStoryIndex(firstUnseen(groupIndex + 1));
      return;
    }
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, groupIndex, storyIndex, onClose]);

  const previous = useCallback(() => {
    progressRef.current = 0;
    durationRef.current = STORY_PHOTO_MS;
    if (storyIndex > 0) { setStoryIndex(storyIndex - 1); return; }
    if (groupIndex > 0) {
      const earlier = groups[groupIndex - 1];
      setGroupIndex(groupIndex - 1);
      setStoryIndex(Math.max(0, (earlier?.stories.length ?? 1) - 1));
    }
  }, [groups, groupIndex, storyIndex]);

  const jumpGroup = useCallback(
    (dir: 1 | -1) => {
      progressRef.current = 0;
      durationRef.current = STORY_PHOTO_MS;
      const target = groupIndex + dir;
      if (target < 0) return;
      if (target >= groups.length) {
        onClose();
        return;
      }
      setGroupIndex(target);
      setStoryIndex(firstUnseen(target));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups.length, groupIndex, onClose],
  );

  /** Straight to one of this person's stories. */
  const goTo = useCallback((index: number) => {
    progressRef.current = 0;
    durationRef.current = STORY_PHOTO_MS;
    setStoryIndex(index);
  }, []);

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
      /*
       * Clamped, and this is not defensive padding.
       *
       * `requestAnimationFrame` stops entirely in a hidden tab - which is the
       * reason it is used here, so a story does not run out while nobody is
       * looking. But it means the *first* frame after coming back carries the
       * whole time the tab was away: switch away for two minutes and that one
       * delta is 120,000ms, which completes this story and every story after it
       * in a single frame. You would return to find the rail empty and
       * everything marked seen.
       *
       * A frame longer than a quarter second did not happen; the clock was
       * suspended. Treating it as one ordinary frame is what makes coming back
       * resume where you left off.
       */
      const delta = Math.min(now - last, 250);
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
    jumpGroup,
    goTo,
    hold,
    reportDuration,
  };
}
