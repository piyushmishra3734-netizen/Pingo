import { useState } from 'react';
import { cn } from '@pingo/ui';

/**
 * Where the Pingo TV logo goes: drop the file at `public/tv/logo.svg` (or
 * `logo.png`) and it replaces the wordmark below, nothing else to change.
 */
const LOGO_SRC = '/tv/logo.svg';

export function TvLogo({ className }: { className?: string }) {
  const [missing, setMissing] = useState(false);
  if (!missing) {
    return (
      <img
        src={LOGO_SRC}
        alt="Pingo TV"
        draggable={false}
        onError={() => setMissing(true)}
        className={cn('h-7 w-auto select-none', className)}
      />
    );
  }
  return (
    <span className={cn('select-none text-[19px] font-black leading-none tracking-tight text-ink', className)}>
      PINGO<span className="ml-1 rounded-md bg-brand px-1.5 py-[3px] align-middle text-[12px] font-extrabold tracking-wider text-on-brand">TV</span>
    </span>
  );
}
