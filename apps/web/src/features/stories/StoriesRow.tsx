import type { StoryGroup } from '@pingo/core';
import { Avatar, PlusIcon, cn } from '@pingo/ui';
import { useRef, useState } from 'react';

/**
 * The story rail at the top of the chat list.
 *
 * Horizontal, scrollable, people not posts - five stories from one person is
 * one circle that opens as a sequence. Order is decided in `StoryContext`: you,
 * then friends, then everybody else.
 *
 * ## The ring carries the state
 *
 * Three of them, and each says something different:
 *
 * | Ring | Means |
 * | --- | --- |
 * | Accent gradient | unseen |
 * | Neutral grey | seen |
 * | Green | posted to close friends |
 *
 * Green outranks the other two, because it is about *who the story is for*
 * rather than whether you have watched it - being let into somebody's close
 * friends is the more interesting fact and it survives being seen. A watched
 * close story dims to a softer green rather than dropping to grey, so the band
 * still reads while the "already seen" signal still lands.
 *
 * "You" is always first and always present. With no story of your own it is a
 * `+` that opens the creator, so posting is never a feature you have to go
 * looking for; with one, a long press reaches delete and the archive.
 */

/** How long a press has to last to mean "manage this" rather than "open it". */
const HOLD_MS = 480;

export interface StoriesRowProps {
  groups: StoryGroup[];
  /** The signed-in user, so their own circle can lead and read "You". */
  currentUserId: string | undefined;
  currentUserName: string;
  currentUserAvatarUrl?: string;
  /** The second argument is where the circle was, so the viewer can grow from it. */
  onOpen: (group: StoryGroup, origin: DOMRect) => void;
  /** Tapping `+` with no story of your own. */
  onCreate: () => void;
  /** Holding your own circle. */
  onManageMine: () => void;
}

