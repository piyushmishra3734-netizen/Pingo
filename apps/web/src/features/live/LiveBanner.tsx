/**
 * "Someone is live" - where the chats live.
 *
 * A push notification only works if the app is closed; the feed only works if
 * it is opened. The banner covers the moment in between: pinned above the
 * story rail while a mutual is on air, one tap to walk into the broadcast.
 * It is the in-chat half of the go-live fanout, next to the push row.
 */

import { Avatar, cn } from '@pingo/ui';

import type { LiveStream } from './types.js';

export function LiveBanner({
  lives,
  currentUserId,
  onWatch,
}: {
  lives: LiveStream[];
  currentUserId: string | undefined;
  onWatch: (live: LiveStream) => void;
}) {
  const others = lives.filter((live) => live.hostId !== currentUserId).slice(0, 3);
  if (others.length === 0) return null;

  return (
    <div className="space-y-2 px-3 pt-1 pb-1" aria-live="polite" aria-label="Live now">
      {others.map((live) => (
        <button
          key={live.id}
          type="button"
          onClick={() => onWatch(live)}
          className={cn(
            'focus-ring flex w-full items-center gap-3 rounded-2xl border border-danger/25 bg-danger/8 px-3 py-2.5 text-left',
            'transition-transform duration-[160ms] ease-standard active:scale-[0.99]',
          )}
        >
          <span className="relative shrink-0">
            <Avatar name={live.hostName} id={live.hostId} {...(live.hostAvatarUrl ? { src: live.hostAvatarUrl } : {})} size="md" />
            <span className="absolute -right-0.5 -bottom-0.5 flex size-3">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-70" />
              <span className="relative inline-flex size-3 rounded-full border-2 border-page bg-danger" />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-body font-semibold text-ink">
              {live.hostName} is live
              <span className="rounded bg-danger px-1 py-px text-[0.5625rem] font-bold tracking-wide text-white">
                LIVE
              </span>
            </span>
            <span className="mt-0.5 block truncate text-caption text-text-secondary">
              {live.title || 'Tap to watch'} · {live.viewerCount} watching
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-danger px-4 py-2 text-caption font-semibold text-white">
            Watch
          </span>
        </button>
      ))}
    </div>
  );
}
