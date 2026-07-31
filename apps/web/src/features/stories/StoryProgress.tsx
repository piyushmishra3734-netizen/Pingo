import { useEffect, useRef } from 'react';

/**
 * The segmented bar across the top: one segment per story, the current one
 * filling as it plays.
 *
 * ## Why this component owns a frame loop
 *
 * The fill has to move every frame and nothing else on the screen does. If
 * elapsed time were React state, the header, the caption, the action row and
 * the image would all re-render sixty times a second to animate a two-pixel
 * bar - which is exactly how a story viewer ends up stuttering on the device it
 * matters on.
 *
 * So the player writes progress into a ref, and this reads it inside its own
 * `requestAnimationFrame` and writes `style.transform` directly. React renders
 * once per story; the bar moves on the compositor.
 *
 * `scaleX` rather than `width`, for the same reason: width is a layout
 * property and relaying out a flex row every frame costs far more than a
 * transform, which never leaves the compositor.
 *
 * ## Reduced motion
 *
 * The bar still fills - it is information, not decoration, and freezing it
 * would leave the viewer with no idea how long a story has left. What reduced
 * motion turns off is the *transition* on state changes, which the tokens
 * already handle globally.
 */

export function StoryProgress({
  count,
  index,
  progressRef,
}: {
  count: number;
  index: number;
  /** 0-1 for the story now playing. Written by `useStoryPlayer`. */
  progressRef: React.RefObject<number>;
}) {
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      const element = fillRef.current;
      if (element) {
        element.style.transform = `scaleX(${progressRef.current})`;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progressRef]);

  return (
    <div
      className="flex gap-1 px-3 pt-3"
      // One live region for the position, not one per segment - a screen reader
      // should hear "3 of 5", not five separate progress bars.
      role="group"
      aria-label={`Story ${index + 1} of ${count}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
          {i < index && <span className="block h-full w-full bg-white/80" />}
          {i === index && (
            <span
              ref={fillRef}
              className="block h-full w-full origin-left bg-white"
              // Starts empty; the frame loop above takes over immediately.
              style={{ transform: 'scaleX(0)' }}
            />
          )}
        </span>
      ))}
    </div>
  );
}