export function StoriesRow({
  groups,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  onOpen,
  onCreate,
  onManageMine,
}: StoriesRowProps) {
  const mine = groups.find((group) => group.authorId === currentUserId);
  const others = groups.filter((group) => group.authorId !== currentUserId);

  return (
    <div className="px-1 pb-0.5">
      <h2 className="px-3 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-text-tertiary uppercase">
        Stories
      </h2>

      {/*
        `scrollbar-none` because a horizontal scrollbar under six circles is
        louder than the circles. Momentum scrolling still works, and
        `overscroll-x-contain` stops a flick past the end of the rail from
        triggering the browser's own back gesture.
      */}
      <ul
        className="scrollbar-none flex gap-3 overflow-x-auto overscroll-x-contain px-3 pb-1"
        aria-label="Stories"
      >
        <li>
          <MyCircle
            group={mine}
            name={currentUserName}
            userId={currentUserId}
            avatarUrl={currentUserAvatarUrl}
            onOpen={onOpen}
            onCreate={onCreate}
            onManage={onManageMine}
          />
        </li>

        {others.map((group) => (
          <li key={group.authorId}>
            <button
              type="button"
              onClick={(event) => onOpen(group, event.currentTarget.getBoundingClientRect())}
              aria-label={`${group.authorName}'s story, ${group.stories.length} ${
                group.stories.length === 1 ? 'item' : 'items'
              }, ${group.allSeen ? 'already seen' : 'not seen yet'}${
                group.closeFriends ? ', close friends' : ''
              }`}
              className={cn(
                'flex w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-xl py-1',
                'focus-ring transition-transform duration-[160ms] ease-standard',
                'active:scale-[0.96]',
              )}
            >
              <StoryRing seen={group.allSeen} close={group.closeFriends} hasStory>
                <Avatar
                  name={group.authorName}
                  id={group.authorId}
                  src={group.authorAvatarUrl}
                  size="lg"
                />
              </StoryRing>
              <span
                className={cn(
                  'w-full truncate text-center text-[0.6875rem] leading-tight',
                  group.allSeen ? 'text-text-tertiary' : 'font-medium text-text-secondary',
                )}
              >
                {group.authorName.split(' ')[0]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Your own circle: open it, start one, or manage what is there.
 *
 * The hold is only offered when there is something to manage. With no story the
 * circle has exactly one job, and a hold that opened a menu of things you
 * cannot do yet would be worse than no hold at all.
 */
function MyCircle({
  group,
  name,
  userId,
  avatarUrl,
  onOpen,
  onCreate,
  onManage,
}: {
  group: StoryGroup | undefined;
  name: string;
  userId: string | undefined;
  avatarUrl?: string;
  onOpen: (group: StoryGroup, origin: DOMRect) => void;
  onCreate: () => void;
  onManage: () => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };

  /** True while a press is being held. Drives the squeeze. */
  const [holding, setHolding] = useState(false);

  const onPointerDown = (event: React.PointerEvent) => {
    if (!group) return;
    held.current = false;
    setHolding(true);
    origin.current = { x: event.clientX, y: event.clientY };
    timer.current = window.setTimeout(() => {
      held.current = true;
      onManage();
      // The press has become a different gesture; say so the way a phone does.
      navigator.vibrate?.(8);
    }, HOLD_MS);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!origin.current) return;
    // A hold that drifts is the rail being scrolled, not a hold.
    const moved = Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y);
    if (moved > 10) clear();
  };

  /*
   * Instagram-style add chip: sits on the bottom-right of the face, white ring
   * cutting it out of the photo. Shared classes so empty and “already posted”
   * land on the same dock point.
   */
  const plusChip = cn(
    'absolute right-0 bottom-0 z-10 grid size-[1.35rem] place-items-center',
    'rounded-full bg-brand-gradient text-on-brand',
    'ring-[2.5px] ring-page',
    'shadow-[0_1px_4px_color-mix(in_srgb,var(--gradient-from,#111113)_35%,transparent)]',
  );

  return (
    /*
      Wrapper so the plus can be its own control once a story exists (a button
      cannot nest a button). The chip is always a child of the avatar frame so
      it sticks to the circle the way Instagram does - not floating free, not
      upper-right.
    */
    <span className="relative inline-flex w-[68px] shrink-0 flex-col items-center gap-1.5 py-1">
      <span
        className={cn(
          'relative block',
          holding
            ? 'motion-safe:animate-press-hold'
            : 'transition-transform duration-[160ms] ease-standard',
        )}
      >
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={clear}
          onPointerCancel={clear}
          onContextMenu={(event) => {
            if (group) event.preventDefault();
          }}
          onClick={(event) => {
            clear();
            if (held.current) {
              held.current = false;
              return;
            }
            if (group) onOpen(group, event.currentTarget.getBoundingClientRect());
            else onCreate();
          }}
          aria-label={
            group
              ? `Your story, ${group.stories.length} ${
                  group.stories.length === 1 ? 'item' : 'items'
                }. Tap to view, hold to manage.`
              : 'Add to your story'
          }
          className={cn(
            'block rounded-full',
            'focus-ring transition-transform duration-[160ms] ease-standard active:scale-[0.96]',
          )}
        >
          <StoryRing
            seen={group?.allSeen ?? true}
            close={group?.closeFriends ?? false}
            hasStory={Boolean(group)}
          >
            <Avatar name={name} id={userId} src={avatarUrl} size="lg" />
          </StoryRing>
        </button>

        {group ? (
          <button
            type="button"
            onClick={onCreate}
            aria-label="Add another story"
            className={cn(
              plusChip,
              'focus-ring transition-transform duration-quick ease-standard',
              'hover:scale-110 active:scale-95',
              // Hit area without stealing taps from the ring itself.
              'after:absolute after:-inset-2 after:content-[""]',
            )}
          >
            <PlusIcon size={12} strokeWidth={2.5} />
          </button>
        ) : (
          /*
            Decorative only: the face button already creates a story, so a
            second control would be two targets for one job.
          */
          <span className={plusChip} aria-hidden>
            <PlusIcon size={12} strokeWidth={2.5} />
          </span>
        )}
      </span>

      <span className="w-full truncate text-center text-[0.6875rem] font-medium leading-tight text-text-secondary">
        You
      </span>
    </span>
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
  close,
  hasStory,
  children,
}: {
  seen: boolean;
  close: boolean;
  hasStory: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        /*
          Ring is the signal: slightly thicker band, soft outer glow for
          unseen, quiet grey for seen. Avatar stays the same size so the rail
          does not shout.
        */
        'grid shrink-0 place-items-center rounded-full p-[2.5px]',
        !hasStory
          ? 'bg-transparent ring-[1.5px] ring-line/80'
          : close
            ? seen
              ? 'bg-online/35'
              : 'bg-online shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-online,#22c55e)_18%,transparent)]'
            : seen
              ? 'bg-line-strong/90'
              : 'bg-brand-gradient shadow-[0_0_0_3px_color-mix(in_srgb,var(--gradient-from,#111113)_14%,transparent),0_2px_10px_color-mix(in_srgb,var(--gradient-from,#111113)_22%,transparent)]',
      )}
    >
      {/*
        Inner cutout separates the face from the band. `grid` kills the
        inline baseline box that used to oval the ring.
      */}
      <span className="grid rounded-full bg-page p-[2px]">{children}</span>
    </span>
  );
}
