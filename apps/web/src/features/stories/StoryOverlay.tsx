import type { Story } from '@pingo/core';
import { ChevronRightIcon, LinkIcon, cn } from '@pingo/ui';

import { CaptionText } from '../profile/CaptionText.js';

/**
 * What sits on top of the picture: a caption, a place, a link.
 *
 * All three are optional and all three are laid over the media rather than
 * beside it, because a story is the picture - pushing it up to make room for a
 * line of text would letterbox the thing the person actually posted.
 *
 * ## The scrim is under the text, not over the picture
 *
 * A gradient only where words are. Dimming the whole frame to make one line
 * readable costs the picture far more than it gains the caption.
 *
 * ## Mentions and links come from `CaptionText`
 *
 * The same component the profile uses, so `@name` navigates and a URL opens in
 * exactly the way it does everywhere else in the product. A second
 * implementation would be a second set of rules about what counts as a mention,
 * and they would drift.
 */

export function StoryOverlay({ story }: { story: Story }) {
  const hasAnything = story.caption || story.location || story.linkUrl;
  if (!hasAnything) return null;

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-10',
        'bg-gradient-to-t from-ink/70 via-ink/35 to-transparent',
        'px-4 pt-14 pb-4',
      )}
    >
      <div className="mx-auto w-full max-w-xl space-y-2">
        {story.location && (
          <p className="flex items-center gap-1.5 text-caption text-white/85">
            <span aria-hidden>📍</span>
            <span className="truncate">{story.location}</span>
          </p>
        )}

        {story.caption && (
          // Re-enabled just for the text, so a mention or a link inside it can
          // be tapped without the wrapper swallowing every tap meant for the
          // story's own next/previous zones.
          <p className="pointer-events-auto text-body text-white drop-shadow-md">
            <CaptionText text={story.caption} tone="onDark" />
          </p>
        )}

        {story.linkUrl && (
          <a
            href={story.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
              'pointer-events-auto flex w-fit items-center gap-2 rounded-full',
              'bg-white/15 px-3.5 py-2 backdrop-blur-glass',
              'focus-ring text-caption text-white',
              'transition-colors duration-instant hover:bg-white/25',
            )}
          >
            <LinkIcon size={15} />
            <span className="max-w-[16rem] truncate">{hostOf(story.linkUrl)}</span>
            <ChevronRightIcon size={14} className="text-white/70" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * The host, or the whole thing if it will not parse.
 *
 * A story link is a chip a few centimetres wide, and the readable part of a URL
 * is the domain - showing the full path would truncate to something that says
 * less than nothing about where the tap leads.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
