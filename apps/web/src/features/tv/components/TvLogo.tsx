import { useState } from 'react';
import { cn } from '@pingo/ui';

/** The official Pingo TV mark: `public/tv/logo.png` (transparent). */
const LOGO_SRC = '/tv/logo.png';

/**
 * The mark with the name beside it. `markOnly` is for tight places (a badge,
 * a loading state). If the file is ever missing, the wordmark stands alone.
 */
export function TvLogo({ className, markOnly = false }: { className?: string; markOnly?: boolean }) {
  const [missing, setMissing] = useState(false);
  return (
    <span className={cn('inline-flex select-none items-center gap-2', className)}>
      {!missing && (
        <img src={LOGO_SRC} alt={markOnly ? 'Pingo TV' : ''} draggable={false} onError={() => setMissing(true)} className="h-8 w-auto drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]" />
      )}
      {!markOnly && (
        <span className="text-[19px] font-black leading-none tracking-tight text-white">
          Pingo<span className="ml-1 font-extrabold text-white/70">TV</span>
        </span>
      )}
    </span>
  );
}
