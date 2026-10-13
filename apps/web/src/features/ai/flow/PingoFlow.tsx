import { useEffect, useRef, useState } from 'react';

import { cn } from '@pingo/ui';

import type { FlowController, FlowFace, FlowMode } from './engine.js';

export type { FlowFace, FlowMode } from './engine.js';

/** The still picture: what shows while the 3D loads, and instead of it where WebGL can't run. */
export const PINGO_FLOW_STILL = '/ai/pingo-flow.webp';

/**
 * Pingo Flow, live. three.js loads only when one of these mounts, so nothing
 * of it reaches the rest of the app; until it is ready (or if it can't run)
 * the still picture stands in, the same size, so nothing jumps.
 */
export function PingoFlow({
  face = 'default',
  mode = 'idle',
  colour,
  shadow = false,
  className,
  label = 'PINGO AI',
  onTap,
}: {
  face?: FlowFace;
  mode?: FlowMode;
  /** Body colour; defaults to warm ivory. */
  colour?: string | undefined;
  shadow?: boolean;
  className?: string;
  label?: string;
  onTap?: () => void;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const flow = useRef<FlowController | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ face, mode, colour });
  latest.current = { face, mode, colour };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let made: FlowController | null = null;
    void import('./engine.js')
      .then(({ createPingoFlow }) => createPingoFlow(host, { ...latest.current, shadow }))
      .then((c) => {
        made = c;
        if (cancelled) return c.dispose();
        flow.current = c;
        const now = latest.current;
        c.setFace(now.face);
        c.setMode(now.mode);
        if (now.colour) c.setColour(now.colour);
        setReady(true);
      })
      .catch((cause: unknown) => {
        // No WebGL, or the shape could not load: the still picture stays.
        console.warn('[pingo-flow]', cause);
      });
    return () => {
      cancelled = true;
      made?.dispose();
      flow.current = null;
    };
  }, [shadow]);

  useEffect(() => flow.current?.setFace(face), [face, ready]);
  useEffect(() => flow.current?.setMode(mode), [mode, ready]);
  useEffect(() => {
    if (colour) flow.current?.setColour(colour);
  }, [colour, ready]);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        flow.current?.boop();
        onTap?.();
      }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        flow.current?.lookAt(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
      }}
      onPointerLeave={() => flow.current?.lookAt(null)}
      className={cn('relative block shrink-0 touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-brand', className)}
    >
      <img
        src={PINGO_FLOW_STILL}
        alt=""
        draggable={false}
        className={cn('absolute inset-0 size-full object-contain transition-opacity duration-300', ready && 'opacity-0')}
      />
      <span ref={hostRef} aria-hidden className={cn('absolute inset-0 transition-opacity duration-300', !ready && 'opacity-0')} />
    </button>
  );
}
