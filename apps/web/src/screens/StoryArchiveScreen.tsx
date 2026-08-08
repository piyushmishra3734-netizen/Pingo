import type { Story } from '@pingo/core';
import { ArchiveIcon, EmptyState, LockIcon, Skeleton, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { useT } from '../features/i18n/useT.js';
import { useStories } from '../features/stories/StoryContext.js';

/**
 * Everything you have posted that has since expired.
 *
 * ## Private, and it says so
 *
 * The archive is the one place in the product holding things that were meant to
 * be temporary. Nobody else can read it - the read policy simply stops hiding
 * an expired story from its own author - but a page full of your old posts is
 * exactly the surface where somebody assumes the wrong thing and shares their
 * screen, so it carries a lock and a sentence rather than relying on the user
 * to have read a migration.
 *
 * ## Why it is a screen rather than a sheet
 *
 * The other story surfaces are sheets because they are decisions taken in the
 * middle of something else. This is a place you go to look through months of
 * material, and a sheet capped at 85% of the viewport is the wrong shape for
 * scrolling.
 */

export function StoryArchiveScreen() {
  const t = useT();
  const { service } = useStories();
  const [stories, setStories] = useState<Story[]>();

  useEffect(() => {
    let active = true;
    void service
      .listArchive()
      .then((list) => {
        if (active) setStories(list);
      })
      .catch(() => {
        if (active) setStories([]);
      });
    return () => {
      active = false;
    };
  }, [service]);

  return (
    <div className="h-full overflow-y-auto">
      <ScreenHeader title={t('profile.storyArchive')} showBack />

      <div className="mx-auto w-full max-w-2xl px-5 pb-10">
        <p className="flex items-center justify-center gap-1.5 py-3 text-caption text-text-tertiary">
          <LockIcon size={13} />
          Only you can see this
        </p>

        {!stories ? (
          <div className="grid grid-cols-3 gap-1 sm:gap-2" role="status" aria-label="Loading archive">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="aspect-[9/16] rounded-lg" />
            ))}
          </div>
        ) : stories.length === 0 ? (
          <EmptyState
            icon={<ArchiveIcon size={28} />}
            title={t('profile.archiveEmpty')}
            description="Stories land here on their own once they are a day old. Nobody else ever sees them."
          />
        ) : (
          <ul className="grid grid-cols-3 gap-1 sm:gap-2">
            {stories.map((story) => (
              <li key={story.id}>
                <figure
                  className={cn(
                    'relative aspect-[9/16] overflow-hidden rounded-lg bg-hover',
                  )}
                >
                  {story.kind === 'video' ? (
                    <video
                      src={story.mediaUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="size-full object-cover"
                    />
                  ) : (
                    <img
                      src={story.mediaUrl}
                      alt={story.caption ?? ''}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  )}

                  <figcaption
                    className={cn(
                      'absolute inset-x-0 bottom-0 px-2 py-1.5',
                      'bg-gradient-to-t from-ink/70 to-transparent',
                      'text-caption text-white',
                    )}
                  >
                    <time dateTime={new Date(story.createdAt).toISOString()}>
                      {new Date(story.createdAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </time>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
