import { cn } from '@pingo/ui';
import { Headphones } from 'lucide-react';

import { listeningLine, type Listening } from './listening.js';

/**
 * The mark on a face that says "listening on PINGO Music": headphones in the
 * brand colour, sat on the avatar's corner where the green dot goes. Somebody
 * playing music is online, so the one mark says both.
 */
export function ListeningBadge({ music, size = 26, className }: { music: Listening; size?: number; className?: string }) {
  const label = `Listening on PINGO Music: ${listeningLine(music)}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'listening-badge pointer-events-none absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-page shadow-[0_1px_4px_rgb(0_0_0/0.18)]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="grid size-[calc(100%-4px)] place-items-center rounded-full bg-brand text-on-brand">
        <Headphones size={Math.round(size * 0.52)} strokeWidth={2.4} />
      </span>
      <style>{`.listening-badge { animation: listening-bob 2.6s var(--ease-standard, ease-in-out) infinite; transform-origin: 50% 100%; }
@keyframes listening-bob { 0%, 70%, 100% { transform: translateY(0) rotate(0); } 78% { transform: translateY(-2px) rotate(-6deg); } 86% { transform: translateY(0) rotate(4deg); } }
@media (prefers-reduced-motion: reduce) { .listening-badge { animation: none; } }`}</style>
    </span>
  );
}
