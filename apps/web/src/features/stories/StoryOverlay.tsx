import type { Story } from '@pingo/core';
import { Link as LinkIcon, MapPin } from 'lucide-react';

import { CaptionText } from '../profile/CaptionText.js';

/**
 * A caption, a place and a link on older stories, laid low on the picture as
 * the sample draws a caption. Mentions and links come from `CaptionText`, the
 * same rules the profile uses.
 */
export function StoryOverlay({ story }: { story: Story }) {
  const hasAnything = story.caption || story.location || story.linkUrl;
  if (!hasAnything) return null;

  return (
    <div className="pointer-events-none absolute right-[70px] bottom-3 left-3.5 z-[9] space-y-1.5 text-[14px] text-white/90 [text-shadow:0_1px_4px_rgba(0,0,0,.6)]">
      {story.location && (
        <p className="flex items-center gap-1.5">
          <MapPin size={14} />
          <span className="truncate">{story.location}</span>
        </p>
      )}

      {story.caption && (
        <p className="pointer-events-auto">
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
          className="pointer-events-auto flex w-fit items-center gap-1.5 underline-offset-2 hover:underline"
        >
          <LinkIcon size={14} />
          <span className="max-w-[16rem] truncate">{hostOf(story.linkUrl)}</span>
        </a>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
