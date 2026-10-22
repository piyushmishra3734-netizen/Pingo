import { cn } from '@pingo/ui';
import { AudioLines } from 'lucide-react';

import { useHeyPingo } from './useHeyPingo.js';

/**
 * The small glass pill at the top of the screen while "Hey Pingo" is working:
 * it appears when the wake phrase is heard, shows what is being understood, and
 * says what it did. Not on screen at all the rest of the time.
 */
export function HeyPingoPill() {
  const state = useHeyPingo();
  if (state.phase === 'idle') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[350] flex justify-center px-4"
    >
      <div className="glass-surface flex max-w-full items-center gap-2.5 rounded-full border border-line/60 py-2 pl-2.5 pr-4 text-ink shadow-lg motion-safe:animate-panel-in">
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-full bg-brand text-white', state.phase === 'awake' && 'motion-safe:animate-pulse')}>
          <AudioLines size={15} aria-hidden />
        </span>
        <span className="truncate text-[14px] font-medium">
          {state.phase === 'awake' ? (state.heard ? state.heard : 'Listening…') : state.message}
        </span>
      </div>
    </div>
  );
}
