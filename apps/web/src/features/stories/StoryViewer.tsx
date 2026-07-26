import type { StoryGroup } from '@pingo/core';
import { Avatar, CloseIcon, IconButton, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * Fullscreen story playback.
 *
 * Tap right to advance, tap left to go back, and a segmented bar across the top
 * shows where you are in the sequence — the grammar everyone already knows, so
 * there is nothing to learn.
 *
 * ## Advancing is manual
 *
 * There is no auto-advance timer. A timed story is a story you can lose by
 * blinking, and re-opening to find the thing you were reading has gone is a
 * worse failure than one extra tap. The segments show position, not a
 * countdown.
 *
 * Escape closes, arrow keys move — the viewer is usable from a keyboard, which
 * a tap-only implementation would not be.
 */

export interface StoryViewerProps {
  group: StoryGroup;
  onClose: () => void;
  /** Called for each story as it is shown, so the ring can go quiet. */
  onSeen: (storyId: string) => void;
  /**
   * Where the tapped circle was on screen, so the viewer can grow out of it.
   *
   * Optional: opened from anywhere without an origin, it simply fades in.
   */
  origin?: DOMRect;
}

export function StoryViewer({ group, onClose, onSeen, origin }: StoryViewerProps) {
  const [index, setIndex] = useState(0);
  const story = group.stories[index];
  const rootRef = useRef<HTMLDivElement>(null);

  /*
   * FLIP: the viewer is already full-screen, and we animate *back* from where
   * the circle was to where it now is.
   *
   * Animating width and height instead would relayout every frame and drop the
   * whole thing to single figures on a phone. A transform is composited, so it
   * stays smooth, and morphing `border-radius` alongside it is what sells the
   * circle becoming a rectangle rather than a card sliding up.
   */
  useEffect(() => {
    const element = rootRef.current;
    if (!element || !origin) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const target = element.getBoundingClientRect();
    if (target.width === 0 || target.height === 0) return;

    const scaleX = origin.width / target.width;
    const scaleY = origin.height / target.height;
    const dx = origin.left + origin.width / 2 - (target.left + target.width / 2);
    const dy = origin.top + origin.height / 2 - (target.top + target.height / 2);

    element.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`,
          borderRadius: '9999px',
          opacity: 0,
        },
        { transform: 'none', borderRadius: '0px', opacity: 1 },
      ],
      {
        duration: 340,
        // The app's standard curve: quick to leave, slow to settle.
        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
        fill: 'both',
      },
    );
  }, [origin]);

  // Marked on display rather than on close, so leaving halfway still records
  // exactly what was actually looked at.
  useEffect(() => {
    if (story) onSeen(story.id);
  }, [story, onSeen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') advance();
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const advance = () => {
    // Past the last story closes the viewer — the sequence is finished, and
    // sitting on a dead end would make the user find the exit themselves.
    if (index >= group.stories.length - 1) onClose();
    else setIndex((i) => i + 1);
  };

  if (!story) return null;

  return (
    <div
      ref={rootRef}
      className={cn(
        'fixed inset-0 z-300 flex flex-col overflow-hidden bg-ink',
        // Only when there is no circle to grow out of; the FLIP below owns the
        // motion whenever there is one, and two would fight.
        !origin && 'animate-panel-in',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={`${group.authorName}'s story`}
    >
      {/* Position, one segment per story. */}
      <div className="flex gap-1 px-3 pt-3">
        {group.stories.map((item, i) => (
          <span
            key={item.id}
            className={cn(
              'h-0.5 flex-1 rounded-full',
              i < index ? 'bg-white/70' : i === index ? 'bg-white' : 'bg-white/25',
            )}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar
          name={group.authorName}
          id={group.authorId}
          src={group.authorAvatarUrl}
          size="sm"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-white">{group.authorName}</span>
          <span className="block truncate text-caption text-white/60">
            @{group.authorUsername}
          </span>
        </span>
        <IconButton
          label="Close"
          onClick={onClose}
          className="text-white hover:bg-white/10 hover:text-white"
        >
          <CloseIcon size={22} />
        </IconButton>
      </div>

      <div className="relative min-h-0 flex-1">
        <img
          src={story.mediaUrl}
          alt={`Story by ${group.authorName}`}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {/*
          Invisible tap zones over the media. Left third goes back, the rest
          advances — the proportion everyone's thumb already expects.
        */}
        <button
          type="button"
          aria-label="Previous"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize"
        />
        <button
          type="button"
          aria-label="Next"
          onClick={advance}
          className="absolute inset-y-0 right-0 w-2/3 cursor-e-resize"
        />
      </div>
    </div>
  );
}
