import { cn } from '@pingo/ui';
import { Clapperboard } from 'lucide-react';

import { watchingLine, type Watching } from './watching.js';

/** The mark on a face that says "watching on Pingo TV": the clapperboard on the avatar's corner, where the green dot goes. */
export function WatchingBadge({ tv, size = 26, className }: { tv: Watching; size?: number; className?: string }) {
  const label = `Watching on Pingo TV: ${watchingLine(tv)}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('pointer-events-none absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-page shadow-[0_1px_4px_rgb(0_0_0/0.18)]', className)}
      style={{ width: size, height: size }}
    >
      <span className="grid size-[calc(100%-4px)] place-items-center rounded-full bg-[#0b0c10] text-white">
        <Clapperboard size={Math.round(size * 0.5)} strokeWidth={2.3} />
      </span>
    </span>
  );
}
