import type { StoryGroup } from '@pingo/core';
import { Avatar, PlusIcon, cn } from '@pingo/ui';
import { useNavigate } from 'react-router-dom';

/**
 * The story rail at the top of Home.
 *
 * Horizontal, scrollable, people not posts — five stories from one person is
 * one circle that opens as a sequence.
 *
 * ## The ring carries the state
 *
 * Unseen gets the brand gradient; seen drops to a hairline. That is the whole
 * signal, and it is why the row can be read without counting anything: the
 * bright circles are what is new.
 *
 * "You" is always first and always present. With no story of your own it is a
 * `+` that opens the camera — the row doubles as the way in, so posting is
 * never a feature you have to go looking for.
 */

export interface StoriesRowProps {
  groups: StoryGroup[];
  /** The signed-in user, so their own circle can lead and read "You". */
  currentUserId: string | undefined;
  currentUserName: string;
  currentUserAvatarUrl?: string;
  onOpen: (group: StoryGroup) => void;
}

export function StoriesRow({
  groups,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  onOpen,
}: StoriesRowProps) {
  const navigate = useNavigate();

  const mine = groups.find((group) => group.authorId === currentUserId);
  const others = groups.filter((group) => group.authorId !== currentUserId);

  return (
    <div className="px-1">
      <h2 className="px-3 pb-2 text-caption font-medium text-text-secondary">Stories</h2>

      {/*
        `scrollbar-none` because a horizontal scrollbar under six circles is
        louder than the circles. Momentum scrolling still works.
      */}
      <div className="flex gap-3.5 overflow-x-auto scrollbar-none px-3 pb-1">
        {/* You — either your own stories, or the way to post one. */}
        <button
          type="button"
          onClick={() => (mine ? onOpen(mine) : navigate('/camera'))}
          className="flex w-16 shrink-0 flex-col items-center gap-1.5 focus-ring rounded-lg py-1"
        >
          <span className="relative">
            <StoryRing seen={mine?.allSeen ?? true} hasStory={Boolean(mine)}>
              <Avatar
                name={currentUserName}
                id={currentUserId}
                src={mine?.stories[0]?.mediaUrl ?? currentUserAvatarUrl}
                size="lg"
              />
            </StoryRing>

            {!mine && (
              <span
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center',
                  'rounded-full bg-brand-gradient text-white ring-2 ring-page',
                )}
                aria-hidden
              >
                <PlusIcon size={14} />
              </span>
            )}
          </span>

          <span className="w-full truncate text-caption text-text-secondary">You</span>
        </button>

        {others.map((group) => (
          <button
            key={group.authorId}
            type="button"
            onClick={() => onOpen(group)}
            className="flex w-16 shrink-0 flex-col items-center gap-1.5 focus-ring rounded-lg py-1"
          >
            <StoryRing seen={group.allSeen} hasStory>
              <Avatar
                name={group.authorName}
                id={group.authorId}
                src={group.stories[0]?.mediaUrl ?? group.authorAvatarUrl}
                size="lg"
              />
            </StoryRing>
            <span className="w-full truncate text-caption text-text-secondary">
              {group.authorName.split(' ')[0]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The ring around an avatar.
 *
 * A gradient border is drawn as a padded round background rather than a
 * `border-image`, which no browser renders reliably on a circle.
 */
function StoryRing({
  seen,
  hasStory,
  children,
}: {
  seen: boolean;
  hasStory: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'grid place-items-center rounded-full p-[2.5px]',
        !hasStory
          ? 'bg-transparent'
          : seen
            ? 'bg-line-strong'
            : 'bg-brand-gradient',
      )}
    >
      {/* The inner ring separates the avatar from the gradient. */}
      <span className="rounded-full bg-page p-[2px]">{children}</span>
    </span>
  );
}
