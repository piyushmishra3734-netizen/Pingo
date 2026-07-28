import type { StoryGroup } from '@pingo/core';
import { Avatar, PlusIcon, cn } from '@pingo/ui';
import { useRef, useState } from 'react';

/**
 * The story rail at the top of the chat list.
 *
 * Horizontal, scrollable, people not posts — five stories from one person is
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
 * rather than whether you have watched it — being let into somebody's close
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
    <div className="px-1">
      <h2 className="px-3 pb-2 text-caption font-medium text-text-secondary">Stories</h2>

      {/*
        `scrollbar-none` because a horizontal scrollbar under six circles is
        louder than the circles. Momentum scrolling still works, and
        `overscroll-x-contain` stops a flick past the end of the rail from
        triggering the browser's own back gesture.
      */}
      <ul
        className="scrollbar-none flex gap-3.5 overflow-x-auto overscroll-x-contain px-3 pb-1"
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
                'flex w-[67px] shrink-0 flex-col items-center gap-1.5 rounded-lg py-1',
                'focus-ring transition-transform duration-instant ease-standard active:scale-[0.94]',
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
              <span className="w-full truncate text-caption text-text-secondary">
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

  return (
    /*
      A wrapper, so the plus can be its own button.

      Once you have a story the ring has to do two jobs — open what you posted,
      and add another — and a button cannot contain a button. Previously the
      second job simply disappeared: the plus was rendered only when there was
      no story, so posting one removed the only way to post a second from here.
    */
    <span className="relative inline-flex">
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clear}
      onPointerCancel={clear}
      onContextMenu={(event) => {
        // A long press on a touch screen also raises the browser's own menu,
        // which would land on top of ours.
        if (group) event.preventDefault();
      }}
      onClick={(event) => {
        clear();
        // The hold already opened the menu; the click that follows is noise.
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
        'flex w-[67px] shrink-0 flex-col items-center gap-1.5 rounded-lg py-1',
        'focus-ring transition-transform duration-instant ease-standard active:scale-[0.94]',
      )}
    >
      <span
        className={cn(
          'relative block',
          // Squeezes over the hold's duration, then springs back on release.
          holding
            ? 'motion-safe:animate-press-hold'
            : 'transition-transform duration-quick ease-standard',
        )}
      >
        <StoryRing
          seen={group?.allSeen ?? true}
          close={group?.closeFriends ?? false}
          hasStory={Boolean(group)}
        >
          <Avatar name={name} id={userId} src={avatarUrl} size="lg" />
        </StoryRing>

        {/*
          Decorative only when there is no story: the whole tile already adds
          one, so a second target for the same action would be two controls
          saying one thing.
        */}
        {!group && (
          <span
            className={cn(
              'absolute -right-0.5 -bottom-0.5 grid size-6 place-items-center',
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

    {group && (
      <button
        type="button"
        onClick={onCreate}
        aria-label="Add another story"
        className={cn(
          'absolute right-0 bottom-6 grid size-6 place-items-center',
          'rounded-full bg-brand-gradient text-white ring-2 ring-page',
          'focus-ring transition-transform duration-quick ease-standard',
          'hover:scale-110 active:scale-95',
          /*
            The 44px target sits outside the badge, so it does not swallow the
            ring around it — the tile is the bigger, more likely tap and must
            stay reachable right up to the badge's edge.
          */
          'after:absolute after:-inset-2 after:content-[""]',
        )}
      >
        <PlusIcon size={14} />
      </button>
    )}
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
          67px across: a 56px avatar, 5px of inner gap, 6px of ring.

          The band is what says "there is a story here", so it is the part that
          got thicker — 3px rather than 2.5px. Growing the avatar instead made
          the whole rail shout; the ring is the signal, and the face is just
          what it surrounds.
        */
        'grid shrink-0 place-items-center rounded-full p-[3px]',
        !hasStory
          ? 'bg-transparent'
          : close
            ? seen
              ? 'bg-online/40'
              : 'bg-online shadow-sm'
            : seen
              ? 'bg-line-strong'
              : // Unseen gets a brand-tinted glow as well as the gradient.
                // Colour alone is easy to miss on a bright screen; the halo is
                // what makes the circle read as lit from across the room.
                'bg-brand-gradient shadow-brand',
      )}
    >
      {/*
        The inner ring separates the avatar from the band.

        `grid`, and it has to be. As a plain inline span this box formed a line
        box around the avatar, and the avatar is `inline-flex` — so it sat on the
        text baseline with descender space beneath it. That made the ring 65
        wide and 72 tall: a visible ellipse, and the bug behind "oval ring".
        `block` does not fix it, because a block still lays its inline child out
        on a baseline. `grid` removes the line box altogether.
      */}
      <span className="grid rounded-full bg-page p-[2.5px]">{children}</span>
    </span>
  );
}
