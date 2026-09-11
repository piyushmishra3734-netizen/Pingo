/**
 * The LIVE strip above the story rail.
 *
 * Instagram's signal, rebuilt rather than borrowed: the avatar wears a red
 * gradient band, a halo breathes around it - swelling out and squeezing back
 * on a loop - and the LIVE pill pins the bottom. Motion carries the news that
 * someone is on air right now; the pill says it in words for anyone with
 * motion turned off.
 */

import { Avatar, cn } from '@pingo/ui';

import type { LiveStream } from './types.js';

/** The breathing halo: swells, fades, squeezes back. Respects reduced motion. */
function HaloStyle() {
  return (
    <style>{`@keyframes live-halo { 0% { opacity: 0.85; transform: scale(1); } 45% { opacity: 0; transform: scale(1.28); } 55% { opacity: 0; transform: scale(0.96); } 100% { opacity: 0.85; transform: scale(1); } } @media (prefers-reduced-motion: reduce) { .live-halo { animation: none !important; opacity: 0.5 !important; } }`}</style>
  );
}

export function LiveRail({
  lives,
  currentUserId,
  onWatch,
  onOpenMine,
}: {
  lives: LiveStream[];
  currentUserId: string | undefined;
  onWatch: (live: LiveStream) => void;
  onOpenMine: () => void;
}) {
  if (lives.length === 0) return null;

  const mine = lives.find((live) => live.hostId === currentUserId);
  const others = lives.filter((live) => live.hostId !== currentUserId);

  return (
    <div className="px-1 pb-1">
      <HaloStyle />
      <h2 className="flex items-center gap-1.5 px-3 pb-1.5 text-[0.6875rem] font-semibold text-text-tertiary">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-danger" />
        </span>
        Live now
      </h2>
      <ul className="scrollbar-none flex gap-3 overflow-x-auto overscroll-x-contain px-3 pb-1" aria-label="Live now">
        {mine && (
          <li key={mine.id}>
            <button
              type="button"
              onClick={onOpenMine}
              aria-label="Your live video, tap to open"
              className="focus-ring flex w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-xl py-1 transition-transform duration-[160ms] ease-standard active:scale-[0.96]"
            >
              <span className="relative">
                <span
                  aria-hidden
                  className="live-halo absolute -inset-[3px] rounded-full bg-danger/60"
                  style={{ animation: 'live-halo 2.2s ease-in-out infinite' }}
                />
                <span className="relative grid shrink-0 place-items-center rounded-full bg-danger p-[2.5px] shadow-[0_0_12px_rgba(220,38,38,0.45)]">
                  <span className="grid rounded-full bg-page p-[2px]">
                    <Avatar
                      name={mine.hostName}
                      id={mine.hostId}
                      {...(mine.hostAvatarUrl ? { src: mine.hostAvatarUrl } : {})}
                      size="lg"
                    />
                  </span>
                </span>
                <LiveBadge />
              </span>
              <span className="w-full truncate text-center text-[0.6875rem] font-medium leading-tight text-text-secondary">
                You
              </span>
            </button>
          </li>
        )}
        {others.map((live) => (
          <li key={live.id}>
            <button
              type="button"
              onClick={() => onWatch(live)}
              aria-label={`${live.hostName} is live, tap to watch`}
              className="focus-ring flex w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-xl py-1 transition-transform duration-[160ms] ease-standard active:scale-[0.96]"
            >
              <span className="relative">
                <span
                  aria-hidden
                  className="live-halo absolute -inset-[3px] rounded-full bg-danger/60"
                  style={{ animation: 'live-halo 2.2s ease-in-out infinite' }}
                />
                <span className="relative grid shrink-0 place-items-center rounded-full bg-danger p-[2.5px] shadow-[0_0_12px_rgba(220,38,38,0.45)]">
                  <span className="grid rounded-full bg-page p-[2px]">
                    <Avatar
                      name={live.hostName}
                      id={live.hostId}
                      {...(live.hostAvatarUrl ? { src: live.hostAvatarUrl } : {})}
                      size="lg"
                    />
                  </span>
                </span>
                <LiveBadge />
              </span>
              <span
                className={cn(
                  'w-full truncate text-center text-[0.6875rem] leading-tight font-medium text-text-secondary',
                )}
              >
                {live.hostName.split(' ')[0]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The small LIVE pill pinned under a broadcasting avatar. */
export function LiveBadge() {
  return (
    <span
      aria-hidden
      className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md bg-danger px-1.5 py-px text-[0.5625rem] font-bold tracking-wide text-white shadow-sm"
    >
      LIVE
    </span>
  );
}
