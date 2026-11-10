import { cn } from '@pingo/ui';

import type { SharedClip } from './clip-share.js';

/**
 * A GIPHY Clip somebody sent: a video that plays from GIPHY's own servers.
 * Nothing loads until it is tapped (a poster, or the first frame's metadata
 * only), so a chat full of clips costs nothing until somebody wants one.
 */
export function ClipCard({ clip, mine }: { clip: SharedClip; mine: boolean }) {
  // Tall clips are kept from taking the whole screen.
  const ratio = Math.min(1.6, Math.max(0.5, clip.w / clip.h));
  return (
    <div className={cn('w-[240px] max-w-full overflow-hidden rounded-[18px] bg-sunken', mine ? 'self-end' : 'self-start')} style={{ aspectRatio: String(ratio) }}>
      <video
        src={clip.poster ? clip.url : `${clip.url}#t=0.1`}
        poster={clip.poster || undefined}
        controls
        playsInline
        preload={clip.poster ? 'none' : 'metadata'}
        aria-label={clip.title}
        className="size-full object-cover"
      />
    </div>
  );
}
