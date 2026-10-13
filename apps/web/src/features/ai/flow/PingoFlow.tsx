import { useEffect, useRef, useState } from 'react';

import { cn } from '@pingo/ui';

import { useFlowMotion, type FlowFace, type FlowMode } from './flow-face.js';

export type { FlowFace, FlowMode } from './flow-face.js';

/** PINGO AI's character: one picture, cut out clean. */
export const PINGO_MASCOT = '/ai/pingo.webp';

/**
 * Pingo, the character. A picture, not a 3D scene: it floats a little, hops
 * when its mood changes or when tapped, and bobs while it talks. Body motion
 * off in settings (or reduced motion on the device) keeps it still.
 */
export function PingoFlow({
  face = 'default',
  mode = 'idle',
  className,
  label = 'PINGO AI',
  onTap,
}: {
  face?: FlowFace;
  mode?: FlowMode;
  className?: string;
  label?: string;
  onTap?: () => void;
}) {
  const motion = useFlowMotion();
  const [hop, setHop] = useState(0);
  const first = useRef(true);

  // A new mood (a reply, a command) gets a small hop; the resting face does not.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (face !== 'default') setHop((h) => h + 1);
  }, [face]);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        setHop((h) => h + 1);
        onTap?.();
      }}
      className={cn('relative block shrink-0 touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-brand', className)}
    >
      <span className={cn('absolute inset-0', motion.body && 'pingo-float')}>
        <span className={cn('absolute inset-0', motion.body && mode === 'talking' && 'pingo-talk')}>
          <img
            key={hop}
            src={PINGO_MASCOT}
            alt=""
            draggable={false}
            decoding="async"
            className={cn('size-full select-none object-contain', motion.body && hop > 0 && 'pingo-hop')}
          />
        </span>
      </span>
    </button>
  );
}
