import type { LiveDrawLink } from '@pingo/core';
import { useEffect, useRef, type RefObject } from 'react';

import { paintStrokes } from '../draw/brushes.js';
import { DRAWER_TIMEOUT_MS, type LiveDrawState } from '../draw/live-draw.js';

/** After the drawer is done, how long the preview waits for their picture before giving up. */
const PICTURE_WAIT_MS = 20_000;

/**
 * What somebody else is drawing right now, painted as they draw it.
 *
 * A preview over the whole screen, never touched by a finger. It goes away when
 * their finished picture arrives (the drawing count goes up) or, if it never
 * does, after a wait - a dropped connection must not leave lines on screen.
 */
export function LiveDrawOverlay({
  link,
  state,
  drawingCount,
  paused,
}: {
  link: LiveDrawLink | undefined;
  state: RefObject<LiveDrawState>;
  drawingCount: number;
  /** The viewer has their own pad open: nothing to preview. */
  paused: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dirty = useRef(false);
  const frame = useRef(0);
  const countAtClose = useRef(drawingCount);
  const count = useRef(drawingCount);
  count.current = drawingCount;

  useEffect(() => {
    if (!link) return;
    const paint = () => {
      frame.current = 0;
      const element = canvas.current;
      const context = element?.getContext('2d');
      if (!element || !context) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      if (element.width !== Math.round(w * dpr) || element.height !== Math.round(h * dpr)) {
        element.width = Math.round(w * dpr);
        element.height = Math.round(h * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, w, h);
      paintStrokes(context, state.current.strokes, w, h);
    };
    const want = () => {
      dirty.current = true;
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };

    /*
     * Saying "I am looking" is what makes the drawer send anything at all.
     * Said when the thread is on screen, and again when a pad opens; taken
     * back when it goes off screen. No timer: it is a handful of packets, not a stream.
     */
    const say = (op: 'watch' | 'unwatch') => void link.send({ u: link.me, op });
    const visible = () => document.visibilityState === 'visible';
    const onVisibility = () => say(visible() ? 'watch' : 'unwatch');
    if (visible()) say('watch');
    document.addEventListener('visibilitychange', onVisibility);

    const stop = link.listen((packet) => {
      if (packet.op === 'open' && visible()) say('watch');
      const s = state.current;
      const wasClosed = s.closedAt;
      if (s.apply(packet)) {
        if (s.closedAt && !wasClosed) countAtClose.current = count.current;
        want();
      }
    });

    const sweep = window.setInterval(() => {
      const s = state.current;
      if (s.strokes.length === 0 && !s.drawer) return;
      const now = Date.now();
      const gone = s.closedAt
        ? count.current > countAtClose.current || now - s.closedAt > PICTURE_WAIT_MS
        : now - s.lastAt > DRAWER_TIMEOUT_MS * 2;
      if (gone) {
        s.clear();
        want();
      }
    }, 1000);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      say('unwatch');
      window.clearInterval(sweep);
      if (frame.current) cancelAnimationFrame(frame.current);
      state.current.clear();
    };
  }, [link, state]);

  if (!link || paused) return null;
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[60] size-full" />;
}
